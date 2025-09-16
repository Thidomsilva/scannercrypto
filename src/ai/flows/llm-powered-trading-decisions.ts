
'use server';
/**
 * @fileOverview O "Executor" AI. Decide a ação final (BUY/SELL/HOLD) e parametriza o risco.
 *
 * - getLLMTradingDecision - A função que executa a decisão.
 * - GetLLMTradingDecisionInput - O tipo de entrada (ExecutorInputSchema).
 * - GetLLMTradingDecisionOutput - O tipo de saída (ExecutorOutputSchema).
 */

import {ai} from '@/ai/genkit';
import { runAIPromptWithRetry } from '@/ai/utils';
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput } from '@/ai/schemas';
import { GetLLMTradingDecisionInputSchema, GetLLMTradingDecisionOutputSchema } from '@/ai/schemas';

export async function getLLMTradingDecision(input: GetLLMTradingDecisionInput): Promise<GetLLMTradingDecisionOutput> {
  return getLLMTradingDecisionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'executorPromptV5',
  input: {schema: GetLLMTradingDecisionInputSchema},
  output: {schema: GetLLMTradingDecisionOutputSchema},
  prompt: `Você é o EXECUTOR para trading SPOT.
Recebe do Watcher: pair, p_up (probabilidade de alta), score, snapshot técnico e estado de risco. Seu objetivo é decidir BUY / SELL / HOLD e parametrizar a ordem.

Regras de Cálculo (obrigatórias)

1. Preços e Spread
mid = (bestBid + bestAsk) / 2
spread = (bestAsk - bestBid) / mid

2. Stops e Alvos
atrPct = ATR14 / lastPrice
stop_pct = max(0.0025, 0.9 * atrPct)
take_pct = clamp(1.6 * stop_pct, 0.004, 0.015)

3. Custos
Se spread <= 0.0005 -> ordem MARKET, fee = takerFee, slippage = spread/2
Se spread > 0.0005 -> ordem LIMIT, fee = makerFee, slippage = spread/2
cost = fee + slippage

4. Valor Esperado (EV)
p = clamp(p_up, 0, 1)
EV = p * take_pct - (1 - p) * stop_pct - cost

5. Gate de EV & Tamanho da Posição
MIN_NOTIONAL = 5 USDT (valor mínimo para operar)
Se EV > 0 -> Ação BUY.
  notional_usdt = MIN_NOTIONAL // Usar stake fixa.
Se EV <= 0 -> Ação HOLD.
  notional_usdt = 0

6. Tipo de Ordem
Se spread <= 0.0005 -> MARKET
Se spread > 0.0005 -> LIMIT:
  preço de compra = bestBid + min(spread*0.25*mid, 0.0005*mid)
  preço de venda = bestAsk - min(spread*0.25*mid, 0.0005*mid)


Regras de Ação

BUY: Se EV > 0 e não houver posição aberta em outro par. Defina notional_usdt para MIN_NOTIONAL.
SELL (somente se IN_POSITION no mesmo par): Se a estrutura de alta quebrar (ex: close < EMA50 1m) ou EV ficar negativo por 2 ciclos. Venda a posição inteira.
HOLD: Se nenhuma condição acima for satisfeita ou se limites de risco bloquearem.

Guard-rails (deve respeitar)
Daily kill-switch: se PnL do dia ≤ −2%, retorne HOLD.
Cool-down por par: evitar nova ordem no mesmo par por 60–120s.

Saída (retorne somente JSON neste schema)
`,
});


