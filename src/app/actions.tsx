
"use server";

import React from 'react';
import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { findBestTradingOpportunity } from "@/ai/flows/find-best-trading-opportunity";
import { generateChartData, generateAIPromptData, getHigherTimeframeTrend } from "@/lib/mock-data";
import { createOrder, ping, getAccountInfo } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput, MarketAnalysis, FindBestTradingOpportunityInput } from "@/ai/schemas";
import { createStreamableValue } from 'ai/rsc';


export async function checkApiStatus() {
  const isConnected = await ping();
  return isConnected ? 'conectado' : 'desconectado';
}

export async function getAccountBalance() {
    const accountInfo = await getAccountInfo();
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


async function executeTrade(decision: GetLLMTradingDecisionOutput, positionSize?: number) {
  if (decision.action === "HOLD") {
    console.log("Decisão da IA: HOLD. Nenhuma ordem enviada.");
    return { success: true, orderId: null, message: "Decisão HOLD, nenhuma ordem enviada." };
  }
  
  const notionalToTrade = positionSize ?? decision.notional_usdt;
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

// This is the new streaming action
export async function getAIDecisionStream(
    baseAiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'pair' | 'watcherRationale'>,
    tradablePairs: string[],
    execute: boolean = false
) {
  const streamableValue = createStreamableValue();

  (async () => {
    try {
        // 1. If a position is already open, we only analyze that pair to decide whether to hold or close.
        const position = baseAiInput.currentPosition;
        if (position.status === 'IN_POSITION' && position.pair) {
            const pair = position.pair;
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Analisando posição aberta em ${pair}...` } });

            const ohlcvData1m = generateChartData(100, pair);
            const promptData1m = generateAIPromptData(ohlcvData1m);
            const trend15m = getHigherTimeframeTrend(ohlcvData1m);

            const fullAIInput: GetLLMTradingDecisionInput = {
                ...baseAiInput,
                pair,
                ohlcvData: promptData1m,
                higherTimeframeTrend: trend15m,
            };
            
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Consultando Executor AI para ${pair}...` } });
            const decision = await getLLMTradingDecision(fullAIInput);
            const latestPrice = ohlcvData1m[ohlcvData1m.length - 1].close;

            const result = await processDecision(decision, baseAiInput, execute, latestPrice, pair);
            streamableValue.done({ status: 'done', payload: result });
            return;
        }
        
        // 2. If no position is open, analyze all pairs to find the best opportunity.
        const marketAnalysesWithFullData = [];
        for (const pair of tradablePairs) {
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Analisando ${pair}...` } });
            
            const ohlcvData = generateChartData(100, pair);
            const marketAnalysis: MarketAnalysis = {
                pair: pair,
                ohlcvData: generateAIPromptData(ohlcvData),
                higherTimeframeTrend: getHigherTimeframeTrend(ohlcvData),
            };
            marketAnalysesWithFullData.push({ marketAnalysis, fullOhlcv: ohlcvData });
        }
        
        const marketAnalyses = marketAnalysesWithFullData.map(d => d.marketAnalysis);

        const watcherInput: FindBestTradingOpportunityInput = {
            marketAnalyses: marketAnalyses,
            availableCapital: baseAiInput.availableCapital,
            riskPerTrade: baseAiInput.riskPerTrade,
        };
        
        streamableValue.update({ status: 'analyzing', payload: { pair: null, text: 'Consultando Watcher AI...' } });
        const bestOpportunity = await findBestTradingOpportunity(watcherInput);

        // 3. If no good opportunity is found, we HOLD.
        if (bestOpportunity.bestPair === "NONE" || bestOpportunity.confidence < 0.6) {
            const holdDecision: GetLLMTradingDecisionOutput = {
                pair: "NONE", action: "HOLD", notional_usdt: 0, order_type: "MARKET", confidence: 1,
                rationale: bestOpportunity.rationale || "Nenhuma oportunidade de alta probabilidade encontrada."
            };
            
            const result = { data: holdDecision, error: null, executionResult: null, latestPrice: 0, pair: 'NONE' };
            streamableValue.done({ status: 'done', payload: result });
            return;
        }
        
        // 4. A good opportunity was found, now get the detailed execution plan for that pair.
        const selectedPair = bestOpportunity.bestPair;
        streamableValue.update({ status: 'analyzing', payload: { pair: selectedPair, text: 'Oportunidade encontrada! Consultando Executor AI...' } });
        
        const selectedPairData = marketAnalysesWithFullData.find(d => d.marketAnalysis.pair === selectedPair);

        if (!selectedPairData) {
            throw new Error(`Não foram encontrados dados de mercado para o par selecionado: ${selectedPair}`);
        }
        
        const latestPrice = selectedPairData.fullOhlcv[selectedPairData.fullOhlcv.length - 1].close;

        const fullAIInput: GetLLMTradingDecisionInput = {
            ...baseAiInput,
            pair: selectedPair,
            ohlcvData: selectedPairData.marketAnalysis.ohlcvData,
            higherTimeframeTrend: selectedPairData.marketAnalysis.higherTimeframeTrend,
            watcherRationale: bestOpportunity.rationale,
        };
        
        const decision = await getLLMTradingDecision(fullAIInput);
        const result = await processDecision(decision, baseAiInput, execute, latestPrice, selectedPair);
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

async function processDecision(
    decision: GetLLMTradingDecisionOutput,
    baseAiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'pair' | 'watcherRationale'>,
    execute: boolean,
    latestPrice: number,
    pair: string
) {
    let executionResult = null;
    let finalDecision = { ...decision };

    if (execute) { 
      if (decision.action !== 'HOLD' && decision.confidence >= 0.75) {
        console.log(`Executando ${decision.action} ${decision.pair}...`);
        const positionSizeToClose = (decision.action === 'SELL' && baseAiInput.currentPosition.status === 'IN_POSITION') ? baseAiInput.currentPosition.size : undefined;
        executionResult = await executeTrade(decision, positionSizeToClose);
        if (!executionResult.success) {
           console.log(`Execução falhou: ${executionResult.message}`);
           return { data: finalDecision, error: `Execução falhou: ${executionResult.message}`, executionResult, latestPrice, pair };
        } else {
           console.log(`Ordem ${decision.action} ${decision.pair} executada com sucesso!`);
        }
      } else if (decision.action !== 'HOLD') {
        const message = `Execução ignorada: Confiança (${(decision.confidence * 100).toFixed(1)}%) abaixo do limite de 75%.`;
        console.log(message);
        // Do not change the action to HOLD here in the final decision, just block execution.
        // Let the UI show the original intent.
        executionResult = { success: true, message: message, orderId: null };
      }
    }
    
    return { data: finalDecision, error: null, executionResult, latestPrice, pair };
}
