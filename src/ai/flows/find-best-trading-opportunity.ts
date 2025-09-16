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
    name: 'watcherPromptV3',
    input: {schema: FindBestTradingOpportunityInputSchema},
    output: {schema: FindBestTradingOpportunityOutputSchema},
    prompt: `Você é o WATCHER, analista de oportunidade para trading SPOT.
Sua função é avaliar UM par agora e estimar probabilidade de alta (p_up) e qualidade da oportunidade (score) para compra no horizonte 5–15 min. Você não executa; apenas pontua e contextualiza.

Entradas (resumo que você recebe)

OHLCV 1m (últimos ~200 candles) e OHLCV 15m (últimos ~96).

Indicadores calculados: EMA20/EMA50, ADX(14), ATR(14), RSI(14), Bollinger(20,2), z-score (z20), volume delta, order-book imbalance (OBI), bestBid/bestAsk, spread (fração), slippage estimado.

Metadados opcionais: horário do dia, volatilidade recente, eventos.


Princípios

Regime 15m é contexto, não bloqueio. O sinal de 1m é soberano.

Penalize sinais fracos puxando p_up para ~0.50; evite saturar em 0.0/1.0.

Dê scores intermediários (0.30–0.70) quando houver dúvida.

Reversões são válidas se houver confluência (padrão + volume/OBI + volatilidade compatível).


Heurísticas de regime (para contexto)

trend_ok = (ADX(14) > 18) OR (EMA20 > EMA50)

range_ok = |z20| < 1.8

regime_ok = trend_ok OR range_ok
Descreva em 1 frase por que o regime favorece (ou não) compras.


Sinais típicos a considerar (exemplos, não regras rígidas)

Continuação (trend): 15m favorável + pullback para EMA20/50 em 1m + candle de reversão (ex.: engolfo/hammer) + OBI/volume confirmando.

Reversão (range/down): fundo duplo, rompimento de linha de tendência ou faixa de Bollinger comprimida com expansão de volume; divergência de alta no RSI ajuda.

Microestrutura: OBI > 0, pressão agressora de compra, spread viável.


Saída (retorne somente JSON neste schema)
`,
});

const findBestTradingOpportunityFlow = ai.defineFlow(
  {
    name: 'findBestTradingOpportunityFlowV3',
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
