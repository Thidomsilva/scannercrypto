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
  name: 'executorPromptV2',
  input: {schema: GetLLMTradingDecisionInputSchema},
  output: {schema: GetLLMTradingDecisionOutputSchema},
  prompt: `Você é o EXECUTOR (mercado SPOT). Você recebe dados do Watcher e do sistema para tomar a decisão final de trade, maximizando o Valor Esperado (EV).

    Dados recebidos para o par {{{pair}}}:
    - p_up (prob. de alta): {{{p_up}}}
    - score (qualidade): {{{score}}}
    - contexto: {{{context.reason}}}
    - regime_ok: {{{context.regime_ok}}}
    - último preço: {{{lastPrice}}}
    - ATR(14): {{{atr14}}}
    - Spread: {{{spread}}}
    - Capital Disponível: {{{availableCapital}}} USDT
    - Posição Atual: {{{currentPosition.status}}}

    Seu Processo de Decisão:

    1.  **Cálculo de Risco e EV:**
        - stop_pct = max(0.0015, 0.8 * atr14 / lastPrice)  // Stop técnico ou mínimo de 0.15%
        - take_pct = clamp(1.3 * stop_pct, 0.002, 0.01)   // Take adaptativo, entre 0.2% e 1.0%
        - fee_total = estimatedFees + estimatedSlippage
        - **EV = (p_up * take_pct) - ((1 - p_up) * stop_pct) - fee_total**

    2.  **Regras de Ação:**
        - **Se EV > 0 E spread < 0.001 (0.1%):**
            - **Ação = BUY**: Se status da posição for 'NONE'.
            - **Justificativa:** Mencione o EV positivo. Se o regime de 15m não for 'UP', justifique a entrada com base no EV, mas sugira um tamanho de posição menor.
        - **Se estiver EM POSIÇÃO ('IN_POSITION'):**
            - **Ação = SELL**: Se a estrutura de alta do gráfico de 1m for quebrada (ex: preço cruza abaixo da EMA50) OU se o EV da posição se tornar consistentemente negativo.
            - **Ação = HOLD**: Se a estrutura de alta se mantém e o EV continua positivo.
        - **Caso Contrário:**
            - **Ação = HOLD**. Justifique com o EV negativo ou spread muito alto.

    3.  **Cálculo do Tamanho da Posição (Notional para BUY):**
        - Use a fórmula de Kelly Criterion para otimizar o tamanho.
        - kelly_fraction = EV / take_pct
        - position_fraction = clamp(0.25 * kelly_fraction, 0.0, 0.005) // Use 25% do Kelly, com máximo de 0.5% do capital total.
        - notional_usdt = clamp(availableCapital * position_fraction, 10.0, availableCapital * 0.2) // Garante que o valor esteja entre $10 e 20% do capital.
        - Se 'regime_ok' for falso ou o score for médio (0.4-0.6), você PODE reduzir o 'notional_usdt' calculado (ex: pela metade) como forma de gestão de risco.

    4.  **Definir Saída JSON:**
        - Preencha todos os campos do JSON de saída de forma precisa.
        - 'notional_usdt' deve ser 0 para 'HOLD' e o tamanho total da posição para 'SELL'.
        - 'confidence' é a sua confiança na execução completa desta decisão (0-1).
        - 'rationale' deve ser uma explicação técnica curta. Ex: "EV positivo (0.08%) com p_up de 65%. Entrada com risco reduzido devido a regime lateral."

    Sua resposta DEVE ser apenas o objeto JSON final.
  `,
});


const getLLMTradingDecisionFlow = ai.defineFlow(
  {
    name: 'getLLMTradingDecisionFlowV2',
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
        order_type: 'MARKET',
        p_up: input.p_up,
        confidence: 1,
        rationale: `Mantendo ${input.pair} pois já existe uma posição aberta em ${input.currentPosition.pair}.`
      };
      return GetLLMTradingDecisionOutputSchema.parse(output);
    }
    
    // Calculate EV and other metrics to perform security checks on AI output
    const stop_pct = Math.max(0.0015, 0.8 * input.atr14 / input.lastPrice);
    const take_pct = Math.max(0.002, Math.min(1.3 * stop_pct, 0.01));
    const fee_total = input.estimatedFees + input.estimatedSlippage;
    const expectedValue = (input.p_up * take_pct) - ((1 - input.p_up) * stop_pct) - fee_total;
    
    // Hard rule: If EV is not positive, we do not buy.
    if (input.currentPosition.status === 'NONE' && expectedValue <= 0) {
        const output: GetLLMTradingDecisionOutput = {
            pair: input.pair,
            action: 'HOLD',
            notional_usdt: 0,
            order_type: 'MARKET',
            p_up: input.p_up,
            confidence: 1,
            rationale: `Decisão de HOLD forçada por EV negativo ou nulo (${(expectedValue * 100).toFixed(3)}%). p_up: ${(input.p_up * 100).toFixed(1)}%`
        };
        return GetLLMTradingDecisionOutputSchema.parse(output);
    }

    const aiOutput = await runAIPromptWithRetry(prompt, input);
    const output: GetLLMTradingDecisionOutput = GetLLMTradingDecisionOutputSchema.parse(aiOutput!);

    // --- SECURITY OVERRIDES ---
    output.pair = input.pair; // Ensure correct pair
    
    if (output.action === 'HOLD') {
        output.notional_usdt = 0;
    } else if (output.action === 'BUY') {
        if (input.currentPosition.status === 'IN_POSITION') { // Cannot buy more if already in a position
            output.action = 'HOLD';
            output.notional_usdt = 0;
            output.rationale = `[AÇÃO CORRIGIDA] Tentativa de compra já em posição. Mudado para HOLD.`;
        } else { // It's a new position, calculate notional based on Kelly Criterion as a fallback
            const kelly = expectedValue / take_pct;
            const fraction = Math.max(0, Math.min(0.25 * kelly, 0.005)); // Capped at 0.5% of capital
            const calculatedNotional = Math.max(10, Math.min(input.availableCapital * fraction, input.availableCapital * 0.2));
            
            // Allow AI to have some leeway, but cap it firmly.
            if (output.notional_usdt > calculatedNotional * 1.2 || output.notional_usdt < 10) {
                 output.notional_usdt = calculatedNotional;
                 output.rationale = `[NOTIONAL AJUSTADO] ${output.rationale}`;
            }
        }
    } else if (output.action === 'SELL') {
        if (input.currentPosition.status === 'IN_POSITION' && input.currentPosition.size) {
            output.notional_usdt = input.currentPosition.size; // Must sell the entire position
        } else { // Cannot sell if not in position
            output.action = 'HOLD';
            output.notional_usdt = 0;
            output.rationale = `[AÇÃO CORRIGIDA] Tentativa de venda sem posição. Mudado para HOLD.`;
        }
    }

    return output;
  }
);
