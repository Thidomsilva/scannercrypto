/**
 * @fileOverview Centralized Zod schemas and TypeScript types for AI flows.
 */

import { z } from 'zod';

// Schemas for findBestTradingOpportunity flow
export const MarketAnalysisSchema = z.object({
  pair: z.string().describe('O par de negociação (ex: BTC/USDT).'),
  ohlcvData: z.string().describe('Um snapshot dos dados OHLCV e indicadores técnicos para o timeframe principal de negociação.'),
  higherTimeframeTrend: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe('A tendência dominante do timeframe de 15 minutos.'),
});
export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;

export const FindBestTradingOpportunityInputSchema = z.object({
  marketAnalyses: z.array(MarketAnalysisSchema).describe('Um array de dados de análise de mercado para cada par negociável.'),
  availableCapital: z.number().describe('O capital total disponível para negociação.'),
  riskPerTrade: z.number().describe('A porcentagem máxima de capital a arriscar em uma única operação (ex: 0.005 para 0.5%).'),
});
export type FindBestTradingOpportunityInput = z.infer<typeof FindBestTradingOpportunityInputSchema>;

export const FindBestTradingOpportunityOutputSchema = z.object({
  bestPair: z.string().describe("O par de negociação selecionado como a melhor oportunidade, ou 'NONE' se nenhuma oportunidade adequada for encontrada."),
  action: z.enum(['BUY', 'HOLD', 'NONE']).describe("A ação de alto nível recomendada. 'BUY' para uma nova oportunidade, 'HOLD' se já estiver em posição ou 'NONE' se não houver oportunidade."),
  confidence: z.number().min(0).max(1).describe('O nível de confiança (0-1) na oportunidade selecionada.'),
  rationale: z.string().describe('Uma explicação concisa do motivo pelo qual este par foi escolhido (ou por que nenhum par foi escolhido), fazendo referência aos dados de mercado e à tendência.'),
});
export type FindBestTradingOpportunityOutput = z.infer<typeof FindBestTradingOpportunityOutputSchema>;


// Schemas for getLLMTradingDecision flow
export const GetLLMTradingDecisionInputSchema = z.object({
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

export const GetLLMTradingDecisionOutputSchema = z.object({
  pair: z.string().describe('O par de negociação (ex: BTC/USDT).'),
  action: z.enum(['BUY', 'SELL', 'HOLD']).describe("A ação recomendada. 'BUY' para comprar um ativo. 'SELL' para vender um ativo em carteira. 'HOLD' para não fazer nada."),
  notional_usdt: z.number().describe('O valor nocional da ordem em USDT. Deve ser 0 se a ação for HOLD. Para SELL, deve ser o tamanho total da posição. Para BUY, o valor deve ser calculado com base no risco.'),
  order_type: z.enum(['MARKET', 'LIMIT']).describe('O tipo de ordem a ser executada. Use MARKET para ações imediatas.'),
  stop_price: z.number().optional().describe('O preço de stop-loss calculado para uma nova posição de BUY. Geralmente abaixo de um suporte ou candle recente.'),
  take_price: z.number().optional().describe('O preço de take-profit calculado para uma nova posição de BUY. Geralmente baseado em uma resistência ou uma relação Risco/Retorno (ex: 2:1).'),
  confidence: z.number().describe('O nível de confiança da decisão (0-1), baseado na clareza dos sinais técnicos.'),
  rationale: z.string().describe('Uma breve explicação da decisão, considerando o status da posição atual, a tendência do timeframe superior e os indicadores técnicos chave.'),
});
export type GetLLMTradingDecisionOutput = z.infer<typeof GetLLMTradingDecisionOutputSchema>;


// Schemas for server actions
export type MarketAnalysisWithFullData = {
    marketAnalysis: MarketAnalysis;
    fullOhlcv: any[]; // You might want a more specific type here, e.g., OHLCVData[]
};