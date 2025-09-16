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
  action: z.enum(['BUY', 'HOLD']).describe("A ação de alto nível recomendada. Apenas 'BUY' para uma nova oportunidade ou 'HOLD'."),
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
    prompt: `Você é um analista de trading especialista em mercado SPOT, o "Watcher". Seu trabalho é monitorar uma lista de criptoativos e identificar a única e melhor oportunidade de COMPRA, com a mais alta probabilidade, neste momento.

    Você receberá uma lista de análises de mercado para vários pares de negociação. Você só opera no mercado SPOT, o que significa que você só pode comprar ativos com a expectativa de que eles se valorizem.

    **Sua Tarefa:**
    1.  **Analisar Cada Par:** Revise os dados de mercado fornecidos e a tendência de 15 minutos para cada par.
    2.  **Comparar Oportunidades de Compra:** Compare as configurações potenciais entre todos os pares. Procure o caso mais convincente para uma COMPRA.
    3.  **Selecionar o Melhor:** Escolha apenas UM par que apresente a oportunidade de COMPRA mais promissora.
    4.  **Ou, Manter:** Se nenhum par mostrar uma configuração de compra clara e de alta probabilidade, você DEVE escolher 'NONE' para bestPair e 'HOLD' para a ação. É melhor não negociar do que fazer uma má compra.

    **Regra Principal: SÓ COMPRE EM TENDÊNCIA DE ALTA.**
    - Se a tendência de 15m for de ALTA (UP), você pode considerar uma oportunidade de 'BUY'. Esta é a condição principal.
    - Se a tendência de 15m for de BAIXA (DOWN) ou LATERAL (SIDEWAYS), você NÃO DEVE comprar. Ignore quaisquer sinais de compra nesses pares. A ação para eles é 'HOLD'.
    
    **Sua resposta deve ser sempre em português.**

    **Análises de Mercado:**
    {{#each marketAnalyses}}
    ---
    **Par: {{{this.pair}}}**
    - Tendência 15m: {{{this.higherTimeframeTrend}}}
    - Dados de Mercado 1m: {{{this.ohlcvData}}}
    ---
    {{/each}}

    Com base em sua análise comparativa, forneça sua decisão no formato JSON especificado. Sua justificativa (rationale) deve ser breve e declarar claramente por que você escolheu um par específico para comprar, ou por que escolheu não fazer nada.
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
    
