
"use server";

import React from 'react';
import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { findBestTradingOpportunity } from "@/ai/flows/find-best-trading-opportunity";
import { createOrder, ping, getAccountInfo, getKlineData } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput, FindBestTradingOpportunityInput, FindBestTradingOpportunityOutput, MarketData, OHLCVData } from "@/ai/schemas";
import { createStreamableValue } from 'ai/rsc';

// --- Constants & Configuration ---
const SPREAD_MAX = 0.001; // Max spread of 0.1%
const ESTIMATED_FEES = 0.001; // Taker fee of 0.1%
const ESTIMATED_SLIPPAGE = 0.0005; // Slippage of 0.05%


// --- Data Generation & Indicators ---

// Calculates ATR (Average True Range)
const calculateATR = (data: OHLCVData[], period: number): number => {
    if (data.length < period) return 0;
    const trueRanges: number[] = [];
    for (let i = data.length - period; i < data.length; i++) {
        const high = data[i].high;
        const low = data[i].low;
        const prevClose = i > 0 ? data[i - 1].close : data[i].open;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRanges.push(tr);
    }
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}

// Generates a formatted string of market data for the AI prompt
const generateAIPromptData = (ohlcvData: OHLCVData[], timeframeLabel: string): string => {
  if (ohlcvData.length === 0) return "No data available";
  const latestCandle = ohlcvData[ohlcvData.length - 1];
  
  // Calculate some simple indicators from the data
  const recentCloses = ohlcvData.slice(-20).map(c => c.close);
  const ema20 = recentCloses.reduce((acc, val) => acc + val, 0) / recentCloses.length;
  const closes50 = ohlcvData.slice(-50).map(c => c.close);
  const ema50 = closes50.reduce((acc, val) => acc + val, 0) / closes50.length;
  const stdDev = Math.sqrt(recentCloses.map(x => Math.pow(x - ema20, 2)).reduce((a, b) => a + b) / recentCloses.length);

  const atr14 = calculateATR(ohlcvData, 14);

  // Note: Some indicators are still mocked for simplicity as they require more complex calculations or data.
  const indicators = {
    "Price": latestCandle.close.toFixed(4),
    "EMA(20)": ema20.toFixed(4),
    "EMA(50)": ema50.toFixed(4),
    "RSI(14)": (40 + Math.random() * 20).toFixed(1), // Mocked for simplicity
    "BollingerBands(20,2)": `Upper: ${(ema20 + 2 * stdDev).toFixed(4)}, Mid: ${ema20.toFixed(4)}, Lower: ${(ema20 - 2 * stdDev).toFixed(4)}`,
    "z-score(20)": stdDev > 0 ? ((latestCandle.close - ema20) / stdDev).toFixed(2) : "0.00",
    "ATR(14)": atr14.toFixed(4),
    "ADX(14)": (15 + Math.random() * 20).toFixed(1), // Mock value between 15-35
    "Volume": latestCandle.volume,
    "VolumeDelta": (Math.random() * 200 - 100).toFixed(2), // Mocked
  };

  const ohlcvSummary = ohlcvData.slice(-10).map(c => 
    `{t: ${c.time}, o: ${c.open}, h: ${c.high}, l: ${c.low}, c: ${c.close}, v: ${c.volume}}`
  ).join(',\n    ');

  return `
    Recent 10 periods (${timeframeLabel}): 
    [
      ${ohlcvSummary}
    ]
    
    Current Technical Indicators (${timeframeLabel}):
    ${JSON.stringify(indicators, null, 2)}
  `;
};

// --- Core API & Trading Logic ---

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

async function getMarketData(pair: string): Promise<MarketData> {
    const [ohlcv1m, ohlcv15m] = await Promise.all([
        getKlineData(pair, '1m', 200),
        getKlineData(pair, '15m', 96)
    ]);

    if (ohlcv1m.length === 0 || ohlcv15m.length === 0) {
        throw new Error(`Dados de mercado insuficientes para ${pair}`);
    }

    const atr14 = calculateATR(ohlcv1m, 14);

    return {
        pair: pair,
        ohlcv1m: ohlcv1m,
        ohlcv15m: ohlcv15m,
        promptData1m: generateAIPromptData(ohlcv1m, '1m'),
        promptData15m: generateAIPromptData(ohlcv15m, '15m'),
        indicators: {
            atr14: atr14,
            // Spread and slippage are still mocked as they are not easily available via public API
            spread: 0.0001 + Math.random() * 0.0005,
            slippage: 0.0002 + Math.random() * 0.0003,
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
        let finalMetadata: any = {};
        
        // 1. If a position is already open, analyze only that pair.
        if (position.status === 'IN_POSITION' && position.pair) {
            const pair = position.pair;
            finalPair = pair;
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Analisando posição aberta em ${pair}...` } });

            const marketData = await getMarketData(pair);
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
            
            const stop_pct = Math.max(0.0015, 0.8 * marketData.indicators.atr14 / finalLatestPrice);
            const take_pct = Math.max(0.002, Math.min(1.3 * stop_pct, 0.01));
            const fee_total = ESTIMATED_FEES + marketData.indicators.slippage;
            finalMetadata = {
                expectedValue: (watcherOutput.p_up * take_pct) - ((1 - watcherOutput.p_up) * stop_pct) - fee_total,
                spread: marketData.indicators.spread
            }


        } else {
            // 2. No position open, scan all pairs to find the best opportunity.
            streamableValue.update({ status: 'analyzing', payload: { pair: null, text: 'Iniciando varredura de mercado...' } });
            
            const allMarketData = await Promise.all(tradablePairs.map(async (pair) => {
                 streamableValue.update({ status: 'analyzing', payload: { pair, text: `Buscando dados para ${pair}...` } });
                 return await getMarketData(pair);
            }));

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
            
            finalMetadata = {
                expectedValue: expectedValue,
                spread: selectedMarketData.indicators.spread
            }

            if (expectedValue <= 0 || selectedMarketData.indicators.spread > SPREAD_MAX) {
                finalDecision = {
                    pair: finalPair,
                    action: "HOLD",
                    notional_usdt: 0,
                    order_type: "MARKET",
                    p_up: bestOpportunity.p_up,
                    confidence: 1,
                    rationale: `HOLD forçado. EV: ${(expectedValue * 100).toFixed(3)}% ou Spread (${(selectedMarketData.indicators.spread*100).toFixed(3)}%) muito alto.`,
                    stop_pct: stop_pct,
                    take_pct: take_pct
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
            pair: finalPair,
            metadata: finalMetadata
        };
        streamableValue.done({ status: 'done', payload: result });

    } catch (error) {
        console.error("Erro ao obter decisão de trading da IA:", error);
        const safeError = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        const errorResult = { data: null, error: `Falha ao obter decisão da IA: ${safeError}`, executionResult: null, latestPrice: null, pair: null, metadata: null };
        streamableValue.done({ status: 'done', payload: errorResult });
    }
  })();

  return streamableValue.value;
}
