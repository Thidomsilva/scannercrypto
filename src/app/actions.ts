"use server";

import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { findBestTradingOpportunity } from "@/ai/flows/find-best-trading-opportunity";
import { generateChartData, generateAIPromptData, getHigherTimeframeTrend } from "@/lib/mock-data";
import { createOrder, ping, getAccountInfo } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput } from "@/ai/flows/llm-powered-trading-decisions";
import type { MarketAnalysis, FindBestTradingOpportunityInput } from "@/ai/flows/find-best-trading-opportunity";

export async function checkApiStatus() {
  const isConnected = await ping();
  return isConnected ? 'connected' : 'disconnected';
}

export async function getAccountBalance() {
    const accountInfo = await getAccountInfo();
    // The API response contains a list of all asset balances.
    // We need to find the one for USDT.
    const usdtBalance = accountInfo.balances.find((b: { asset: string; }) => b.asset === 'USDT');
    
    if (!usdtBalance || usdtBalance.free === null || usdtBalance.free === undefined) {
        // If USDT balance is not found, or the 'free' amount is missing, throw an error.
        throw new Error("USDT balance not found or is invalid in the account info returned by the API.");
    }
    
    // The 'free' balance is returned as a string, so we need to convert it to a number.
    const balance = parseFloat(usdtBalance.free);

    if (isNaN(balance)) {
        // If the conversion results in NaN (Not a Number), it means the format was unexpected.
        throw new Error(`Failed to parse USDT balance. Received value: ${usdtBalance.free}`);
    }

    return balance;
}


