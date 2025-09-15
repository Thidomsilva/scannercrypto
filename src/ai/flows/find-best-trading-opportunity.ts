/**
 * @fileOverview A Genkit flow that analyzes multiple markets to find the single best trading opportunity.
 *
 * - findBestTradingOpportunity - A function that handles the market analysis process.
 * - FindBestTradingOpportunityInput - The input type for the findBestTradingOpportunity function.
 * - FindBestTradingOpportunityOutput - The return type for the findBestTradingOpportunity function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';


export const MarketAnalysisSchema = z.object({
  pair: z.string().describe('The trading pair (e.g., BTC/USDT).'),
  ohlcvData: z.string().describe('A snapshot of OHLCV data and technical indicators for the primary trading timeframe.'),
  higherTimeframeTrend: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe('The dominant trend from the 15-minute timeframe.'),
});
export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;

export const FindBestTradingOpportunityInputSchema = z.object({
  marketAnalyses: z.array(MarketAnalysisSchema).describe('An array of market analysis data for each tradable pair.'),
  availableCapital: z.number().describe('The total available capital for trading.'),
  riskPerTrade: z.number().describe('The maximum percentage of capital to risk on a single trade (e.g., 0.005 for 0.5%).'),
});
export type FindBestTradingOpportunityInput = z.infer<typeof FindBestTradingOpportunityInputSchema>;

export const FindBestTradingOpportunityOutputSchema = z.object({
  bestPair: z.string().describe("The trading pair selected as the best opportunity, or 'NONE' if no suitable opportunity is found."),
  action: z.enum(['BUY', 'SELL', 'HOLD']).describe("The recommended high-level action for the best pair. 'HOLD' if no pair is selected."),
  confidence: z.number().min(0).max(1).describe('The confidence level (0-1) in the selected opportunity.'),
  rationale: z.string().describe('A concise explanation for why this pair was chosen (or why no pair was chosen), referencing the market data and trend.'),
});
export type FindBestTradingOpportunityOutput = z.infer<typeof FindBestTradingOpportunityOutputSchema>;

export async function findBestTradingOpportunity(input: FindBestTradingOpportunityInput): Promise<FindBestTradingOpportunityOutput> {
    return findBestTradingOpportunityFlow(input);
}

const watcherPrompt = ai.definePrompt({
    name: 'findBestTradingOpportunityPrompt',
    input: {schema: FindBestTradingOpportunityInputSchema},
    output: {schema: FindBestTradingOpportunityOutputSchema, format: 'json'},
    prompt: `You are an expert trading analyst, the "Watcher". Your job is to monitor a list of crypto assets and identify the single best, highest-probability trading opportunity right now.

    You will be given a list of market analyses for several trading pairs.

    **Your Task:**
    1.  **Analyze Each Pair:** Review the provided market data and 15-minute trend for each pair.
    2.  **Compare Opportunities:** Compare the potential setups across all pairs. Look for the most compelling case. A great setup has a clear pattern, confirmation from indicators, and aligns with the higher timeframe trend.
    3.  **Select the Best:** Choose only ONE pair that presents the most promising opportunity (either LONG or SHORT).
    4.  **Or, Hold:** If no pair shows a clear, high-probability setup, you MUST choose 'NONE' for the bestPair and 'HOLD' for the action. It is better to miss an opportunity than to take a bad trade.

    **Primary Rule: RESPECT THE HIGHER TIMEFRAME TREND.**
    - If the 15m trend is UP, only consider 'BUY' (LONG) opportunities.
    - If the 15m trend is DOWN, only consider 'SELL' (SHORT) opportunities.
    - If the 15m trend is SIDEWAYS, be extremely selective. The setup must be exceptionally strong.

    **Market Analyses:**
    {{#each marketAnalyses}}
    ---
    **Pair: {{{this.pair}}}**
    - 15m Trend: {{{this.higherTimeframeTrend}}}
    - 1m Market Data: {{{this.ohlcvData}}}
    ---
    {{/each}}

    Based on your comparative analysis, provide your decision in the specified JSON format. Your rationale should be brief and clearly state why you chose a specific pair (or why you chose to hold).
    `,
});

const findBestTradingOpportunityFlow = ai.defineFlow(
  {
    name: 'findBestTradingOpportunityFlow',
    inputSchema: FindBestTradingOpportunityInputSchema,
    outputSchema: FindBestTradingOpportunityOutputSchema,
  },
  async (input) => {
    const { output } = await watcherPrompt(input);
    return output!;
  }
);
    