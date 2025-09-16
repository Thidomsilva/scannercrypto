"use server";

import React from 'react';
import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { findBestTradingOpportunity } from "@/ai/flows/find-best-trading-opportunity";
import { generateChartData, generateAIPromptData, getHigherTimeframeTrend } from "@/lib/mock-data";
import { createOrder, ping, getAccountInfo } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput } from "@/ai/flows/llm-powered-trading-decisions";
import type { MarketAnalysis, FindBestTradingOpportunityInput } from "@/ai/flows/find-best-trading-opportunity";
import { createStreamableUI, createStreamableValue } from 'ai/rsc';
import { AIStatus, AIDecisionPanelContent } from '@/components/ai-decision-panel';


export async function checkApiStatus() {
  const isConnected = await ping();
  return isConnected ? 'connected' : 'disconnected';
}

export async function getAccountBalance() {
    const accountInfo = await getAccountInfo();
    const usdtBalance = accountInfo.balances.find((b: { asset: string; }) => b.asset === 'USDT');
    
    if (!usdtBalance || usdtBalance.free === null || usdtBalance.free === undefined) {
        throw new Error("USDT balance not found or is invalid in the account info returned by the API.");
    }
    
    const balance = parseFloat(usdtBalance.free);

    if (isNaN(balance)) {
        throw new Error(`Failed to parse USDT balance. Received value: ${usdtBalance.free}`);
    }

    return balance;
}


async function executeTrade(decision: GetLLMTradingDecisionOutput, positionSize?: number) {
  if (decision.action === "HOLD") {
    console.log("AI Decision: HOLD. No order placed.");
    return { success: true, orderId: null, message: "HOLD decision, no order placed." };
  }
  
  const notionalToTrade = positionSize ?? decision.notional_usdt;
  const notionalString = notionalToTrade.toFixed(2);
  
  if (parseFloat(notionalString) < 5) { 
    const message = `Order size ($${notionalString}) is below the typical exchange minimum. No order placed.`;
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
    
    console.log("Placing order with params:", orderParams);
    const orderResponse = await createOrder(orderParams);
    console.log("MEXC Order Response:", orderResponse);
    
    if (orderResponse && orderResponse.orderId) {
       return { success: true, orderId: orderResponse.orderId, message: "Order placed successfully." };
    } else {
       const errorMessage = (orderResponse as any)?.msg || "Unknown error from MEXC API.";
       console.error("MEXC order placement failed:", errorMessage);
       return { success: false, orderId: null, message: errorMessage };
    }

  } catch (error: any) {
    const errorMessage = error.response?.data?.msg || error.message || "Failed to place order.";
    console.error("Failed to execute trade on MEXC:", error.response?.data || error.message);
    return { success: false, orderId: null, message: errorMessage };
  }
}

