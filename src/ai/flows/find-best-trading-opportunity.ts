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

    Você opera com um princípio fundamental: **"Trend is your friend"**, mas sabe que as melhores oportunidades podem surgir em reversões.

    **Sua Tarefa:**
    1.  **Analisar a Tendência de 15m (Contexto Principal):**
        - **Tendência 'UP':** Excelente. Este é o cenário ideal. Procure por sinais de continuação (pullbacks em EMAs, rompimentos) nos dados de 1m (ohlcvData).
        - **Tendência 'SIDEWAYS' ou 'DOWN':** Requer mais cautela, mas pode apresentar as melhores oportunidades de reversão.

    2.  **Analisar a Ação do Preço e Indicadores (1m):**
        - Examine os dados de candle (fullOhlcvData) e os indicadores técnicos (ohlcvData) para encontrar uma confluência de sinais de alta.
        - **Cenário 1 (Continuação de Tendência):** Se a tendência de 15m é 'UP', um pullback que respeita uma MME (como a EMA 20 ou 50) e mostra um candle de reversão (martelo, engolfo de alta) é um sinal forte.
        - **Cenário 2 (Reversão de Tendência):** Se a tendência de 15m é 'SIDEWAYS' ou 'DOWN', procure por sinais **claros e fortes** de que o preço está revertendo para alta. Exemplos: um fundo duplo, um rompimento de uma linha de tendência de baixa (LTA), um OCO invertido (OCOI), ou uma forte divergência de alta no RSI. A confiança aqui deve ser alta apenas se a estrutura de baixa for claramente quebrada.

    3.  **Pontuação de Confiança (confidence):**
        - **Confiança ~0.9-1.0:** Sinal "perfeito". Confluência de múltiplos fatores. Ex: Tendência de 15m 'UP' + pullback na EMA com candle de reversão forte + volume crescente. Ou, uma reversão muito clara e confirmada em 1m.
        - **Confiança ~0.7-0.8:** Bom sinal, mas não perfeito. Ex: Tendência de 15m 'UP' com um bom gatilho de entrada no 1m, ou uma reversão provável, mas que ainda precisa de mais uma confirmação.
        - **Confiança ~0.5-0.6:** Sinal fraco ou ambíguo. A tendência de 15m pode ser favorável, mas o sinal de entrada no 1m é incerto.
        - **Confiança < 0.5:** Nenhum sinal de entrada claro.

    4.  **Decidir a Ação e Justificar:**
        - Se a confiança for maior ou igual a 0.7, a ação deve ser 'BUY'.
        - Se a confiança for menor que 0.7, a ação deve ser 'NONE'.
        - A justificativa (rationale) deve ser breve (1-2 frases) e explicar a pontuação, mencionando os principais fatores técnicos que levaram à decisão (ex: "Pullback na EMA 50 em tendência de alta" ou "Reversão com fundo duplo e rompimento de LTB").

    **Regra Principal: A qualidade do sinal de entrada no gráfico de 1 minuto é soberana.**

    **Sua resposta deve ser sempre em português.**

    **Análise de Mercado para {{{marketAnalysis.pair}}}:**
    - Par: {{{marketAnalysis.pair}}}
    - Tendência 15m: {{{marketAnalysis.higherTimeframeTrend}}}
    - Dados Completos de Candles (1m): {{{marketAnalysis.fullOhlcvData}}}
    - Indicadores Técnicos (1m): {{{marketAnalysis.ohlcvData}}}

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
