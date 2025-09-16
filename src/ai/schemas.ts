/**
 * @fileOverview Centralized Zod schemas and TypeScript types for AI flows.
 * v2: Schemas adapted for EV (Expected Value) and p_up (probability of profit) based trading.
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
    orderBookImbalance: z.number().describe('O desequilíbrio no livro de ordens.'),
  }).describe('Dados de mercado em tempo real.'),
});
export type WatcherInput = z.infer<typeof WatcherInputSchema>;

export const WatcherOutputSchema = z.object({
  pair: z.string().describe("O par de negociação analisado."),
  score: z.number().min(0).max(1).describe("A qualidade geral do sinal de COMPRA agora (0-1), coerente com p_up e o contexto."),
  p_up: z.number().min(0).max(1).describe("A probabilidade estimada (0-1) de que o preço terá um retorno positivo nos próximos 5-15 minutos."),
  context: z.object({
    regime_ok: z.boolean().describe("Indica se o regime de mercado (tendência ou range) é favorável para trading."),
    reason: z.string().describe("Uma explicação muito curta para a pontuação e o regime."),
  }),
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
  lastPrice: z.number().describe('O último preço conhecido do ativo.'),
  atr14: z.number().describe('O valor do Average True Range (14) para o cálculo de stop.'),
  spread: z.number().describe('O spread atual do par.'),
  estimatedFees: z.number().describe('A estimativa de taxas da corretora.'),
  estimatedSlippage: z.number().describe('A estimativa de slippage para a ordem.'),

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
  order_type: z.enum(['MARKET', 'LIMIT']).describe('O tipo de ordem a ser executada.'),
  p_up: z.number().describe("A probabilidade de alta (p_up) que fundamentou a decisão."),
  notional_usdt: z.number().describe('O valor nocional da ordem em USDT. 0 para HOLD.'),
  stop_pct: z.number().optional().describe("A porcentagem de stop-loss calculada."),
  take_pct: z.number().optional().describe("A porcentagem de take-profit calculada."),
  limit_price: z.number().optional().nullable().describe("O preço limite para ordens LIMIT."),
  confidence: z.number().min(0).max(1).describe('O nível de confiança da IA na execução desta decisão.'),
  rationale: z.string().describe('Uma breve explicação técnica para a decisão.'),
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
        spread: number;
        slippage: number;
    },
    promptData1m: string;
    promptData15m: string;
}