async function executeTrade(decision: GetLLMTradingDecisionOutput, positionSize?: number) {
  if (decision.action === "HOLD") {
    console.log("AI Decision: HOLD. No order placed.");
    return { success: true, orderId: null, message: "HOLD decision, no order placed." };
  }
  
  // When closing a position, use the actual position size. For new trades, use the AI's notional.
  const notionalToTrade = positionSize ?? decision.notional_usdt;

  // Ensure notional value is a string with appropriate precision for the API
  const notionalString = notionalToTrade.toFixed(2);
  
  // Basic validation to prevent dust orders
  if (parseFloat(notionalString) < 5) { // Most exchanges have a minimum order of ~$5
    const message = `Order size ($${notionalString}) is below the typical exchange minimum. No order placed.`;
    console.log(message);
    return { success: false, orderId: null, message: message };
  }

  try {
    const orderParams = {
      symbol: decision.pair.replace("/", ""), // "BTC/USDT" -> "BTCUSDT"
      side: decision.action, // "BUY" or "SELL"
      type: "MARKET" as const, 
      quoteOrderQty: notionalString,
    };
    
    console.log("Placing order with params:", orderParams);
    const orderResponse = await createOrder(orderParams);
    console.log("MEXC Order Response:", orderResponse);
    
    // Check for successful order placement from MEXC response
    if (orderResponse && orderResponse.orderId) {
       return { success: true, orderId: orderResponse.orderId, message: "Order placed successfully." };
    } else {
       // Handle cases where MEXC returns a 200 OK but with an error message inside
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

export async function getAIDecisionAction(
    baseAiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'pair' | 'watcherRationale'>,
    tradablePairs: string[],
    execute: boolean = false
) {
  try {
    console.log("Starting AI decision process...");
    
    // 1. If a position is already open, we only analyze that pair to decide whether to hold or close.
    const position = baseAiInput.currentPosition;
    if (position.status !== 'NONE' && position.pair) {
        const pair = position.pair;
        console.log(`Analyzing open position on ${pair}...`);
        const ohlcvData1m = generateChartData(100, pair);
        const promptData1m = generateAIPromptData(ohlcvData1m);
        const trend15m = getHigherTimeframeTrend(ohlcvData1m);

        const fullAIInput: GetLLMTradingDecisionInput = {
            ...baseAiInput,
            pair,
            ohlcvData: promptData1m,
            higherTimeframeTrend: trend15m,
        };
        
        console.log(`Querying Executor AI for ${pair}...`);
        const decision = await getLLMTradingDecision(fullAIInput);
        const latestPrice = ohlcvData1m[ohlcvData1m.length - 1].close;
        return processDecision(decision, baseAiInput, execute, latestPrice, pair);
    }
    
    // 2. If no position is open, analyze all pairs to find the best opportunity.
    const marketAnalysesWithFullData = tradablePairs.map(pair => {
      console.log(`Analyzing ${pair}...`);
      const ohlcvData = generateChartData(100, pair);
      const marketAnalysis: MarketAnalysis = {
        pair: pair,
        ohlcvData: generateAIPromptData(ohlcvData),
        higherTimeframeTrend: getHigherTimeframeTrend(ohlcvData),
      };
      // Store full data alongside prompt data
      return { marketAnalysis, fullOhlcv: ohlcvData }; 
    });
    
    const marketAnalyses = marketAnalysesWithFullData.map(d => d.marketAnalysis);

    const watcherInput: FindBestTradingOpportunityInput = {
      marketAnalyses: marketAnalyses,
      availableCapital: baseAiInput.availableCapital,
      riskPerTrade: baseAiInput.riskPerTrade,
    };
    
    console.log("Querying Watcher AI to find best opportunity...");
    const bestOpportunity = await findBestTradingOpportunity(watcherInput);

    // 3. If no good opportunity is found, we HOLD.
    if (bestOpportunity.bestPair === "NONE" || bestOpportunity.confidence < 0.7) {
      console.log("No clear opportunity found by Watcher.");
      const holdDecision: GetLLMTradingDecisionOutput = {
        pair: "NONE",
        action: "HOLD",
        notional_usdt: 0,
        order_type: "MARKET",
        confidence: 1,
        rationale: bestOpportunity.rationale || "No high-probability trading opportunities found across monitored pairs."
      };
      // We need a price for the UI, even on hold. Use BTC as default.
      const btcData = generateChartData(1, 'BTC/USDT');
      const latestPrice = btcData[btcData.length -1].close;
      return { data: holdDecision, error: null, executionResult: null, latestPrice: latestPrice, pair: 'NONE' };
    }
    
    // 4. A good opportunity was found, now get the detailed execution plan for that pair.
    const selectedPair = bestOpportunity.bestPair;
    console.log(`Opportunity found on ${selectedPair}! Querying Executor AI...`);
    
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
    
    return processDecision(decision, baseAiInput, execute, latestPrice, selectedPair);

  } catch (error) {
    console.error("Error getting AI trading decision:", error);
    // Ensure a structured error is returned to the client
    const safeError = error instanceof Error ? error.message : "An unknown error occurred.";
    return { data: null, error: `Failed to get AI decision: ${safeError}`, executionResult: null, latestPrice: null, pair: null };
  }
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
      // Only execute if confidence is >= 80% and it's not a HOLD action
      if (decision.action !== 'HOLD' && decision.confidence >= 0.8) {
        console.log(`Executing ${decision.action} ${decision.pair}...`);
        // For closing trades, use the actual size of the open position.
        const positionSizeToClose = baseAiInput.currentPosition.status !== 'NONE' ? baseAiInput.currentPosition.size : undefined;
        executionResult = await executeTrade(decision, positionSizeToClose);
        if (!executionResult.success) {
           console.log(`Execution failed: ${executionResult.message}`);
           // Return error from execution to be displayed on the UI
           return { data: finalDecision, error: `Execution failed: ${executionResult.message}`, executionResult, latestPrice, pair };
        } else {
           console.log(`Order ${decision.action} ${decision.pair} executed successfully!`);
        }
      } else if (decision.action !== 'HOLD') {
        const message = `Execution skipped: Confidence (${(decision.confidence * 100).toFixed(1)}%) below 80% threshold.`;
        console.log(message);
        // We modify the decision for logging purposes but keep the action as HOLD
        finalDecision = { ...decision, rationale: message, action: "HOLD" as const, notional_usdt: 0 };
        executionResult = { success: true, message: message, orderId: null };
      }
    }
    
    return { data: finalDecision, error: null, executionResult, latestPrice, pair };
}
