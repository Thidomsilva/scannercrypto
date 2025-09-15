"use server";

import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { generateChartData, generateAIPromptData } from "@/lib/mock-data";

export async function getAIDecisionAction() {
  try {
    const ohlcvData = generateChartData(200);
    const promptData = generateAIPromptData(ohlcvData);

    const decision = await getLLMTradingDecision({
      ohlcvData: promptData,
    });
    
    return { data: decision, error: null };
  } catch (error) {
    console.error("Error getting AI trading decision:", error);
    return { data: null, error: "Failed to get AI decision. Please try again." };
  }
}
