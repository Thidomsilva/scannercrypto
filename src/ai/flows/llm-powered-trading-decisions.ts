'use server';
/**
 * @fileOverview A LLM powered trading decisions AI agent.
 *
 * - getLLMTradingDecision - A function that handles the trading decision process.
 * - GetLLMTradingDecisionInput - The input type for the getLLMTradingDecision function.
 * - GetLLMTradingDecisionOutput - The return type for the getLLMTradingDecision function.
 */

import {ai} from '@/ai/genkit';
import {GenerateResponse} from 'genkit/generate';
import {z} from 'genkit';

const GetLLMTradingDecisionInputSchema = z.object({
  pair: z.string().describe('O par de negociação a ser analisado (ex: BTC/USDT).'),
  ohlcvData: z.string().describe('Um snapshot dos dados OHLCV e indicadores técnicos para o timeframe principal de negociação.'),
  higherTimeframeTrend: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe('A tendência dominante do timeframe de 15 minutos.'),
  availableCapital: z.number().describe('O capital total disponível para negociação.'),
  riskPerTrade: z.number().describe('A porcentagem máxima de capital a arriscar em uma única operação (ex: 0.005 para 0.5%).'),
  currentPosition: z.object({
    status: z.enum(['NONE', 'LONG', 'SHORT']).describe('O status da posição atual.'),
    entryPrice: z.number().optional().describe('O preço de entrada da posição atual, se houver.'),
    pnlPercent: z.number().optional().describe('O PnL percentual não realizado da posição atual.'),
    size: z.number().optional().describe('O tamanho da posição atual em USDT.'),
    pair: z.string().optional().describe('O par de ativos da posição atual.')
  }).describe('O estado atual da posição de negociação.'),
  watcherRationale: z.string().optional().describe('A justificativa do "Watcher" AI para a escolha deste par. Use para contexto adicional.')
});
export type GetLLMTradingDecisionInput = z.infer<typeof GetLLMTradingDecisionInputSchema>;

const GetLLMTradingDecisionOutputSchema = z.object({
  pair: z.string().describe('O par de negociação (ex: BTC/USDT).'),
  action: z.enum(['BUY', 'SELL', 'HOLD']).describe("A ação recomendada. Se a posição for NONE, BUY abre um LONG e SELL abre um SHORT. Se a posição for LONG, uma ação de SELL a fecha. Se a posição for SHORT, uma ação de BUY a fecha."),
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
  prompt: `Você é um analista de trading quantitativo especialista, o "Executor". Seu parceiro, o "Watcher", já analisou múltiplos ativos e selecionou {{{pair}}} como a melhor oportunidade.
  
  {{#if watcherRationale}}
  **Justificativa do Watcher:** *{{{watcherRationale}}}*
  {{/if}}

  Sua tarefa é conduzir uma análise final e detalhada em **{{{pair}}}** e determinar a ação de execução precisa.

  **REGRA PRIMÁRIA: NUNCA OPERE CONTRA A TENDÊNCIA DO TIMEFRAME SUPERIOR.**
  - A tendência de mercado dominante é determinada pelo timeframe de 15 minutos.
  - A tendência atual de 15 minutos é: **{{{higherTimeframeTrend}}}**
  - **Se a tendência de 15m for de ALTA (UP)**, e você estiver abrindo uma nova posição, você SÓ pode usar a ação 'BUY'.
  - **Se a tendência de 15m for de BAIXA (DOWN)**, e você estiver abrindo uma nova posição, você SÓ pode usar a ação 'SELL'.
  - **Se a tendência de 15m for LATERAL (SIDEWAYS)**, seja extremamente cauteloso. Só abra novas posições se houver uma configuração extremamente clara e de alta probabilidade. Caso contrário, a ação é 'HOLD'.
  - Esta regra se aplica APENAS à abertura de novas posições. Você pode fechar uma posição existente a qualquer momento.

  **Status da Posição Atual:**
  - Status: {{{currentPosition.status}}}
  {{#if currentPosition.entryPrice}}
  - Par: {{{currentPosition.pair}}}
  - Preço de Entrada: {{{currentPosition.entryPrice}}}
  - Tamanho: {{{currentPosition.size}}} USDT
  - PnL Não Realizado: {{{currentPosition.pnlPercent}}}%
  {{/if}}

  **Sua Lógica Deve Seguir Estas Regras:**
  1.  **Se a Posição Atual for 'NONE':** Você está livre para abrir uma nova posição em {{{pair}}}. Siga a regra primária sobre a tendência do timeframe superior. Analise os dados de mercado para encontrar um ponto de entrada de alta probabilidade. Se não existir uma oportunidade clara alinhada com a tendência, sua ação é 'HOLD'.
  2.  **Se a Posição Atual for de um ativo DIFERENTE ({{{currentPosition.pair}}}):** Sua ação para {{{pair}}} deve ser 'HOLD', pois você só pode gerenciar uma posição por vez.
  3.  **Se a Posição Atual for 'LONG' em {{{pair}}}:** Analise se a tendência de alta está continuando ou revertendo.
      - Se a tendência estiver enfraquecendo ou uma reversão for detectada, sua ação deve ser 'SELL' para fechar a posição.
      - Se a tendência permanecer forte, sua ação é 'HOLD'. Não emita uma ação 'BUY'.
  4.  **Se a Posição Atual for 'SHORT' em {{{pair}}}:** Analise se a tendência de baixa está continuando ou revertendo.
      - Se a tendência de baixa estiver enfraquecendo ou uma reversão for detectada, sua ação deve ser 'BUY' para fechar a posição.
      - Se a tendência permanecer forte, sua ação é 'HOLD'. Não emita uma ação 'SELL'.

  **Gerenciamento de Risco:**
  - O 'notional_usdt' para uma NOVA operação é calculado como: \`capitalDisponivel * riscoPorOperacao\`.
  - Ao fechar uma posição, 'notional_usdt' deve ser o tamanho total da posição ({{{currentPosition.size}}}).
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

async function runJsonPrompt(
  prompt: (input: GetLLMTradingDecisionInput) => Promise<GenerateResponse<z.infer<typeof GetLLMTradingDecisionOutputSchema>>>,
  input: GetLLMTradingDecisionInput,
  retries = 1
): Promise<GenerateResponse<GetLLMTradingDecisionOutput>> {
  let lastError: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await prompt(input);
    } catch (e: any) {
      lastError = e;
      console.log(`LLM-JSON-PROMPT: Failed on try ${i}, retrying.`, e);
      // In the retry, we pass the error to the prompt so the model can self-correct.
      (input as any).error = e.message;
    }
  }
  throw lastError;
}


const getLLMTradingDecisionFlow = ai.defineFlow(
  {
    name: 'getLLMTradingDecisionFlow',
    inputSchema: GetLLMTradingDecisionInputSchema,
    outputSchema: GetLLMTradingDecisionOutputSchema,
  },
  async input => {
    // If we have a position on a different asset, we must hold on this one.
    if (input.currentPosition.status !== 'NONE' && input.currentPosition.pair !== input.pair) {
      return {
        pair: input.pair,
        action: 'HOLD',
        notional_usdt: 0,
        order_type: 'MARKET',
        confidence: 1,
        rationale: `Mantendo ${input.pair} pois já existe uma posição aberta em ${input.currentPosition.pair}.`
      }
    }
    
    const { output } = await runJsonPrompt(prompt, input);
    
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
