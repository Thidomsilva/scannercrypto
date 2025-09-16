'use server';
/**
 * @fileOverview A LLM powered trading decisions AI agent for SPOT market.
 *
 * - getLLMTradingDecision - A function that handles the trading decision process.
 * - GetLLMTradingDecisionInput - The input type for the getLLMTradingDecision function.
 * - GetLLMTradingDecisionOutput - The return type for the getLLMTradingDecision function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { runAIPromptWithRetry } from '@/ai/utils';

const GetLLMTradingDecisionInputSchema = z.object({
  pair: z.string().describe('O par de negociação a ser analisado (ex: BTC/USDT).'),
  ohlcvData: z.string().describe('Um snapshot dos dados OHLCV e indicadores técnicos para o timeframe principal de negociação.'),
  higherTimeframeTrend: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe('A tendência dominante do timeframe de 15 minutos.'),
  availableCapital: z.number().describe('O capital total disponível para negociação em USDT.'),
  riskPerTrade: z.number().describe('A porcentagem máxima de capital a arriscar em uma única operação (ex: 0.005 para 0.5%).'),
  currentPosition: z.object({
    status: z.enum(['NONE', 'IN_POSITION']).describe("O status da posição atual. 'NONE' se não houver ativos em carteira, 'IN_POSITION' se houver."),
    entryPrice: z.number().optional().describe('O preço de compra do ativo atual, se houver.'),
    pnlPercent: z.number().optional().describe('O PnL percentual não realizado da posição atual.'),
    size: z.number().optional().describe('O tamanho da posição atual em USDT.'),
    pair: z.string().optional().describe('O par de ativos da posição atual (ex: BTC/USDT).')
  }).describe('O estado atual da posição de negociação, baseado nos ativos em carteira.'),
  watcherRationale: z.string().optional().describe('A justificativa do "Watcher" AI para a escolha deste par. Use para contexto adicional.')
});
export type GetLLMTradingDecisionInput = z.infer<typeof GetLLMTradingDecisionInputSchema>;

const GetLLMTradingDecisionOutputSchema = z.object({
  pair: z.string().describe('O par de negociação (ex: BTC/USDT).'),
  action: z.enum(['BUY', 'SELL', 'HOLD']).describe("A ação recomendada. 'BUY' para comprar um ativo. 'SELL' para vender um ativo em carteira. 'HOLD' para não fazer nada."),
  notional_usdt: z.number().describe('O valor nocional da ordem em USDT.'),
  order_type: z.enum(['MARKET', 'LIMIT']).describe('O tipo de ordem a ser executada.'),
  stop_price: z.number().optional().describe('O preço de stop-loss (se aplicável).'),
  take_price: z.number().optional().describe('O preço de take-profit (se aplicável).'),
  confidence: z.number().describe('O nível de confiança da decisão (0-1).'),
  rationale: z.string().describe('Uma breve explicação da decisão, considerando o status da posição atual e a tendência do timeframe superior.'),
});
export type GetLLMTradingDecisionOutput = z.infer<typeof GetLLMTradingDecisionOutputSchema>;

export async function getLLMTradingDecision(input: GetLLMTradingDecisionInput): Promise<GetLLMTradingDecisionOutput> {
  return getLLMTradingDecisionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'getLLMTradingDecisionPrompt',
  input: {schema: GetLLMTradingDecisionInputSchema},
  output: {schema: GetLLMTradingDecisionOutputSchema, format: 'json'},
  prompt: `Você é um analista de trading especialista em mercado SPOT, o "Executor". Seu parceiro, o "Watcher", já analisou múltiplos ativos e selecionou {{{pair}}} como a melhor oportunidade de COMPRA.
  
  {{#if watcherRationale}}
  **Justificativa do Watcher:** *{{{watcherRationale}}}*
  {{/if}}

  Sua tarefa é conduzir uma análise final e detalhada em **{{{pair}}}** e determinar a ação de execução precisa. Lembre-se, você opera em mercado SPOT: você só pode COMPRAR com USDT ou VENDER um ativo que já possui para USDT.

  **REGRA PRIMÁRIA: SÓ COMPRE EM TENDÊNCIA DE ALTA.**
  - A tendência de mercado dominante é determinada pelo timeframe de 15 minutos.
  - A tendência atual de 15 minutos é: **{{{higherTimeframeTrend}}}**
  - **Você SÓ pode abrir uma nova posição (ação 'BUY') se a tendência de 15m for de ALTA (UP).**
  - Se a tendência for de BAIXA (DOWN) ou LATERAL (SIDEWAYS), você NÃO deve comprar. Sua ação deve ser 'HOLD'.
  - Esta regra se aplica APENAS à abertura de novas posições. Você pode vender uma posição existente a qualquer momento.

  **Status da Posição Atual:**
  - Status: {{{currentPosition.status}}}
  {{#if currentPosition.pair}}
  - Ativo em Carteira: {{{currentPosition.pair}}}
  - Preço de Compra: {{{currentPosition.entryPrice}}}
  - Tamanho (USDT): {{{currentPosition.size}}}
  - PnL Não Realizado: {{{currentPosition.pnlPercent}}}%
  {{/if}}

  **Sua Lógica Deve Seguir Estas Regras de Mercado SPOT:**
  1.  **Se a Posição Atual for 'NONE' (Sem ativos em carteira):** Você está analisando {{{pair}}} para uma potencial COMPRA. Siga a regra primária sobre a tendência. Se a tendência de 15m for 'UP' e a análise técnica for favorável, sua ação pode ser 'BUY'. Caso contrário, a ação DEVE ser 'HOLD'.
  2.  **Se a Posição Atual for 'IN_POSITION' com um ativo DIFERENTE ({{{currentPosition.pair}}}):** Sua ação para {{{pair}}} deve ser 'HOLD', pois você só pode gerenciar um ativo por vez.
  3.  **Se a Posição Atual for 'IN_POSITION' com o mesmo ativo ({{{pair}}}):** Você está decidindo se deve vender o ativo que já possui.
      - Analise se a tendência de alta está enfraquecendo ou revertendo. Se sim, sua ação deve ser 'SELL' para fechar a posição e realizar o lucro/perda.
      - Se a tendência de alta permanecer forte, sua ação é 'HOLD' para continuar na posição. Não emita uma nova ação 'BUY'.

  **Gerenciamento de Risco:**
  - O 'notional_usdt' para uma NOVA operação de 'BUY' é calculado como: \`capitalDisponivel * riscoPorOperacao\`.
  - Ao VENDER uma posição existente, 'notional_usdt' deve ser o tamanho total da posição ({{{currentPosition.size}}}).
  - Se sua ação for 'HOLD', 'notional_usdt' deve ser 0.
  - Sua justificativa (rationale) deve ser concisa, baseada em dados e fazer referência a indicadores específicos.
  
  **Sua resposta deve ser sempre em português.**

  **Dados de Mercado e Risco para {{{pair}}}:**
  - Snapshot de Dados de Mercado (1 minuto): {{{ohlcvData}}}
  - Tendência de 15 Minutos: {{{higherTimeframeTrend}}}
  - Capital Disponível: {{{availableCapital}}} USDT
  - Risco Máximo por Operação: {{{riskPerTrade}}}

  Analise todos os dados e forneça sua decisão de negociação no formato JSON especificado.
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
      return {
        pair: input.pair,
        action: 'HOLD',
        notional_usdt: 0,
        order_type: 'MARKET',
        confidence: 1,
        rationale: `Mantendo ${input.pair} pois já existe uma posição aberta em ${input.currentPosition.pair}.`
      }
    }
    
    const { output } = await runAIPromptWithRetry(prompt, input);
    
    // Enforce risk management rule as a fallback
    if (output) {
      if(output.action === 'HOLD') {
        output.notional_usdt = 0;
      } else if (input.currentPosition.status === 'NONE') { // New position
        const maxNotional = input.availableCapital * input.riskPerTrade;
        if (output.notional_usdt > maxNotional || output.notional_usdt === 0) {
            output.notional_usdt = maxNotional;
            output.rationale = `[AJUSTADO] ${output.rationale}`;
        }
      } else { // Closing position
        if (input.currentPosition.size) {
            output.notional_usdt = input.currentPosition.size;
        }
      }
      // Ensure the output pair matches the input pair
      output.pair = input.pair;
    }
    return output!;
  }
);
