"use server";

import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { generateChartData, generateAIPromptData, getHigherTimeframeTrend } from "@/lib/mock-data";
import { createOrder } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput } from "@/ai/flows/llm-powered-trading-decisions";

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
    // const orderResponse = await createOrder(orderParams);
    const orderResponse = { orderId: `simulated_${Date.now()}`, msg: "Simulated order placed successfully." }; // Simulated success
    console.log("MEXC Order Response:", orderResponse);
    
    // Check for successful order placement from MEXC response
    if (orderResponse && orderResponse.orderId) {
       return { success: true, orderId: orderResponse.orderId, message: "Order placed successfully." };
    } else {
       // Handle cases where MEXC returns a 200 OK but with an error message inside
       const errorMessage = orderResponse?.msg || "Unknown error from MEXC API.";
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
    aiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend'>,
    execute: boolean = false
) {
  try {
    const ohlcvData1m = generateChartData(100);
    const promptData1m = generateAIPromptData(ohlcvData1m);
    const trend15m = getHigherTimeframeTrend(ohlcvData1m);

    const fullAIInput: GetLLMTradingDecisionInput = {
      ...aiInput,
      ohlcvData: promptData1m,
      higherTimeframeTrend: trend15m,
    };

    const decision = await getLLMTradingDecision(fullAIInput);
    
    const latestPrice = ohlcvData1m[ohlcvData1m.length - 1].close;

    let executionResult = null;
    if (execute) { 
      // Only execute if confidence is >= 80% and it's not a HOLD action
      if (decision.action !== 'HOLD' && decision.confidence >= 0.8) {
        // Determine the size for closing trades. This logic needs the actual size of the open position.
        // We will pass `notional_usdt` as a placeholder for now.
        const positionSizeToClose = aiInput.currentPosition.status !== 'NONE' ? decision.notional_usdt : undefined;
        executionResult = await executeTrade(decision, positionSizeToClose);
        if (!executionResult.success) {
           // Return error from execution to be displayed on the UI
           return { data: decision, error: `Execution failed: ${executionResult.message}`, executionResult, latestPrice };
        }
      } else {
        // If confidence is too low or action is HOLD, treat as a non-executed event.
        const message = decision.action === 'HOLD' 
          ? 'AI decided to HOLD.'
          : `Execution skipped: Confidence (${(decision.confidence * 100).toFixed(1)}%) is below 80% threshold.`;
        console.log(message);
        // We modify the decision for logging purposes
        const loggedDecision = { ...decision, rationale: message, action: "HOLD" as const };
        return { data: loggedDecision, error: null, executionResult: { success: true, message }, latestPrice };
      }
    }
    
    return { data: decision, error: null, executionResult, latestPrice };
  } catch (error) {
    console.error("Error getting AI trading decision:", error);
    return { data: null, error: "Failed to get AI decision. Please try again.", executionResult: null, latestPrice: null };
  }
}
