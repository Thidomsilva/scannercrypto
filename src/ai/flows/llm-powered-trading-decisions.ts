'use server';
/**
 * @fileOverview A LLM powered trading decisions AI agent.
 *
 * - getLLMTradingDecision - A function that handles the trading decision process.
 * - GetLLMTradingDecisionInput - The input type for the getLLMTradingDecision function.
 * - GetLLMTradingDecisionOutput - The return type for the getLLMTradingDecision function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GetLLMTradingDecisionInputSchema = z.object({
  ohlcvData: z.string().describe('A snapshot of OHLCV data and technical indicators.'),
  availableCapital: z.number().describe('The total available capital for trading.'),
  riskPerTrade: z.number().describe('The maximum percentage of capital to risk on a single trade (e.g., 0.005 for 0.5%).'),
});
export type GetLLMTradingDecisionInput = z.infer<typeof GetLLMTradingDecisionInputSchema>;

const GetLLMTradingDecisionOutputSchema = z.object({
  pair: z.string().describe('The trading pair (e.g., BTC/USDT).'),
  action: z.enum(['BUY', 'SELL', 'HOLD']).describe('The recommended action.'),
  notional_usdt: z.number().describe('The notional value of the order in USDT.'),
  order_type: z.enum(['MARKET', 'LIMIT']).describe('The type of order to execute.'),
  stop_price: z.number().optional().describe('The stop-loss price (if applicable).'),
  take_price: z.number().optional().describe('The take-profit price (if applicable).'),
  confidence: z.number().describe('The confidence level of the decision (0-1).'),
  rationale: z.string().describe('A brief explanation of the decision.'),
});
export type GetLLMTradingDecisionOutput = z.infer<typeof GetLLMTradingDecisionOutputSchema>;

export async function getLLMTradingDecision(input: GetLLMTradingDecisionInput): Promise<GetLLMTradingDecisionOutput> {
  return getLLMTradingDecisionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'getLLMTradingDecisionPrompt',
  input: {schema: GetLLMTradingDecisionInputSchema},
  output: {schema: GetLLMTradingDecisionOutputSchema},
  prompt: `You are an expert quantitative trading analyst. Your task is to analyze market data and provide a trading recommendation with a high degree of accuracy and risk awareness.

  You must adhere to strict risk management rules:
  1. The notional value of any trade ('notional_usdt') MUST NOT exceed the maximum allowed risk.
  2. Calculate the 'notional_usdt' based on the 'availableCapital' and 'riskPerTrade' percentage. The formula is: notional_usdt = availableCapital * riskPerTrade.
  3. If you decide to 'HOLD', the 'notional_usdt' must be 0.
  4. Your rationale should be concise, data-driven, and reference specific indicators or patterns from the data provided.

  Analyze the following market data and risk parameters, then provide a trading decision in the specified JSON format.

  Market Data Snapshot:
  {{{ohlcvData}}}
  
  Risk Parameters:
  - Available Capital: {{{availableCapital}}} USDT
  - Max Risk Per Trade: {{{riskPerTrade}}}

  Your analysis should consider the interplay between price action, volume, momentum oscillators (RSI), trend indicators (EMAs, ADX), and volatility (ATR, Bollinger Bands).

  Respond with a valid JSON object.`,
});

const getLLMTradingDecisionFlow = ai.defineFlow(
  {
    name: 'getLLMTradingDecisionFlow',
    inputSchema: GetLLMTradingDecisionInputSchema,
    outputSchema: GetLLMTradingDecisionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    // Enforce risk management rule as a fallback
    const maxNotional = input.availableCapital * input.riskPerTrade;
    if (output && output.notional_usdt > maxNotional) {
        output.notional_usdt = maxNotional;
        output.rationale = `[ADJUSTED] ${output.rationale}`;
    }
    if(output && output.action === 'HOLD') {
        output.notional_usdt = 0;
    }
    return output!;
  }
);
