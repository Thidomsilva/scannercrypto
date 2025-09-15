'use server';
/**
 * @fileOverview A LLM powered trading decisions AI agent.
 *
 * - getLLMTradingDecision - A function that handles the trading decision process.
 * - GetLLMTradingDecisionInput - The input type for the getLLMTradingDecision function.
 * - GetLLMTradingDecisionOutput - The return type for the getLLMTradingDecision function.
 */

import {ai} from '@/ai/genkit';
import {GenerateResponse} from 'genkit/generate';
import {z} from 'genkit';

const GetLLMTradingDecisionInputSchema = z.object({
  pair: z.string().describe('The trading pair to analyze (e.g., BTC/USDT).'),
  ohlcvData: z.string().describe('A snapshot of OHLCV data and technical indicators for the primary trading timeframe.'),
  higherTimeframeTrend: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe('The dominant trend from the 15-minute timeframe.'),
  availableCapital: z.number().describe('The total available capital for trading.'),
  riskPerTrade: z.number().describe('The maximum percentage of capital to risk on a single trade (e.g., 0.005 for 0.5%).'),
  currentPosition: z.object({
    status: z.enum(['NONE', 'LONG', 'SHORT']).describe('The current position status.'),
    entryPrice: z.number().optional().describe('The entry price of the current position, if any.'),
    pnlPercent: z.number().optional().describe('The unrealized PnL percentage of the current position.'),
    size: z.number().optional().describe('The size of the current position in USDT.'),
    pair: z.string().optional().describe('The asset pair of the current position.')
  }).describe('The current state of the trading position.'),
  watcherRationale: z.string().optional().describe('The rationale from the watcher AI for why this pair was chosen. Use this for additional context.')
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
  prompt: `You are an expert quantitative trading analyst, the "Executor". Your partner, the "Watcher", has already analyzed multiple assets and selected {{{pair}}} as the best opportunity.
  
  {{#if watcherRationale}}
  **Watcher's Rationale:** *{{{watcherRationale}}}*
  {{/if}}

  Your task is to conduct a final, detailed analysis on **{{{pair}}}** and determine the precise execution action.

  **PRIMARY RULE: NEVER OPERATE AGAINST THE HIGHER TIMEFRAME TREND.**
  - The dominant market trend is determined by the 15-minute timeframe.
  - The current 15-minute trend is: **{{{higherTimeframeTrend}}}**
  - **If the 15m trend is UP**, and you are opening a new position, you are ONLY allowed to use a 'BUY' action.
  - **If the 15m trend is DOWN**, and you are opening a new position, you are ONLY allowed to use a 'SELL' action.
  - **If the 15m trend is SIDEWAYS**, be extra cautious. Only open new positions if there is an extremely clear, high-probability setup. Otherwise, 'HOLD'.
  - This rule applies ONLY to opening new positions. You can close an existing position at any time.

  **Current Position Status:**
  - Status: {{{currentPosition.status}}}
  {{#if currentPosition.entryPrice}}
  - Pair: {{{currentPosition.pair}}}
  - Entry Price: {{{currentPosition.entryPrice}}}
  - Size: {{{currentPosition.size}}} USDT
  - Unrealized PnL: {{{currentPosition.pnlPercent}}}%
  {{/if}}

  **Your Logic Must Follow These Rules:**
  1.  **If Current Position is 'NONE':** You are clear to open a new position on {{{pair}}}. Follow the primary rule regarding the higher timeframe trend. Analyze the market data to find a high-probability entry point. If no clear opportunity aligned with the trend exists, your action is 'HOLD'.
  2.  **If Current Position is for a DIFFERENT asset ({{{currentPosition.pair}}}):** Your action for {{{pair}}} must be 'HOLD', as you can only manage one position at a time.
  3.  **If Current Position is 'LONG' on {{{pair}}}:** Analyze if the upward trend is continuing or reversing.
      - If the trend is weakening or a reversal is detected, your action should be 'SELL' to close the position.
      - If the trend remains strong, your action is 'HOLD'. Do not issue a 'BUY' action.
  4.  **If Current Position is 'SHORT' on {{{pair}}}:** Analyze if the trend is continuing or reversing.
      - If the downward trend is weakening or a reversal is detected, your action should be 'BUY' to close the position.
      - If the trend remains strong, your action is 'HOLD'. Do not issue a 'SELL' action.

  **Risk Management:**
  - The 'notional_usdt' for a NEW trade is calculated as: \`availableCapital * riskPerTrade\`.
  - When closing a position, 'notional_usdt' should be the full size of the position ({{{currentPosition.size}}}).
  - If your action is 'HOLD', 'notional_usdt' must be 0.
  - Your rationale must be concise, data-driven, and reference specific indicators.

  **Market & Risk Data for {{{pair}}}:**
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
    // If we have a position on a different asset, we must hold on this one.
    if (input.currentPosition.status !== 'NONE' && input.currentPosition.pair !== input.pair) {
      return {
        pair: input.pair,
        action: 'HOLD',
        notional_usdt: 0,
        order_type: 'MARKET',
        confidence: 1,
        rationale: `Holding ${input.pair} as a position is already open on ${input.currentPosition.pair}.`
      }
    }
    
    const { output } = await runJsonPrompt(prompt, input);
    
    // Enforce risk management rule as a fallback
    if (output) {
      if(output.action === 'HOLD') {
        output.notional_usdt = 0;
      } else if (input.currentPosition.status === 'NONE') { // New position
        const maxNotional = input.availableCapital * input.riskPerTrade;
        if (output.notional_usdt > maxNotional || output.notional_usdt === 0) {
            output.notional_usdt = maxNotional;
            output.rationale = `[ADJUSTED] ${output.rationale}`;
        }
      } else { // Closing position
        if (input.currentPosition.size) {
            output.notional_usdt = input.currentPosition.size;
        }
      }
      // Ensure the output pair matches the input pair
      output.pair = input.pair;
    }
    return output!;
  }
);