const getLLMTradingDecisionFlow = ai.defineFlow(
  {
    name: 'getLLMTradingDecisionFlowV5',
    inputSchema: GetLLMTradingDecisionInputSchema,
    outputSchema: GetLLMTradingDecisionOutputSchema,
  },
  async input => {
    // If we have a position on a different asset, we must hold on this one.
    if (input.currentPosition.status === 'IN_POSITION' && input.currentPosition.pair !== input.pair) {
      const output: GetLLMTradingDecisionOutput = {
        pair: input.pair,
        action: 'HOLD',
        notional_usdt: 0,
        order_type: 'NONE',
        p_up: input.p_up,
        confidence: 1,
        rationale: `Mantendo ${input.pair} pois já existe uma posição aberta em ${input.currentPosition.pair}.`,
        EV: 0,
      };
      return GetLLMTradingDecisionOutputSchema.parse(output);
    }
    
    // --- SECURITY OVERRIDES & PRE-CALCULATIONS ---
    // These calculations are performed here to ensure they are not manipulated by the AI
    // and to provide a secure baseline for the decision.
    const p = Math.max(0, Math.min(input.p_up, 1));
    const atrPct = input.atr14 / input.lastPrice;
    const stop_pct = Math.max(0.0025, 0.9 * atrPct);
    const take_pct = Math.max(0.004, Math.min(1.6 * stop_pct, 0.015));

    const midPrice = (input.bestBid + input.bestAsk) / 2;
    const spread = (input.bestAsk - input.bestBid) / midPrice;

    // Determine order type and cost based on spread
    let orderType: 'MARKET' | 'LIMIT' = 'MARKET';
    let cost: number;
    if (spread > 0.0005) {
        orderType = 'LIMIT';
        cost = input.makerFee + (spread / 2);
    } else {
        cost = input.takerFee + (spread / 2);
    }
    
    const expectedValue = (p * take_pct) - ((1 - p) * stop_pct) - cost;
    const EV_GATE = 0; // Simplified gate: only trade on positive EV.

    // Hard rule: If EV is not positive (for a new position), we do not buy.
    if (input.currentPosition.status === 'NONE' && expectedValue <= EV_GATE) {
        const output: GetLLMTradingDecisionOutput = {
            pair: input.pair,
            action: 'HOLD',
            notional_usdt: 0,
            order_type: 'NONE',
            p_up: p,
            confidence: 1,
            rationale: `HOLD forçado por EV não-positivo. EV: ${(expectedValue * 100).toFixed(4)}%`,
            stop_pct,
            take_pct,
            EV: expectedValue,
        };
        return GetLLMTradingDecisionOutputSchema.parse(output);
    }

    // Call the AI with the pre-calculated, trusted data
    const aiOutput = await runAIPromptWithRetry(prompt, input);
    const output: GetLLMTradingDecisionOutput = GetLLMTradingDecisionOutputSchema.parse(aiOutput!);

    // --- SECURITY OVERRIDES on AI output---
    // Enforce our secure calculations on the AI's decision.
    output.pair = input.pair; // Ensure correct pair
    
    if (output.action === 'HOLD') {
        output.notional_usdt = 0;
    } else if (output.action === 'BUY') {
        if (input.currentPosition.status === 'IN_POSITION') { // Cannot buy more if already in position
            output.action = 'HOLD';
            output.notional_usdt = 0;
            output.rationale = `[AÇÃO CORRIGIDA] Tentativa de compra já em posição. Mudado para HOLD.`;
        } else {
             // Let the AI decide the sizing, but apply our calculated order type and price
             output.order_type = orderType;
             if (orderType === 'LIMIT') {
                output.limit_price = input.bestBid + Math.min(spread * 0.25 * midPrice, 0.0005 * midPrice);
             }
        }
    } else if (output.action === 'SELL') {
        if (input.currentPosition.status === 'IN_POSITION' && input.currentPosition.size) {
            output.notional_usdt = input.currentPosition.size; // Must sell the entire position
            output.order_type = orderType; // Use calculated order type
            if (orderType === 'LIMIT') {
                 output.limit_price = input.bestAsk - Math.min(spread * 0.25 * midPrice, 0.0005 * midPrice);
            }
        } else { // Cannot sell if not in position
            output.action = 'HOLD';
            output.notional_usdt = 0;
            output.rationale = `[AÇÃO CORRIGIDA] Tentativa de venda sem posição. Mudado para HOLD.`;
        }
    }

    return output;
  }
);
