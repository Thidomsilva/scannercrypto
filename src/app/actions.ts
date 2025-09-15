"use server";

import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { generateChartData, generateAIPromptData } from "@/lib/mock-data";
import { createOrder } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionOutput } from "@/ai/flows/llm-powered-trading-decisions";

async function executeTrade(decision: GetLLMTradingDecisionOutput) {
  if (decision.action === "HOLD") {
    console.log("AI Decision: HOLD. No order placed.");
    return { success: true, orderId: null, message: "HOLD decision, no order placed." };
  }

  // Ensure notional value is a string with appropriate precision for the API
  const notionalString = decision.notional_usdt.toFixed(2);
  
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
      type: "MARKET", // For simplicity, starting with MARKET orders
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
    capital: number,
    riskPerTrade: number, 
    execute: boolean = false
) {
  try {
    const ohlcvData = generateChartData(100); // Provide more historical data
    const promptData = generateAIPromptData(ohlcvData);

    const decision = await getLLMTradingDecision({
      ohlcvData: promptData,
      availableCapital: capital,
      riskPerTrade: riskPerTrade,
    });

    let executionResult = null;
    if (execute) { // Always attempt execution logic if `execute` is true
      executionResult = await executeTrade(decision);
      if (!executionResult.success) {
         // Return error from execution to be displayed on the UI
         return { data: decision, error: `Execution failed: ${executionResult.message}`, executionResult };
      }
    }
    
    return { data: decision, error: null, executionResult };
  } catch (error) {
    console.error("Error getting AI trading decision:", error);
    return { data: null, error: "Failed to get AI decision. Please try again.", executionResult: null };
  }
}
