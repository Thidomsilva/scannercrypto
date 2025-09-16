/**
 * @fileOverview A Genkit flow that analyzes a single market to evaluate its trading opportunity.
 *
 * - findBestTradingOpportunity - A function that handles the market analysis process.
 * - FindBestTradingOpportunityInput - The input type for the findBestTradingOpportunity function.
 * - FindBestTradingOpportunityOutput - The return type for the findBestTradingOpportunity function.
 */

'use server';

import {ai} from '@/ai/genkit';
import { runAIPromptWithRetry } from '@/ai/utils';
import type { FindBestTradingOpportunityInput, FindBestTradingOpportunityOutput } from '@/ai/schemas';
import { FindBestTradingOpportunityInputSchema, FindBestTradingOpportunityOutputSchema } from '@/ai/schemas';


export async function findBestTradingOpportunity(input: FindBestTradingOpportunityInput): Promise<FindBestTradingOpportunityOutput> {
    return findBestTradingOpportunityFlow(input);
}

const watcherPrompt = ai.definePrompt({
    name: 'findBestTradingOpportunityPrompt',
    input: {schema: FindBestTradingOpportunityInputSchema},
    output: {schema: FindBestTradingOpportunityOutputSchema},
    prompt: `Você é um analista de trading especialista em mercado SPOT, o "Watcher". Seu trabalho é analisar um ÚNICO criptoativo e avaliar a qualidade da oportunidade de COMPRA neste momento, retornando uma pontuação de 0 a 1.

    Você opera com um princípio fundamental: **"Trend is your friend"**. Você só busca oportunidades de compra em ativos que demonstram uma clara tendência de alta no timeframe de 15 minutos.

    **Sua Tarefa:**
    1.  **Verificar a Tendência de 15m:**
        - Se a tendência de 15m (higherTimeframeTrend) NÃO for 'UP', a oportunidade é inválida. Sua pontuação de confiança (confidence) DEVE ser 0.
    2.  **Analisar a Confluência (se a tendência for 'UP'):**
        - Analise os dados de 1m (ohlcvData). Procure por sinais de **continuação ou início de força de alta**. Isso pode ser um rompimento de uma pequena resistência, um pullback para uma média móvel (EMA) que está sendo respeitada, ou um padrão de candlestick de alta.
        - A sua pontuação de 'confidence' deve refletir a qualidade e clareza dessa configuração de entrada.
          - **Confiança ~0.9-1.0:** Sinal perfeito. Tendência de 15m 'UP' forte e um gatilho de entrada claríssimo no 1m. Ex: pullback e repique na EMA, com volume.
          - **Confiança ~0.7-0.8:** Bom sinal. Tendência de 15m 'UP' e um gatilho de entrada razoável, mas não perfeito.
          - **Confiança ~0.5-0.6:** Sinal fraco. A tendência de 15m é 'UP', mas o sinal de entrada no 1m é ambíguo ou fraco.
          - **Confiança < 0.5:** Nenhum sinal de entrada claro, apesar da tendência de 15m.
    3.  **Decidir a Ação e Justificar:**
        - Se a confiança for maior ou igual a 0.7, a ação deve ser 'BUY'.
        - Se a confiança for menor que 0.7, a ação deve ser 'NONE'.
        - A justificativa (rationale) deve ser breve (1 frase) e explicar a pontuação, mencionando a clareza do sinal de entrada no 1m em relação à tendência de 15m.

    **Regra Principal: SÓ COMPRE EM TENDÊNCIA DE ALTA (15m 'UP').**

    **Sua resposta deve ser sempre em português.**

    **Análise de Mercado para {{{marketAnalysis.pair}}}:**
    - Par: {{{marketAnalysis.pair}}}
    - Tendência 15m: {{{marketAnalysis.higherTimeframeTrend}}}
    - Dados de Mercado 1m: {{{marketAnalysis.ohlcvData}}}

    Com base na sua análise, forneça sua decisão no formato JSON especificado. O campo 'bestPair' deve ser sempre preenchido com o par analisado: {{{marketAnalysis.pair}}}.
    `,
});

const findBestTradingOpportunityFlow = ai.defineFlow(
  {
    name: 'findBestTradingOpportunityFlow',
    inputSchema: FindBestTradingOpportunityInputSchema,
    outputSchema: FindBestTradingOpportunityOutputSchema,
  },
  async (input) => {
    const aiResponse = await runAIPromptWithRetry(watcherPrompt, input);
    
    // Ensure the output pair matches the input pair, as the AI can sometimes fail to set it.
    const finalOutput: FindBestTradingOpportunityOutput = {
      ...aiResponse,
      bestPair: input.marketAnalysis.pair,
    };
    
    return finalOutput;
  }
);
    