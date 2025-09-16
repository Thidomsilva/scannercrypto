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
  name: 'executorPromptV3',
  input: {schema: GetLLMTradingDecisionInputSchema},
  output: {schema: GetLLMTradingDecisionOutputSchema},
  prompt: `Você é o EXECUTOR para trading SPOT.
Recebe do Watcher: pair, p_up (probabilidade de alta), snapshot técnico (preço atual, ATR14, EMA20/50, ADX, Bollinger, z-score, volume delta), book (bestBid, bestAsk), custos estimados (fees maker/taker por par) e estado de risco (saldo USDT, PnL diário, limites).

Objetivo

Decidir BUY / SELL / HOLD e parametrizar ordem, stop, take e tamanho maximizando Valor Esperado (EV) sob limites de risco.

Regras de Cálculo (obrigatórias)

1. Preços e spread

mid = (bestBid + bestAsk)/2
spread = (bestAsk - bestBid) / mid  // fração (0.001 = 0,1%)

2. Stops e alvos por volatilidade (fração)

atrPct = ATR14 / price
stop_pct = max(0.0025, 0.9 * atrPct)             // ≥ 0,25% ou 0,9×ATR%
take_pct = clamp(1.6 * stop_pct, 0.004, 0.015)    // entre 0,40% e 1,50%

3. Custos

Se a ordem for MARKET ➜ usar fee = taker_fee
Se a ordem for LIMIT post-only ➜ usar fee = maker_fee
slippage_est = spread / 2
cost = fee + slippage_est

4. Valor Esperado

p = clamp(p_up, 0, 1)
EV = p * take_pct - (1 - p) * stop_pct - cost

5. Gate de EV

Se EV > 0 ➜ posição normal
Se -0.0005 < EV ≤ 0 ➜ posição sonda (pequena, para explorar)
Se EV ≤ -0.0005 ➜ HOLD

6. Escolha do tipo de ordem

Se spread ≤ 0.0005 (≤ 0,05%) ➜ MARKET
Se spread > 0.0005 ➜ LIMIT:
preço limite de compra: bestBid + min(spread*0.25*mid, 0.0005*mid)
preço limite de venda:  bestAsk - min(spread*0.25*mid, 0.0005*mid)

7. Tamanho (Kelly capado)

rawKelly = (p*take_pct - (1-p)*stop_pct) / max(take_pct, 1e-6)
kelly = clamp(rawKelly, 0, 0.10)
fraction = clamp(0.25 * kelly, 0, 0.005)   // cap de 0,5% do capital
Se posição sonda (EV ≤ 0 e > −0.0005) ➜ fraction = min(fraction, 0.001) // 0,1%
notional_usdt = clamp(balanceUSDT * fraction, 10, balanceUSDT * 0.20)


Regras de Ação

BUY: se EV > 0 (posição normal) ou -0.0005 < EV ≤ 0 (posição sonda), desde que notional_usdt ≥ 10 e limites de risco permitam.
SELL (somente se IN_POSITION):
Quebra de estrutura de alta (ex.: close < EMA50 1m ou topo/ fundo sinalizando reversão), ou
EV ficar negativo por 2 ciclos seguidos.

HOLD: se nenhuma condição acima for satisfeita ou se limites de risco bloquearem.

Guard-rails (deve respeitar)

Daily kill-switch: se PnL do dia ≤ −2%, retornar HOLD (e indicar reason).
Cool-down por par: evitar nova ordem no mesmo par por 60–120s após execução.
Máx. trades/hora: 12 por par.
Sem saque: nunca retornar nada relacionado a saques; apenas parâmetros de trade.

Saída (retorne somente JSON neste schema)
`,
});


const getLLMTradingDecisionFlow = ai.defineFlow(
  {
    name: 'getLLMTradingDecisionFlowV3',
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
    const p = Math.max(0, Math.min(input.p_up, 1));
    const stop_pct = Math.max(0.0025, 0.9 * input.atr14 / input.lastPrice);
    const take_pct = Math.max(0.004, Math.min(1.6 * stop_pct, 0.015));

    const midPrice = (input.bestBid + input.bestAsk) / 2;
    const spread = (input.bestAsk - input.bestBid) / midPrice;

    let orderType: 'MARKET' | 'LIMIT' = 'MARKET';
    let limitPrice: number | null = null;
    let cost: number;

    if (spread > 0.0005) {
        orderType = 'LIMIT';
        cost = input.makerFee + (spread / 2);
        if (input.currentPosition.status !== 'IN_POSITION') { // Only for new positions
            limitPrice = input.bestBid + Math.min(spread * 0.25 * midPrice, 0.0005 * midPrice);
        }
    } else {
        cost = input.takerFee + (spread / 2);
    }
    
    const expectedValue = (p * take_pct) - ((1 - p) * stop_pct) - cost;
    const EV_GATE = -0.0005;

    // Hard rule: If EV is not in the playable range, we do not buy.
    if (input.currentPosition.status === 'NONE' && expectedValue <= EV_GATE) {
        const output: GetLLMTradingDecisionOutput = {
            pair: input.pair,
            action: 'HOLD',
            notional_usdt: 0,
            order_type: 'NONE',
            p_up: p,
            confidence: 1,
            rationale: `HOLD forçado por EV abaixo do limiar. EV: ${(expectedValue * 100).toFixed(3)}%`,
            stop_pct,
            take_pct,
            EV: expectedValue,
        };
        return GetLLMTradingDecisionOutputSchema.parse(output);
    }

    const aiOutput = await runAIPromptWithRetry(prompt, input);
    const output: GetLLMTradingDecisionOutput = GetLLMTradingDecisionOutputSchema.parse(aiOutput!);

    // --- SECURITY OVERRIDES on AI output---
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
             output.limit_price = limitPrice;
        }
    } else if (output.action === 'SELL') {
        if (input.currentPosition.status === 'IN_POSITION' && input.currentPosition.size) {
            output.notional_usdt = input.currentPosition.size; // Must sell the entire position
            if (spread > 0.0005) {
                output.order_type = 'LIMIT';
                output.limit_price = input.bestAsk - Math.min(spread * 0.25 * midPrice, 0.0005 * midPrice);
            } else {
                output.order_type = 'MARKET';
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
