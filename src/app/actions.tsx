
"use server";

import React from 'react';
import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { findBestTradingOpportunity } from "@/ai/flows/find-best-trading-opportunity";
import { generateChartData, generateAIPromptData } from "@/lib/mock-data";
import { createOrder, ping, getAccountInfo } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput, FindBestTradingOpportunityInput, FindBestTradingOpportunityOutput, MarketData } from "@/ai/schemas";
import { createStreamableValue } from 'ai/rsc';

// --- Constants & Configuration ---
const SPREAD_MAX = 0.001; // Max spread of 0.1%
const ESTIMATED_FEES = 0.001; // Taker fee of 0.1%
const ESTIMATED_SLIPPAGE = 0.0005; // Slippage of 0.05%

export async function checkApiStatus() {
  const isConnected = await ping();
  return isConnected ? 'conectado' : 'desconectado';
}

export async function getAccountBalance() {
    const accountInfo = await getAccountInfo();
    if (!accountInfo || !accountInfo.balances) {
        throw new Error("Resposta da API de conta inválida.");
    }
    const usdtBalance = accountInfo.balances.find((b: { asset: string; }) => b.asset === 'USDT');
    
    if (!usdtBalance || usdtBalance.free === null || usdtBalance.free === undefined) {
        throw new Error("Balanço USDT não encontrado ou inválido na resposta da API.");
    }
    
    const balance = parseFloat(usdtBalance.free);

    if (isNaN(balance)) {
        throw new Error(`Falha ao converter o balanço USDT. Valor recebido: ${usdtBalance.free}`);
    }

    return balance;
}

async function executeTrade(decision: GetLLMTradingDecisionOutput) {
  if (decision.action === "HOLD") {
    console.log("Decisão da IA: HOLD. Nenhuma ordem enviada.");
    return { success: true, orderId: null, message: "Decisão HOLD, nenhuma ordem enviada." };
  }
  
  const notionalToTrade = decision.notional_usdt;
  const notionalString = notionalToTrade.toFixed(2);
  
  if (parseFloat(notionalString) < 5) { 
    const message = `Tamanho da ordem ($${notionalString}) abaixo do mínimo da corretora. Nenhuma ordem enviada.`;
    console.log(message);
    return { success: false, orderId: null, message: message };
  }

  try {
    const orderParams = {
      symbol: decision.pair.replace("/", ""),
      side: decision.action,
      type: "MARKET" as const, 
      quoteOrderQty: notionalString,
    };
    
    console.log("Enviando ordem com parâmetros:", orderParams);
    const orderResponse = await createOrder(orderParams);
    console.log("Resposta da Ordem (MEXC):", orderResponse);
    
    if (orderResponse && orderResponse.orderId) {
       return { success: true, orderId: orderResponse.orderId, message: "Ordem enviada com sucesso." };
    } else {
       const errorMessage = (orderResponse as any)?.msg || "Erro desconhecido da API da MEXC.";
       console.error("Falha ao enviar ordem para MEXC:", errorMessage);
       return { success: false, orderId: null, message: errorMessage };
    }

  } catch (error: any) {
    const errorMessage = error.response?.data?.msg || error.message || "Falha ao enviar ordem.";
    console.error("Falha ao executar trade na MEXC:", error.response?.data || error.message);
    return { success: false, orderId: null, message: errorMessage };
  }
}

