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

  try {
    const orderParams = {
      symbol: decision.pair.replace("/", ""), // "BTC/USDT" -> "BTCUSDT"
      side: decision.action, // "BUY" or "SELL"
      type: "MARKET", // For simplicity, starting with MARKET orders
      quoteOrderQty: decision.notional_usdt.toString(),
    };
    
    console.log("Placing order with params:", orderParams);
    const orderResponse = await createOrder(orderParams);
    console.log("MEXC Order Response:", orderResponse);
    
    return { success: true, orderId: orderResponse.orderId, message: "Order placed successfully." };
  } catch (error: any) {
    console.error("Failed to execute trade on MEXC:", error.response?.data || error.message);
    return { success: false, orderId: null, message: error.response?.data?.msg || error.message || "Failed to place order." };
  }
}

export async function getAIDecisionAction(execute: boolean = false) {
  try {
    const ohlcvData = generateChartData(200);
    const promptData = generateAIPromptData(ohlcvData);

    const decision = await getLLMTradingDecision({
      ohlcvData: promptData,
    });

    let executionResult = null;
    if (execute && decision.action !== "HOLD") {
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
