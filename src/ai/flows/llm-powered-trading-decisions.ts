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
  prompt: `You are an expert algorithmic trading system. You analyze market data and provide trading recommendations.

  Analyze the following market data and provide a trading decision in JSON format.

  Data: {{{ohlcvData}}}

  Respond with a JSON object containing the following fields:
  - pair: The trading pair (e.g., BTC/USDT).
  - action: The recommended action (BUY, SELL, or HOLD).
  - notional_usdt: The notional value of the order in USDT.
  - order_type: The type of order to execute (MARKET or LIMIT).
  - stop_price: The stop-loss price (if applicable).  Omit if not applicable.
  - take_price: The take-profit price (if applicable). Omit if not applicable.
  - confidence: The confidence level of the decision (0-1).
  - rationale: A brief explanation of the decision.

  Example JSON Response:
  \`\`\`json
  {
  "pair": "BTC/USDT",
  "action": "BUY",
  "notional_usdt": 25,
  "order_type": "MARKET",
  "stop_price": 64000.0,
  "take_price": 66000.0,
  "confidence": 0.78,
  "rationale": "Based on recent price action and technical indicators, a buying opportunity is present."
  }
  \`\`\`
  Ensure the response is valid JSON and contains all required fields.`, // Ensure valid JSON response
});

const getLLMTradingDecisionFlow = ai.defineFlow(
  {
    name: 'getLLMTradingDecisionFlow',
    inputSchema: GetLLMTradingDecisionInputSchema,
    outputSchema: GetLLMTradingDecisionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
