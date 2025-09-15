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
  currentPosition: z.object({
    status: z.enum(['NONE', 'LONG', 'SHORT']).describe('The current position status.'),
    entryPrice: z.number().optional().describe('The entry price of the current position, if any.'),
    pnlPercent: z.number().optional().describe('The unrealized PnL percentage of the current position.')
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
  rationale: z.string().describe('A brief explanation of the decision, considering the current position status.'),
});
export type GetLLMTradingDecisionOutput = z.infer<typeof GetLLMTradingDecisionOutputSchema>;

export async function getLLMTradingDecision(input: GetLLMTradingDecisionInput): Promise<GetLLMTradingDecisionOutput> {
  return getLLMTradingDecisionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'getLLMTradingDecisionPrompt',
  input: {schema: GetLLMTradingDecisionInputSchema},
  output: {schema: GetLLMTradingDecisionOutputSchema},
  prompt: `You are an expert quantitative trading analyst operating as a complete trading system. Your task is to analyze market data, consider the current position, and provide a clear trading recommendation.

  **Current Position Status:**
  - Status: {{{currentPosition.status}}}
  {{#if currentPosition.entryPrice}}
  - Entry Price: {{{currentPosition.entryPrice}}}
  - Unrealized PnL: {{{currentPosition.pnlPercent}}}%
  {{/if}}

  **Your Logic Must Follow These Rules:**
  1.  **If Current Position is 'NONE':** Analyze the market to find a high-probability entry point. Your action can be 'BUY' to open a LONG position, or 'SELL' to open a SHORT position. If no clear opportunity exists, your action is 'HOLD'.
  2.  **If Current Position is 'LONG':** Analyze if the trend is continuing or reversing.
      - If the upward trend is weakening or a reversal is detected, your action should be 'SELL' to close the position and realize profits/losses.
      - If the trend remains strong, your action is 'HOLD'. Do not issue a 'BUY' action.
  3.  **If Current Position is 'SHORT':** Analyze if the trend is continuing or reversing.
      - If the downward trend is weakening or a reversal is detected, your action should be 'BUY' to close the position and realize profits/losses.
      - If the trend remains strong, your action is 'HOLD'. Do not issue a 'SELL' action.

  **Risk Management:**
  - The 'notional_usdt' for a NEW trade (opening a position) is calculated as: \`availableCapital * riskPerTrade\`.
  - When closing a position, 'notional_usdt' should reflect the full size of the position to be closed. For this simulation, you can set it to the initial notional value.
  - If your action is 'HOLD', 'notional_usdt' must be 0.
  - Your rationale must be concise, data-driven, and reference specific indicators from the data provided, justifying your decision in the context of the current position.

  **Market & Risk Data:**
  - Market Data Snapshot: {{{ohlcvData}}}
  - Available Capital: {{{availableCapital}}} USDT
  - Max Risk Per Trade: {{{riskPerTrade}}}

  Analyze all the data and provide your trading decision in the specified JSON format.
  `,
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
    if (output) {
      if(output.action === 'HOLD') {
        output.notional_usdt = 0;
      } else if (input.currentPosition.status === 'NONE') {
        const maxNotional = input.availableCapital * input.riskPerTrade;
        if (output.notional_usdt > maxNotional) {
            output.notional_usdt = maxNotional;
            output.rationale = `[ADJUSTED] ${output.rationale}`;
        }
      }
    }
    return output!;
  }
);
