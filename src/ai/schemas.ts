/**
 * @fileOverview Centralized Zod schemas and TypeScript types for AI flows.
 * v5: Adds a positionAnalysis field to the Executor output for dynamic action plans.
 */

import { z } from 'zod';

// Schemas for findBestTradingOpportunity flow (Watcher AI)
export const WatcherInputSchema = z.object({
  pair: z.string().describe('O par de negociação (ex: BTC/USDT).'),
  ohlcvData1m: z.string().describe('String JSON de dados OHLCV de 1 minuto (200 períodos) com indicadores técnicos.'),
  ohlcvData15m: z.string().describe('String JSON de dados OHLCV de 15 minutos (96 períodos) com indicadores técnicos.'),
  marketData: z.object({
    spread: z.number().describe('O spread atual entre compra e venda.'),
    slippageEstimate: z.number().describe('A estimativa de slippage para uma ordem a mercado.'),
    orderBookImbalance: z.number().describe('O desequilíbrio no livro de ordens (0 se não disponível).'),
  }).describe('Dados de mercado em tempo real.'),
});
export type WatcherInput = z.infer<typeof WatcherInputSchema>;

export const WatcherOutputSchema = z.object({
  pair: z.string().describe("O par de negociação analisado."),
  p_up: z.number().min(0).max(1).describe("A probabilidade estimada (0-1) de que o preço terá um retorno positivo nos próximos 5-15 minutos."),
  score: z.number().min(0).max(1).describe("A qualidade geral do sinal de COMPRA agora (0-1), coerente com p_up e o contexto."),
  context: z.object({
    regime_ok: z.boolean().describe("Indica se o regime de mercado (tendência ou range) é favorável para trading."),
    trend_ok: z.boolean().describe("Resultado do cálculo (ADX > 18) OR (EMA20 > EMA50)."),
    range_ok: z.boolean().describe("Resultado do cálculo |z-score(20)| < 1.8."),
    reason: z.string().describe("Uma explicação muito curta para a pontuação e o regime."),
  }),
  notes: z.string().describe("1-2 frases, objetivas (pontos de confluência observados)."),
});
export type WatcherOutput = z.infer<typeof WatcherOutputSchema>;


// Schemas for getLLMTradingDecision flow (Executor AI)
export const ExecutorInputSchema = z.object({
  pair: z.string().describe('O par de negociação selecionado pelo Watcher.'),
  p_up: z.number().describe('A probabilidade de alta (p_up) estimada pelo Watcher.'),
  score: z.number().describe('A pontuação de qualidade (score) atribuída pelo Watcher.'),
  context: z.object({
      regime_ok: z.boolean(),
      reason: z.string(),
  }).describe('O contexto de mercado fornecido pelo Watcher.'),
  
  // Market & Risk Data
  lastPrice: z.number().describe('O último preço conhecido do ativo (mid price).'),
  atr14: z.number().describe('O valor do Average True Range (14) para o cálculo de stop.'),
  bestBid: z.number().describe('O melhor preço de compra no livro de ofertas.'),
  bestAsk: z.number().describe('O melhor preço de venda no livro de ofertas.'),
  makerFee: z.number().describe('A taxa de transação para ordens "maker".'),
  takerFee: z.number().describe('A taxa de transação para ordens "taker".'),

  // Account & Position Data
  availableCapital: z.number().describe('O capital total disponível para negociação em USDT.'),
  currentPosition: z.object({
    status: z.enum(['NONE', 'IN_POSITION']).describe("Status da posição atual."),
    entryPrice: z.number().optional().describe('Preço de compra do ativo atual.'),
    size: z.number().optional().describe('Tamanho da posição atual em USDT.'),
    pair: z.string().optional().describe('O par de ativos da posição atual.')
  }).describe('O estado atual da posição de negociação.'),
});
export type ExecutorInput = z.infer<typeof ExecutorInputSchema>;

export const ExecutorOutputSchema = z.object({
  pair: z.string().describe('O par de negociação (ex: BTC/USDT).'),
  action: z.enum(['BUY', 'SELL', 'HOLD']).describe("A ação recomendada."),
  order_type: z.enum(['MARKET', 'LIMIT', 'NONE']).describe('O tipo de ordem a ser executada. NONE para HOLD.'),
  p_up: z.number().describe("A probabilidade de alta (p_up) que fundamentou a decisão."),
  EV: z.number().describe('O Valor Esperado (EV) calculado para a operação.'),
  notional_usdt: z.number().describe('O valor nocional da ordem em USDT. 0 para HOLD.'),
  stop_pct: z.number().optional().describe("A porcentagem de stop-loss calculada como fração (ex: 0.0025)."),
  take_pct: z.number().optional().describe("A porcentagem de take-profit calculada como fração (ex: 0.004)."),
  limit_price: z.number().optional().nullable().describe("O preço limite para ordens LIMIT."),
  confidence: z.number().min(0).max(1).describe('O nível de confiança da IA na execução desta decisão.'),
  rationale: z.string().describe('Uma breve explicação técnica para a decisão.'),
  positionAnalysis: z.object({
    technicalStructureOK: z.boolean().describe("True se a estrutura técnica que justificou a compra ainda está válida. False se quebrou (ex: preço abaixo da EMA50 1m)."),
    evOK: z.boolean().describe("True se o Valor Esperado (EV) da posição ainda é positivo ou aceitável. False se tornou-se negativo."),
  }).optional().describe("Análise em tempo real das condições de saída para uma posição aberta."),
});
export type ExecutorOutput = z.infer<typeof ExecutorOutputSchema>;


// --- Helper Types ---

export type OHLCVData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Type Aliases for actions and other components
export type GetLLMTradingDecisionInput = ExecutorInput;
export type GetLLMTradingDecisionOutput = ExecutorOutput;
export const GetLLMTradingDecisionInputSchema = ExecutorInputSchema;
export const GetLLMTradingDecisionOutputSchema = ExecutorOutputSchema;

export type FindBestTradingOpportunityInput = WatcherInput;
export type FindBestTradingOpportunityOutput = WatcherOutput;
export const FindBestTradingOpportunityInputSchema = WatcherInputSchema;
export const FindBestTradingOpportunityOutputSchema = WatcherOutputSchema;

export type MarketData = {
    pair: string;
    ohlcv1m: OHLCVData[];
    ohlcv15m: OHLCVData[];
    indicators: {
        atr14: number;
        bestBid: number;
        bestAsk: number;
        spread: number;
        slippage: number;
    },
    promptData1m: string;
    promptData15m: string;
}