// This is the new streaming action
export async function getAIDecisionStream(
    baseAiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'pair' | 'watcherRationale'>,
    tradablePairs: string[],
    execute: boolean = false
) {
  const streamable = createStreamableUI(
    <AIStatus status="Consultando IAs..." />
  );

  const finalResult = createStreamableValue<any>();

  (async () => {
    try {
        // 1. If a position is already open, we only analyze that pair to decide whether to hold or close.
        const position = baseAiInput.currentPosition;
        if (position.status !== 'NONE' && position.pair) {
            const pair = position.pair;
            streamable.update(<AIStatus status={`Analisando posição aberta em ${pair}...`} />);

            const ohlcvData1m = generateChartData(100, pair);
            const promptData1m = generateAIPromptData(ohlcvData1m);
            const trend15m = getHigherTimeframeTrend(ohlcvData1m);

            const fullAIInput: GetLLMTradingDecisionInput = {
                ...baseAiInput,
                pair,
                ohlcvData: promptData1m,
                higherTimeframeTrend: trend15m,
            };
            
            streamable.update(<AIStatus status={`Consultando Executor AI para ${pair}...`} />);
            const decision = await getLLMTradingDecision(fullAIInput);
            const latestPrice = ohlcvData1m[ohlcvData1m.length - 1].close;

            const result = await processDecision(decision, baseAiInput, execute, latestPrice, pair);
            streamable.done(<AIDecisionPanelContent decision={result.data} />);
            finalResult.done(result);
            return;
        }
        
        // 2. If no position is open, analyze all pairs to find the best opportunity.
        const marketAnalysesWithFullData = [];
        for (const pair of tradablePairs) {
            streamable.update(<AIStatus status={`Analisando ${pair}...`} />);
            // Add a small delay to allow the UI to update
            await new Promise(resolve => setTimeout(resolve, 50)); 
            
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
        
        streamable.update(<AIStatus status="Consultando Watcher AI para encontrar a melhor oportunidade..." />);
        const bestOpportunity = await findBestTradingOpportunity(watcherInput);

        // 3. If no good opportunity is found, we HOLD.
        if (bestOpportunity.bestPair === "NONE" || bestOpportunity.confidence < 0.7) {
            const holdDecision: GetLLMTradingDecisionOutput = {
                pair: "NONE", action: "HOLD", notional_usdt: 0, order_type: "MARKET", confidence: 1,
                rationale: bestOpportunity.rationale || "Nenhuma oportunidade de alta probabilidade encontrada."
            };
            const btcData = generateChartData(1, 'BTC/USDT');
            const latestPrice = btcData[btcData.length -1].close;

            const result = { data: holdDecision, error: null, executionResult: null, latestPrice: latestPrice, pair: 'NONE' };
            streamable.done(<AIDecisionPanelContent decision={result.data} />);
            finalResult.done(result);
            return;
        }
        
        // 4. A good opportunity was found, now get the detailed execution plan for that pair.
        const selectedPair = bestOpportunity.bestPair;
        streamable.update(<AIStatus status={`Oportunidade encontrada em ${selectedPair}! Consultando Executor AI...`} />);
        
        const selectedPairData = marketAnalysesWithFullData.find(d => d.marketAnalysis.pair === selectedPair);

        if (!selectedPairData) {
            throw new Error(`Could not find market data for selected pair: ${selectedPair}`);
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
        streamable.done(<AIDecisionPanelContent decision={result.data} />);
        finalResult.done(result);

    } catch (error) {
        console.error("Error getting AI trading decision:", error);
        const safeError = error instanceof Error ? error.message : "An unknown error occurred.";
        const errorResult = { data: null, error: `Failed to get AI decision: ${safeError}`, executionResult: null, latestPrice: null, pair: null };
        streamable.done(<AIStatus status={`Erro: ${safeError}`} isError />);
        finalResult.done(errorResult);
    }
  })();

  return {
    ui: streamable.value,
    result: finalResult.value
  };
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
      if (decision.action !== 'HOLD' && decision.confidence >= 0.8) {
        console.log(`Executing ${decision.action} ${decision.pair}...`);
        const positionSizeToClose = baseAiInput.currentPosition.status !== 'NONE' ? baseAiInput.currentPosition.size : undefined;
        executionResult = await executeTrade(decision, positionSizeToClose);
        if (!executionResult.success) {
           console.log(`Execution failed: ${executionResult.message}`);
           return { data: finalDecision, error: `Execution failed: ${executionResult.message}`, executionResult, latestPrice, pair };
        } else {
           console.log(`Order ${decision.action} ${decision.pair} executed successfully!`);
        }
      } else if (decision.action !== 'HOLD') {
        const message = `Execução ignorada: Confiança (${(decision.confidence * 100).toFixed(1)}%) abaixo do limite de 80%.`;
        console.log(message);
        finalDecision = { ...decision, rationale: message, action: "HOLD" as const, notional_usdt: 0 };
        executionResult = { success: true, message: message, orderId: null };
      }
    }
    
    return { data: finalDecision, error: null, executionResult, latestPrice, pair };
}