function getMarketData(pair: string): MarketData {
    const ohlcv1m = generateChartData(200, pair, 1);
    const ohlcv15m = generateChartData(96, pair, 15);
    
    const atr14 = parseFloat(generateAIPromptData(ohlcv1m, '1m').match(/ATR\(14\)": "(\d+\.\d+)"/)?.[1] || "0");

    return {
        pair: pair,
        ohlcv1m: ohlcv1m,
        ohlcv15m: ohlcv15m,
        promptData1m: generateAIPromptData(ohlcv1m, '1m'),
        promptData15m: generateAIPromptData(ohlcv15m, '15m'),
        indicators: {
            atr14: atr14,
            spread: 0.0001 + Math.random() * 0.0005, // Mock spread 0.01% - 0.06%
            slippage: 0.0002 + Math.random() * 0.0003, // Mock slippage
        }
    };
}

export async function getAIDecisionStream(
    baseAiInput: Pick<GetLLMTradingDecisionInput, 'availableCapital' | 'currentPosition'>,
    tradablePairs: string[],
    execute: boolean = false
) {
  const streamableValue = createStreamableValue();

  (async () => {
    try {
        const position = baseAiInput.currentPosition;
        let finalDecision: GetLLMTradingDecisionOutput;
        let finalExecutionResult: any = null;
        let finalLatestPrice: number;
        let finalPair: string;
        
        // 1. If a position is already open, analyze only that pair.
        if (position.status === 'IN_POSITION' && position.pair) {
            const pair = position.pair;
            finalPair = pair;
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Analisando posição aberta em ${pair}...` } });

            const marketData = getMarketData(pair);
            finalLatestPrice = marketData.ohlcv1m[marketData.ohlcv1m.length - 1].close;

            const watcherInput: FindBestTradingOpportunityInput = {
                pair: pair,
                ohlcvData1m: marketData.promptData1m,
                ohlcvData15m: marketData.promptData15m,
                marketData: {
                    spread: marketData.indicators.spread,
                    slippageEstimate: marketData.indicators.slippage,
                    orderBookImbalance: Math.random() * 2 - 1, // Mock
                }
            };
            
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Consultando Watcher AI para ${pair}...` } });
            const watcherOutput = await findBestTradingOpportunity(watcherInput);

            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Consultando Executor AI para ${pair}...` } });
            const executorInput: GetLLMTradingDecisionInput = {
                ...baseAiInput,
                pair: pair,
                p_up: watcherOutput.p_up,
                score: watcherOutput.score,
                context: watcherOutput.context,
                lastPrice: finalLatestPrice,
                atr14: marketData.indicators.atr14,
                spread: marketData.indicators.spread,
                estimatedFees: ESTIMATED_FEES,
                estimatedSlippage: marketData.indicators.slippage,
            };
            finalDecision = await getLLMTradingDecision(executorInput);

        } else {
            // 2. No position open, scan all pairs to find the best opportunity.
            streamableValue.update({ status: 'analyzing', payload: { pair: null, text: 'Iniciando varredura de mercado...' } });
            
            const allMarketData = tradablePairs.map(pair => {
                 streamableValue.update({ status: 'analyzing', payload: { pair, text: `Analisando ${pair}...` } });
                 return getMarketData(pair);
            });

            streamableValue.update({ status: 'analyzing', payload: { pair: null, text: 'Consultando Watcher AI para todos os pares...' } });

            const watcherPromises: Promise<FindBestTradingOpportunityOutput>[] = allMarketData.map(data => 
                findBestTradingOpportunity({
                    pair: data.pair,
                    ohlcvData1m: data.promptData1m,
                    ohlcvData15m: data.promptData15m,
                    marketData: {
                        spread: data.indicators.spread,
                        slippageEstimate: data.indicators.slippage,
                        orderBookImbalance: Math.random() * 2 - 1,
                    }
                })
            );

            const opportunityResults = await Promise.all(watcherPromises);
            
            const bestOpportunity = opportunityResults.reduce((best, current) => {
                return (!best || current.score > best.score) ? current : best;
            }, null as FindBestTradingOpportunityOutput | null);
            
            if (!bestOpportunity) {
                throw new Error("Watcher AI não retornou nenhuma oportunidade.");
            }

            finalPair = bestOpportunity.pair;
            const selectedMarketData = allMarketData.find(d => d.pair === finalPair)!;
            finalLatestPrice = selectedMarketData.ohlcv1m[selectedMarketData.ohlcv1m.length - 1].close;

            // Calculate EV to decide if we should proceed
            const stop_pct = Math.max(0.0015, 0.8 * selectedMarketData.indicators.atr14 / finalLatestPrice);
            const take_pct = Math.max(0.002, Math.min(1.3 * stop_pct, 0.01));
            const fee_total = ESTIMATED_FEES + selectedMarketData.indicators.slippage;
            const expectedValue = (bestOpportunity.p_up * take_pct) - ((1 - bestOpportunity.p_up) * stop_pct) - fee_total;

            if (expectedValue <= 0 || selectedMarketData.indicators.spread > SPREAD_MAX) {
                finalDecision = {
                    pair: finalPair,
                    action: "HOLD",
                    notional_usdt: 0,
                    order_type: "MARKET",
                    p_up: bestOpportunity.p_up,
                    confidence: 1,
                    rationale: `HOLD forçado. EV: ${(expectedValue * 100).toFixed(3)}% ou Spread (${(selectedMarketData.indicators.spread*100).toFixed(3)}%) muito alto.`
                };
            } else {
                 streamableValue.update({ status: 'analyzing', payload: { pair: finalPair, text: `Oportunidade encontrada em ${finalPair}! Consultando Executor AI...` } });
                 const executorInput: GetLLMTradingDecisionInput = {
                    ...baseAiInput,
                    pair: finalPair,
                    p_up: bestOpportunity.p_up,
                    score: bestOpportunity.score,
                    context: bestOpportunity.context,
                    lastPrice: finalLatestPrice,
                    atr14: selectedMarketData.indicators.atr14,
                    spread: selectedMarketData.indicators.spread,
                    estimatedFees: ESTIMATED_FEES,
                    estimatedSlippage: selectedMarketData.indicators.slippage,
                };
                finalDecision = await getLLMTradingDecision(executorInput);
            }
        }
        
        // 3. Execute trade if applicable
        if (execute && finalDecision.action !== 'HOLD') {
            console.log(`Executando ${finalDecision.action} ${finalDecision.pair}...`);
            finalExecutionResult = await executeTrade(finalDecision);
        } else {
            const message = execute ? `Decisão HOLD, nenhuma ordem enviada.` : `Execução ignorada no modo de simulação.`;
            console.log(message);
            finalExecutionResult = { success: true, message: message, orderId: null };
        }

        const result = { 
            data: finalDecision, 
            error: !finalExecutionResult.success ? `Execução falhou: ${finalExecutionResult.message}` : null,
            executionResult: finalExecutionResult, 
            latestPrice: finalLatestPrice, 
            pair: finalPair 
        };
        streamableValue.done({ status: 'done', payload: result });

    } catch (error) {
        console.error("Erro ao obter decisão de trading da IA:", error);
        const safeError = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        const errorResult = { data: null, error: `Falha ao obter decisão da IA: ${safeError}`, executionResult: null, latestPrice: null, pair: null };
        streamableValue.done({ status: 'done', payload: errorResult });
    }
  })();

  return streamableValue.value;
}
