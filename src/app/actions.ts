"use server";

import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { findBestTradingOpportunity } from "@/ai/flows/find-best-trading-opportunity";
import { generateChartData, generateAIPromptData, getHigherTimeframeTrend } from "@/lib/mock-data";
import { createOrder, ping, getAccountInfo } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput } from "@/ai/flows/llm-powered-trading-decisions";
import type { MarketAnalysis, FindBestTradingOpportunityInput } from "@/ai/flows/find-best-trading-opportunity";

export async function getServerIpAddress(): Promise<string | null> {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    if (!response.ok) {
      throw new Error(`Failed to fetch IP: ${response.statusText}`);
    }
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.error("Error fetching server IP:", error);
    return "Could not retrieve IP address.";
  }
}

export async function checkApiStatus() {
  const isConnected = await ping();
  return isConnected ? 'connected' : 'disconnected';
}

export async function getAccountBalance() {
    const accountInfo = await getAccountInfo();
    const usdtBalance = accountInfo.balances.find(b => b.asset === 'USDT');
    if (!usdtBalance) {
        throw new Error("USDT balance not found in account.");
    }
    return parseFloat(usdtBalance.free);
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
    // In a real scenario, you would uncomment the line below. For now, we simulate success.
    const orderResponse = await createOrder(orderParams);
    // const orderResponse = { orderId: `simulated_${Date.now()}`, msg: "Simulated order placed successfully." }; // Simulated success
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
    baseAiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'pair'>,
    tradablePairs: string[],
    execute: boolean = false
) {
  try {
     // 1. If a position is already open, we only analyze that pair to decide whether to hold or close.
    const position = baseAiInput.currentPosition;
    if (position.status !== 'NONE' && position.pair) {
        const pair = position.pair;
        const ohlcvData1m = generateChartData(100, pair);
        const promptData1m = generateAIPromptData(ohlcvData1m);
        const trend15m = getHigherTimeframeTrend(ohlcvData1m);

        const fullAIInput: GetLLMTradingDecisionInput = {
            ...baseAiInput,
            pair,
            ohlcvData: promptData1m,
            higherTimeframeTrend: trend15m,
        };

        const decision = await getLLMTradingDecision(fullAIInput);
        const latestPrice = ohlcvData1m[ohlcvData1m.length - 1].close;
        return processDecision(decision, baseAiInput, execute, latestPrice, pair);
    }
    
    // 2. If no position is open, analyze all pairs to find the best opportunity.
    const marketAnalyses: MarketAnalysis[] = tradablePairs.map(pair => {
      const ohlcvData1m = generateChartData(100, pair);
      const promptData1m = generateAIPromptData(ohlcvData1m);
      const trend15m = getHigherTimeframeTrend(ohlcvData1m);
      return {
        pair: pair,
        ohlcvData: promptData1m,
        higherTimeframeTrend: trend15m,
      }
    });

    const watcherInput: FindBestTradingOpportunityInput = {
      marketAnalyses: marketAnalyses,
      availableCapital: baseAiInput.availableCapital,
      riskPerTrade: baseAiInput.riskPerTrade,
    };
    
    const bestOpportunity = await findBestTradingOpportunity(watcherInput);

    // 3. If no good opportunity is found, we HOLD.
    if (bestOpportunity.bestPair === "NONE") {
      const holdDecision: GetLLMTradingDecisionOutput = {
        pair: "NONE",
        action: "HOLD",
        notional_usdt: 0,
        order_type: "MARKET",
        confidence: 1,
        rationale: bestOpportunity.rationale || "No high-probability trading opportunities found across monitored pairs."
      };
      return { data: holdDecision, error: null, executionResult: null, latestPrice: null, pair: 'NONE' };
    }
    
    // 4. A good opportunity was found, now get the detailed execution plan for that pair.
    const selectedPair = bestOpportunity.bestPair;
    const selectedMarketData = marketAnalyses.find(m => m.pair === selectedPair)!;
    const ohlcvDataForPair = generateChartData(100, selectedPair); // Regenerate to get latest price cleanly
    const latestPrice = ohlcvDataForPair[ohlcvDataForPair.length - 1].close;


    const fullAIInput: GetLLMTradingDecisionInput = {
      ...baseAiInput,
      pair: selectedPair,
      ohlcvData: selectedMarketData.ohlcvData,
      higherTimeframeTrend: selectedMarketData.higherTimeframeTrend,
    };

    // Add the watcher's rationale to the executor's prompt for context.
    (fullAIInput as any).watcherRationale = bestOpportunity.rationale;
    
    const decision = await getLLMTradingDecision(fullAIInput);
    
    return processDecision(decision, baseAiInput, execute, latestPrice, selectedPair);

  } catch (error) {
    console.error("Error getting AI trading decision:", error);
    return { data: null, error: "Failed to get AI decision. Please try again.", executionResult: null, latestPrice: null, pair: null };
  }
}

async function processDecision(
    decision: GetLLMTradingDecisionOutput,
    baseAiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'pair'>,
    execute: boolean,
    latestPrice: number,
    pair: string
) {
    let executionResult = null;
    if (execute) { 
      // Only execute if confidence is >= 80% and it's not a HOLD action
      if (decision.action !== 'HOLD' && decision.confidence >= 0.8) {
        // For closing trades, use the actual size of the open position.
        const positionSizeToClose = baseAiInput.currentPosition.status !== 'NONE' ? baseAiInput.currentPosition.size : undefined;
        executionResult = await executeTrade(decision, positionSizeToClose);
        if (!executionResult.success) {
           // Return error from execution to be displayed on the UI
           return { data: decision, error: `Execution failed: ${executionResult.message}`, executionResult, latestPrice, pair };
        }
      } else {
        // If confidence is too low or action is HOLD, treat as a non-executed event.
        const message = decision.action === 'HOLD' 
          ? 'AI decided to HOLD.'
          : `Execution skipped: Confidence (${(decision.confidence * 100).toFixed(1)}%) is below 80% threshold.`;
        console.log(message);
        // We modify the decision for logging purposes
        const loggedDecision = { ...decision, rationale: message, action: "HOLD" as const };
        return { data: loggedDecision, error: null, executionResult: { success: true, message }, latestPrice, pair };
      }
    }
    
    return { data: decision, error: null, executionResult, latestPrice, pair };
}

    