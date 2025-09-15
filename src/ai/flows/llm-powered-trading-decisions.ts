'use server';
/**
 * @fileOverview A LLM powered trading decisions AI agent.
 *
 * - getLLMTradingDecision - A function that handles the trading decision process.
 * - GetLLMTradingDecisionInput - The input type for the getLLMTradingDecision function.
 * - GetLLMTradingDecisionOutput - The return type for the getLLMTradingDecision function.
 */

import {ai} from '@/ai/genkit';
import {generate, GenerateResponse, GenerationCommon, Part} from 'genkit/generate';
import {z} from 'genkit';

const GetLLMTradingDecisionInputSchema = z.object({
  ohlcvData: z.string().describe('A snapshot of OHLCV data and technical indicators for the primary trading timeframe.'),
  higherTimeframeTrend: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe('The dominant trend from the 15-minute timeframe.'),
  availableCapital: z.number().describe('The total available capital for trading.'),
  riskPerTrade: z.number().describe('The maximum percentage of capital to risk on a single trade (e.g., 0.005 for 0.5%).'),
  currentPosition: z.object({
    status: z.enum(['NONE', 'LONG', 'SHORT']).describe('The current position status.'),
    entryPrice: z.number().optional().describe('The entry price of the current position, if any.'),
    pnlPercent: z.number().optional().describe('The unrealized PnL percentage of the current position.'),
    size: z.number().optional().describe('The size of the current position in USDT.')
  }).describe('The current state of the trading position.')
});
export type GetLLMTradingDecisionInput = z.infer<typeof GetLLMTradingDecisionInputSchema>;

const GetLLMTradingDecisionOutputSchema = z.object({
  pair: z.string().describe('The trading pair (e.g., BTC/USDT).'),
  action: z.enum(['BUY', 'SELL', 'HOLD']).describe('The recommended action. If position is NONE, BUY opens a LONG and SELL opens a SHORT. If position is LONG, a SELL action closes it. If position is SHORT, a BUY action closes it.'),
  notional_usdt: z.number().describe('The notional value of the order in USDT.'),
  order_type: z.enum(['MARKET', 'LIMIT']).describe('The type of order to execute.'),
  stop_price: z.number().optional().describe('The stop-loss price (if applicable).'),
  take_price: z.number().optional().describe('The take-profit price (if applicable).'),
  confidence: z.number().describe('The confidence level of the decision (0-1).'),
  rationale: z.string().describe('A brief explanation of the decision, considering the current position status and higher timeframe trend.'),
});
export type GetLLMTradingDecisionOutput = z.infer<typeof GetLLMTradingDecisionOutputSchema>;

export async function getLLMTradingDecision(input: GetLLMTradingDecisionInput): Promise<GetLLMTradingDecisionOutput> {
  return getLLMTradingDecisionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'getLLMTradingDecisionPrompt',
  input: {schema: GetLLMTradingDecisionInputSchema},
  output: {schema: GetLLMTradingDecisionOutputSchema, format: 'json'},
  prompt: `You are an expert quantitative trading analyst operating as a complete trading system. Your task is to analyze market data, consider the current position, and provide a clear trading recommendation.

  **PRIMARY RULE: NEVER OPERATE AGAINST THE HIGHER TIMEFRAME TREND.**
  - The dominant market trend is determined by the 15-minute timeframe.
  - The current 15-minute trend is: **{{{higherTimeframeTrend}}}**
  - **If the 15m trend is UP**, you are ONLY allowed to open a new position with a 'BUY' action. You are FORBIDDEN from opening a new 'SELL' (SHORT) position.
  - **If the 15m trend is DOWN**, you are ONLY allowed to open a new position with a 'SELL' action. You are FORBIDDEN from opening a new 'BUY' (LONG) position.
  - **If the 15m trend is SIDEWAYS**, be extra cautious. Only open new positions if there is an extremely clear, high-probability setup. Otherwise, 'HOLD'.
  - This rule applies ONLY to opening new positions. You can close an existing position at any time.

  **Current Position Status:**
  - Status: {{{currentPosition.status}}}
  {{#if currentPosition.entryPrice}}
  - Entry Price: {{{currentPosition.entryPrice}}}
  - Size: {{{currentPosition.size}}} USDT
  - Unrealized PnL: {{{currentPosition.pnlPercent}}}%
  {{/if}}

  **Your Logic Must Follow These Rules (after respecting the primary rule):**
  1.  **If Current Position is 'NONE':** Following the higher timeframe trend rule, analyze the market data to find a high-probability entry point. If no clear opportunity aligned with the trend exists, your action is 'HOLD'.
  2.  **If Current Position is 'LONG':** Analyze if the upward trend is continuing or reversing.
      - If the trend is weakening or a reversal is detected, your action should be 'SELL' to close the position and realize profits/losses.
      - If the trend remains strong, your action is 'HOLD'. Do not issue a 'BUY' action.
  3.  **If Current Position is 'SHORT':** Analyze if the trend is continuing or reversing.
      - If the downward trend is weakening or a reversal is detected, your action should be 'BUY' to close the position and realize profits/losses.
      - If the trend remains strong, your action is 'HOLD'. Do not issue a 'SELL' action.

  **Risk Management:**
  - The 'notional_usdt' for a NEW trade (opening a position) is calculated as: \`availableCapital * riskPerTrade\`.
  - When closing a position, 'notional_usdt' should reflect the full size of the position to be closed. For this simulation, set it to the position's original size ({{{currentPosition.size}}}).
  - If your action is 'HOLD', 'notional_usdt' must be 0.
  - Your rationale must be concise, data-driven, and reference specific indicators, justifying your decision in the context of the current position AND the higher timeframe trend.

  **Market & Risk Data:**
  - Market Data Snapshot (1-minute): {{{ohlcvData}}}
  - 15-Minute Trend: {{{higherTimeframeTrend}}}
  - Available Capital: {{{availableCapital}}} USDT
  - Max Risk Per Trade: {{{riskPerTrade}}}

  Analyze all the data and provide your trading decision in the specified JSON format.
  `,
});

async function runJsonPrompt(
  prompt: (input: GetLLMTradingDecisionInput) => Promise<GenerateResponse<z.infer<typeof GetLLMTradingDecisionOutputSchema>>>,
  input: GetLLMTradingDecisionInput,
  retries = 1
): Promise<GenerateResponse<GetLLMTradingDecisionOutput>> {
  let lastError: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await prompt(input);
    } catch (e: any) {
      lastError = e;
      console.log(`LLM-JSON-PROMPT: Failed on try ${i}, retrying.`, e);
      // In the retry, we pass the error to the prompt so the model can self-correct.
      (input as any).error = e.message;
    }
  }
  throw lastError;
}


const getLLMTradingDecisionFlow = ai.defineFlow(
  {
    name: 'getLLMTradingDecisionFlow',
    inputSchema: GetLLMTradingDecisionInputSchema,
    outputSchema: GetLLMTradingDecisionOutputSchema,
  },
  async input => {
    const { output } = await runJsonPrompt(prompt, input);
    
    // Enforce risk management rule as a fallback
    if (output) {
      if(output.action === 'HOLD') {
        output.notional_usdt = 0;
      } else if (input.currentPosition.status === 'NONE') { // New position
        const maxNotional = input.availableCapital * input.riskPerTrade;
        if (output.notional_usdt > maxNotional) {
            output.notional_usdt = maxNotional;
            output.rationale = `[ADJUSTED] ${output.rationale}`;
        }
      } else { // Closing position
        if (input.currentPosition.size) {
            output.notional_usdt = input.currentPosition.size;
        }
      }
    }
    return output!;
  }
);
