/**
 * @fileOverview O "Watcher" AI. Avalia a qualidade de uma oportunidade de compra para um par.
 *
 * - findBestTradingOpportunity - A função que executa a análise.
 * - FindBestTradingOpportunityInput - O tipo de entrada (WatcherInputSchema).
 * - FindBestTradingOpportunityOutput - O tipo de saída (WatcherOutputSchema).
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
    name: 'watcherPromptV2',
    input: {schema: FindBestTradingOpportunityInputSchema},
    output: {schema: FindBestTradingOpportunityOutputSchema},
    prompt: `Você é o WATCHER. Sua única tarefa é avaliar UM par de criptoativos e estimar a qualidade de uma oportunidade de COMPRA neste exato momento.

    Princípios:
    - O gráfico de 15m fornece o contexto geral (regime); o sinal de entrada no gráfico de 1m é soberano para a ação.
    - Permita pontuações intermediárias (ex: 0.30–0.70); sua análise não deve ser binária (0 ou 1).
    - Uma reversão (compra em tendência de baixa/lateral) pode ser válida se houver um "edge" claro (vantagem estatística), não exija uma configuração "perfeita".

    Dados de Entrada para sua análise em {{{pair}}}:
    - Contexto de Mercado (15m): {{{ohlcvData15m}}}
    - Sinal de Entrada (1m): {{{ohlcvData1m}}}
    - Liquidez: {{{marketData}}}

    Regime de Mercado (análise dos dados de 15m):
    - Calcule 'trend_ok' = (ADX(14) > 18) OU (EMA20 > EMA50)
    - Calcule 'range_ok' = |z-score(20)| < 1.8
    - A condição final do regime é 'regime_ok' = trend_ok OU range_ok. Um regime 'ok' indica que o mercado não está excessivamente volátil ou sem direção, sendo mais previsível.

    Estimativas (baseado principalmente nos dados de 1m, usando 15m como contexto):
    1.  **p_up**: Estime a probabilidade (de 0.0 a 1.0) de que o preço terá um **retorno positivo** nos próximos 5 a 15 minutos.
        - p_up > 0.60: Sinal de alta forte.
        - p_up ~ 0.50: Sinal neutro/indefinido.
        - p_up < 0.40: Sinal de baixa.
    2.  **score**: Atribua uma pontuação de qualidade para a oportunidade de COMPRA (de 0.0 a 1.0). Esta pontuação deve ser coerente com 'p_up', mas também ponderada pelo 'regime_ok' e pela clareza do padrão técnico. Um 'p_up' alto em um 'regime_ok' deve resultar em um 'score' alto.

    Sua resposta DEVE ser um objeto JSON válido, contendo apenas os campos do schema de saída.

    Exemplo de Raciocínio (você não deve incluir isso na saída):
    - "O par BTC/USDT em 15m está com ADX baixo (15) mas a EMA20 cruzou a EMA50 para cima (trend_ok = true). O z-score é 1.2 (range_ok = true). Portanto, regime_ok = true. No gráfico de 1m, vejo um pullback claro na EMA20, com um candle martelo e aumento de volume. O RSI está saindo de sobre-vendido. Estimo uma probabilidade de 75% de subir (p_up=0.75). Como o sinal é forte e o regime é bom, o score de qualidade é 0.8."

    JSON de Saída (apenas isso):
    `,
});

const findBestTradingOpportunityFlow = ai.defineFlow(
  {
    name: 'findBestTradingOpportunityFlowV2',
    inputSchema: FindBestTradingOpportunityInputSchema,
    outputSchema: FindBestTradingOpportunityOutputSchema,
  },
  async (input) => {
    const aiResponse = await runAIPromptWithRetry(watcherPrompt, input);
    
    // Ensure the output pair matches the input pair, as the AI can sometimes fail to set it.
    const finalOutput: FindBestTradingOpportunityOutput = {
      ...aiResponse,
      pair: input.pair,
    };
    
    return finalOutput;
  }
);
