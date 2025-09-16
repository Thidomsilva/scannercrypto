/**
 * @fileOverview A Genkit flow that analyzes multiple markets to find the single best trading opportunity.
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
    prompt: `Você é um analista de trading especialista em mercado SPOT, o "Watcher". Seu trabalho é monitorar uma lista de criptoativos e identificar a única e melhor oportunidade de COMPRA, com a mais alta probabilidade, neste momento.

    Você opera com um princípio fundamental: **"Trend is your friend"**. Você só busca oportunidades de compra em ativos que demonstram uma clara tendência de alta no timeframe de 15 minutos.

    **Sua Tarefa:**
    1.  **Filtrar por Tendência:** Ignore imediatamente qualquer par cuja tendência de 15m não seja 'UP'.
    2.  **Analisar a Confluência:** Para os pares restantes (com tendência 'UP'), analise os dados de 1m. Procure por sinais de **continuação ou início de força de alta**. Isso pode ser um rompimento de uma pequena resistência, um pullback para uma média móvel (EMA) que está sendo respeitada, ou um padrão de candlestick de alta.
    3.  **Selecionar a Melhor Oportunidade:** Escolha o par que apresenta a **confluência mais forte e clara** entre a tendência de alta de 15m e o sinal de entrada no 1m. Este é o seu critério para a "melhor" oportunidade. A confiança deve refletir a qualidade e clareza dessa configuração.
    4.  **Não Fazer Nada:** Se nenhum par apresentar essa confluência clara, sua decisão DEVE ser não negociar. Retorne 'bestPair: "NONE"' e 'action: "NONE"'. É preferível preservar capital a entrar em uma operação de baixa probabilidade.

    **Regra Principal: SÓ COMPRE EM TENDÊNCIA DE ALTA (15m 'UP').**
    - Se a tendência de 15m for de BAIXA (DOWN) ou LATERAL (SIDEWAYS), você NÃO DEVE comprar. Ignore quaisquer sinais de compra nesses pares.
    
    **Sua resposta deve ser sempre em português.**

    **Análises de Mercado:**
    {{#each marketAnalyses}}
    ---
    **Par: {{{this.pair}}}**
    - Tendência 15m: {{{this.higherTimeframeTrend}}}
    - Dados de Mercado 1m: {{{this.ohlcvData}}}
    ---
    {{/each}}

    Com base em sua análise comparativa e nas regras de confluência, forneça sua decisão no formato JSON especificado. Sua justificativa (rationale) deve ser breve e declarar claramente por que a configuração escolhida é a de maior probabilidade, ou por que nenhuma configuração atendeu aos critérios.
    `,
});

const findBestTradingOpportunityFlow = ai.defineFlow(
  {
    name: 'findBestTradingOpportunityFlow',
    inputSchema: FindBestTradingOpportunityInputSchema,
    outputSchema: FindBestTradingOpportunityOutputSchema,
  },
  async (input) => {
    const output = await runAIPromptWithRetry(watcherPrompt, input);
    return output;
  }
);
    