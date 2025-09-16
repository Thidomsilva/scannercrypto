'use server';
/**
 * @fileOverview A LLM powered trading decisions AI agent for SPOT market.
 *
 * - getLLMTradingDecision - A function that handles the trading decision process.
 * - GetLLMTradingDecisionInput - The input type for the getLLMTradingDecision function.
 * - GetLLMTradingDecisionOutput - The return type for the getLLMTradingDecision function.
 */

import {ai} from '@/ai/genkit';
import { runAIPromptWithRetry } from '@/ai/utils';
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput } from '@/ai/schemas';
import { GetLLMTradingDecisionInputSchema, GetLLMTradingDecisionOutputSchema } from '@/ai/schemas';

export async function getLLMTradingDecision(input: GetLLMTradingDecisionInput): Promise<GetLLMTradingDecisionOutput> {
  return getLLMTradingDecisionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'getLLMTradingDecisionPrompt',
  input: {schema: GetLLMTradingDecisionInputSchema},
  output: {schema: GetLLMTradingDecisionOutputSchema},
  prompt: `Você é um trader especialista em execução para o mercado SPOT, o "Executor". Seu parceiro, o "Watcher", já selecionou {{{pair}}} como a melhor oportunidade de COMPRA.

  {{#if watcherRationale}}
  **Justificativa do Watcher:** *{{{watcherRationale}}}*
  {{/if}}

  Sua tarefa é a análise final para execução. Você deve definir a ação precisa (BUY, SELL, HOLD) e, crucialmente, o gerenciamento de risco (stop-loss, take-profit, e tamanho da posição).

  **REGRAS DE EXECUÇÃO:**

  1.  **LÓGICA DE ENTRADA (COMPRA):**
      - **Análise da Tendência (15m):** A tendência de 15m é seu guia de risco.
        - **Tendência 'UP':** Cenário ideal. Prossiga com a análise de compra.
        - **Tendência 'SIDEWAYS' ou 'DOWN':** Cenário de maior risco. Você só deve proceder com a compra se o sinal de entrada no gráfico de 1m for **excepcionalmente forte e claro** (ex: um padrão de reversão clássico confirmado, como um fundo duplo com rompimento de resistência e volume crescente). Se o sinal de 1m for apenas "bom" mas não "excelente", a ação deve ser 'HOLD' devido ao risco do timeframe maior.
      - **Confirmação (1m):** Se a análise da tendência permitir, analise os dados de 1m para confirmar o sinal de compra.
      - **Gerenciamento de Risco (para 'BUY'):**
          - O 'notional_usdt' da compra deve ser baseado no risco definido.
          - Defina um 'stop_price' lógico, abaixo de um suporte recente ou do último fundo no gráfico de 1m.
          - Defina um 'take_price' com uma relação Risco/Retorno de pelo menos 1.5:1 em relação ao seu stop.

  2.  **LÓGICA DE SAÍDA (VENDA):**
      - **Condição:** Você só pode vender se já estiver 'IN_POSITION' com o ativo {{{pair}}}.
      - **Gatilho de Venda:** Venda se a estrutura de alta for quebrada. Exemplos: o preço cruza para baixo de uma média móvel importante (ex: EMA50), um topo mais baixo é formado, ou um padrão de reversão claro aparece.
      - **Execução:** A ação é 'SELL'. O 'notional_usdt' deve ser o tamanho total da sua posição atual ({{{currentPosition.size}}}).

  3.  **LÓGICA DE MANUTENÇÃO (HOLD):**
      - Se você não tem posição e as condições de compra não são atendidas (seja pela tendência de 15m ou pela falta de um sinal forte em 1m).
      - Se você está em uma posição e a tendência de alta permanece forte, sem sinais de reversão.
      - Se você está em uma posição em um ativo DIFERENTE.
      - Se a ação for 'HOLD', 'notional_usdt' DEVE ser 0.

  **Status da Posição Atual:**
  - Status: {{{currentPosition.status}}}
  {{#if currentPosition.pair}}
  - Ativo: {{{currentPosition.pair}}}
  - Preço de Compra: {{{currentPosition.entryPrice}}}
  - Tamanho (USDT): {{{currentPosition.size}}}
  - PnL: {{{currentPosition.pnlPercent}}}%
  {{/if}}

  **Sua resposta deve ser sempre em português.**

  **Dados para sua análise de {{{pair}}}:**
  - Dados de Mercado (1m): {{{ohlcvData}}}
  - Tendência (15m): {{{higherTimeframeTrend}}}
  - Capital Disponível: {{{availableCapital}}} USDT
  - Risco por Operação: {{{riskPerTrade}}}

  Com base em todas as regras e dados, forneça sua decisão final no formato JSON especificado. Sua justificativa (rationale) deve ser objetiva e técnica.
  `,
});


const getLLMTradingDecisionFlow = ai.defineFlow(
  {
    name: 'getLLMTradingDecisionFlow',
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
        confidence: 1,
        rationale: `Mantendo ${input.pair} pois já existe uma posição aberta em ${input.currentPosition.pair}.`
      };
      return GetLLMTradingDecisionOutputSchema.parse(output);
    }
    
    const output = await runAIPromptWithRetry(prompt, input);
    
    // Enforce risk management rules as a fallback
    if (output) {
      if(output.action === 'HOLD') {
        output.notional_usdt = 0;
      } else if (output.action === 'BUY') {
        if (input.currentPosition.status === 'NONE') { // New position
          const maxNotional = input.availableCapital * input.riskPerTrade;
          // Allow small deviation from AI, but cap at max risk.
          if (output.notional_usdt > maxNotional * 1.05 || output.notional_usdt <= 0) {
              output.notional_usdt = maxNotional;
              output.rationale = `[NOTIONAL AJUSTADO] ${output.rationale}`;
          }
        } else { // Already in position, should be holding or selling, not buying more.
          output.action = 'HOLD';
          output.notional_usdt = 0;
          output.rationale = `[AÇÃO CORRIGIDA] Tentativa de compra já em posição. Mudado para HOLD.`;
        }
      } else if (output.action === 'SELL') { // Closing position
        if (input.currentPosition.status === 'IN_POSITION' && input.currentPosition.size) {
            output.notional_usdt = input.currentPosition.size;
        } else { // Cannot sell if not in position
            output.action = 'HOLD';
            output.notional_usdt = 0;
            output.rationale = `[AÇÃO CORRIGIDA] Tentativa de venda sem posição. Mudado para HOLD.`;
        }
      }
      // Ensure the output pair matches the input pair
      output.pair = input.pair;
    }
    
    // Final validation to ensure the output object conforms to the schema before returning
    return GetLLMTradingDecisionOutputSchema.parse(output!);
  }
);
