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
  pair: z.string().describe('O par de negociação (ex: BTC/USDT).'),
  ohlcvData: z.string().describe('Um snapshot dos dados OHLCV e indicadores técnicos para o timeframe principal de negociação.'),
  higherTimeframeTrend: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe('A tendência dominante do timeframe de 15 minutos.'),
});
export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;

export const FindBestTradingOpportunityInputSchema = z.object({
  marketAnalyses: z.array(MarketAnalysisSchema).describe('Um array de dados de análise de mercado para cada par negociável.'),
  availableCapital: z.number().describe('O capital total disponível para negociação.'),
  riskPerTrade: z.number().describe('A porcentagem máxima de capital a arriscar em uma única operação (ex: 0.005 para 0.5%).'),
});
export type FindBestTradingOpportunityInput = z.infer<typeof FindBestTradingOpportunityInputSchema>;

export const FindBestTradingOpportunityOutputSchema = z.object({
  bestPair: z.string().describe("O par de negociação selecionado como a melhor oportunidade, ou 'NONE' se nenhuma oportunidade adequada for encontrada."),
  action: z.enum(['BUY', 'SELL', 'HOLD']).describe("A ação de alto nível recomendada para o melhor par. 'HOLD' se nenhum par for selecionado."),
  confidence: z.number().min(0).max(1).describe('O nível de confiança (0-1) na oportunidade selecionada.'),
  rationale: z.string().describe('Uma explicação concisa do motivo pelo qual este par foi escolhido (ou por que nenhum par foi escolhido), fazendo referência aos dados de mercado e à tendência.'),
});
export type FindBestTradingOpportunityOutput = z.infer<typeof FindBestTradingOpportunityOutputSchema>;

export async function findBestTradingOpportunity(input: FindBestTradingOpportunityInput): Promise<FindBestTradingOpportunityOutput> {
    return findBestTradingOpportunityFlow(input);
}

const watcherPrompt = ai.definePrompt({
    name: 'findBestTradingOpportunityPrompt',
    input: {schema: FindBestTradingOpportunityInputSchema},
    output: {schema: FindBestTradingOpportunityOutputSchema, format: 'json'},
    prompt: `Você é um analista de trading especialista, o "Watcher". Seu trabalho é monitorar uma lista de criptoativos e identificar a única e melhor oportunidade de negociação, com a mais alta probabilidade, neste momento.

    Você receberá uma lista de análises de mercado para vários pares de negociação.

    **Sua Tarefa:**
    1.  **Analisar Cada Par:** Revise os dados de mercado fornecidos e a tendência de 15 minutos para cada par.
    2.  **Comparar Oportunidades:** Compare as configurações potenciais entre todos os pares. Procure o caso mais convincente. Uma ótima configuração tem um padrão claro, confirmação de indicadores e está alinhada com a tendência do timeframe superior.
    3.  **Selecionar o Melhor:** Escolha apenas UM par que apresente a oportunidade mais promissora (seja LONG ou SHORT).
    4.  **Ou, Manter:** Se nenhum par mostrar uma configuração clara e de alta probabilidade, você DEVE escolher 'NONE' para bestPair e 'HOLD' para a ação. É melhor perder uma oportunidade do que fazer uma má negociação.

    **Regra Principal: RESPEITE A TENDÊNCIA DO TIMEFRAME SUPERIOR.**
    - Se a tendência de 15m for de ALTA, considere apenas oportunidades de 'COMPRA' (LONG).
    - Se a tendência de 15m for de BAIXA, considere apenas oportunidades de 'VENDA' (SHORT).
    - Se a tendência de 15m for LATERAL, seja extremamente seletivo. A configuração deve ser excepcionalmente forte.
    
    **Sua resposta deve ser sempre em português.**

    **Análises de Mercado:**
    {{#each marketAnalyses}}
    ---
    **Par: {{{this.pair}}}**
    - Tendência 15m: {{{this.higherTimeframeTrend}}}
    - Dados de Mercado 1m: {{{this.ohlcvData}}}
    ---
    {{/each}}

    Com base em sua análise comparativa, forneça sua decisão no formato JSON especificado. Sua justificativa (rationale) deve ser breve e declarar claramente por que você escolheu um par específico (ou por que escolheu manter).
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
    
