
"use server";

import React from 'react';
import { getLLMTradingDecision } from "@/ai/flows/llm-powered-trading-decisions";
import { findBestTradingOpportunity } from "@/ai/flows/find-best-trading-opportunity";
import { createOrder, ping, getAccountInfo, getKlineData } from "@/lib/mexc-client";
import type { GetLLMTradingDecisionInput, GetLLMTradingDecisionOutput, FindBestTradingOpportunityInput, FindBestTradingOpportunityOutput, MarketData, OHLCVData } from "@/ai/schemas";
import { createStreamableValue } from 'ai/rsc';

// --- Constants & Configuration ---
const SPREAD_MAX: Record<string, number> = {
    "BTC/USDT": 0.0012,
    "ETH/USDT": 0.0015,
    "SOL/USDT": 0.0025,
    "XRP/USDT": 0.0030,
    "DOGE/USDT": 0.0040,
};
const ESTIMATED_FEES = 0.0006; // Default taker fee of 0.06%
const EV_GATE = -0.0005; // EV Gate of -0.05% to allow for probe trades
const SPREAD_HARD_STOP = 0.01; // 1% hard stop for abnormal spreads
const RISK_PER_TRADE_CAP = 0.005; // 0.5% of capital max risk per trade


// --- Data Generation & Indicators ---

// Calculates ATR (Average True Range)
const calculateATR = (data: OHLCVData[], period: number): number => {
    if (data.length < period) return 0;
    let trueRanges: number[] = [];
    for (let i = 1; i < data.length; i++) {
        const high = data[i].high;
        const low = data[i].low;
        const prevClose = data[i - 1].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRanges.push(tr);
    }
    
    // Simple Moving Average of True Ranges
    if (trueRanges.length < period) return 0;
    const relevantTRs = trueRanges.slice(-period);
    return relevantTRs.reduce((a, b) => a + b, 0) / relevantTRs.length;
}


// Generates a formatted string of market data for the AI prompt
const generateAIPromptData = (ohlcvData: OHLCVData[], timeframeLabel: string): string => {
  if (ohlcvData.length === 0) return "No data available";
  const latestCandle = ohlcvData[ohlcvData.length - 1];
  
  // Calculate some simple indicators from the data
  const recentCloses = ohlcvData.slice(-20).map(c => c.close);
  const ema20 = recentCloses.reduce((acc, val) => acc + val, 0) / recentCloses.length;
  const closes50 = ohlcvData.slice(-50).map(c => c.close);
  const ema50 = closes50.reduce((acc, val) => acc + val, 0) / closes50.length;
  const stdDev = Math.sqrt(recentCloses.map(x => Math.pow(x - ema20, 2)).reduce((a, b) => a + b) / recentCloses.length);

  const atr14 = calculateATR(ohlcvData, 14);

  // Note: Some indicators are still mocked for simplicity as they require more complex calculations or data.
  const indicators = {
    "Price": latestCandle.close.toFixed(4),
    "EMA(20)": ema20.toFixed(4),
    "EMA(50)": ema50.toFixed(4),
    "RSI(14)": (40 + Math.random() * 20).toFixed(1), // Mocked for simplicity
    "BollingerBands(20,2)": `Upper: ${(ema20 + 2 * stdDev).toFixed(4)}, Mid: ${ema20.toFixed(4)}, Lower: ${(ema20 - 2 * stdDev).toFixed(4)}`,
    "z-score(20)": stdDev > 0 ? ((latestCandle.close - ema20) / stdDev).toFixed(2) : "0.00",
    "ATR(14)": atr14.toFixed(4),
    "ADX(14)": (15 + Math.random() * 20).toFixed(1), // Mock value between 15-35
    "Volume": latestCandle.volume,
    "VolumeDelta": (Math.random() * 200 - 100).toFixed(2), // Mocked
  };

  const ohlcvSummary = ohlcvData.slice(-10).map(c => 
    `{t: ${c.time}, o: ${c.open}, h: ${c.high}, l: ${c.low}, c: ${c.close}, v: ${c.volume}}`
  ).join(',\n    ');

  return `
    Recent 10 periods (${timeframeLabel}): 
    [
      ${ohlcvSummary}
    ]
    
    Current Technical Indicators (${timeframeLabel}):
    ${JSON.stringify(indicators, null, 2)}
  `;
};

// --- Core API & Trading Logic ---

export async function checkApiStatus() {
  const isConnected = await ping();
  return isConnected ? 'conectado' : 'desconectado';
}

export async function getAccountBalance() {
    const accountInfo = await getAccountInfo();
    if (!accountInfo || !accountInfo.balances) {
        throw new Error("Resposta da API de conta inválida.");
    }
    const usdtBalance = accountInfo.balances.find((b: { asset: string; }) => b.asset === 'USDT');
    
    if (!usdtBalance || usdtBalance.free === null || usdtBalance.free === undefined) {
        throw new Error("Balanço USDT não encontrado ou inválido na resposta da API.");
    }
    
    const balance = parseFloat(usdtBalance.free);

    if (isNaN(balance)) {
        throw new Error(`Falha ao converter o balanço USDT. Valor recebido: ${usdtBalance.free}`);
    }

    return balance;
}

async function executeTrade(decision: GetLLMTradingDecisionOutput) {
  if (decision.action === "HOLD") {
    console.log("Decisão da IA: HOLD. Nenhuma ordem enviada.");
    return { success: true, orderId: null, message: "Decisão HOLD, nenhuma ordem enviada." };
  }
  
  const notionalToTrade = decision.notional_usdt;
  const notionalString = notionalToTrade.toFixed(2);
  
  // MEXC has a minimum order size of 5 USDT.
  if (parseFloat(notionalString) < 5) { 
    const message = `Tamanho da ordem ($${notionalString}) abaixo do mínimo de $5 da corretora. Nenhuma ordem enviada.`;
    console.log(message);
    return { success: false, orderId: null, message: message };
  }

  try {
    const orderParams: any = {
      symbol: decision.pair.replace("/", ""),
      side: decision.action,
      quoteOrderQty: notionalString,
    };
    
    if (decision.order_type === 'LIMIT' && decision.limit_price) {
        orderParams.type = 'LIMIT';
        orderParams.price = decision.limit_price.toFixed(5);
    } else {
        orderParams.type = 'MARKET';
    }
    
    console.log("Enviando ordem com parâmetros:", orderParams);
    const orderResponse = await createOrder(orderParams);
    console.log("Resposta da Ordem (MEXC):", orderResponse);
    
    if (orderResponse && orderResponse.orderId) {
       return { success: true, orderId: orderResponse.orderId, message: "Ordem enviada com sucesso." };
    } else {
       const errorMessage = (orderResponse as any)?.msg || "Erro desconhecido da API da MEXC.";
       console.error("Falha ao enviar ordem para MEXC:", errorMessage);
       return { success: false, orderId: null, message: errorMessage };
    }

  } catch (error: any) {
    const errorMessage = error.response?.data?.msg || error.message || "Falha ao enviar ordem.";
    console.error("Falha ao executar trade na MEXC:", error.response?.data || error.message);
    return { success: false, orderId: null, message: errorMessage };
  }
}

async function getMarketData(pair: string): Promise<MarketData> {
    console.log(`Buscando dados de mercado REAIS para ${pair} na MEXC.`);
    const [ohlcv1m, ohlcv15m] = await Promise.all([
        getKlineData(pair, '1m', 200),
        getKlineData(pair, '15m', 96)
    ]);

    if (ohlcv1m.length === 0 || ohlcv15m.length === 0) {
        throw new Error(`Dados de mercado insuficientes para ${pair}`);
    }

    const atr14 = calculateATR(ohlcv1m, 14);
    const latestPrice = ohlcv1m[ohlcv1m.length - 1].close;
    
    // Simulate best bid/ask to calculate a realistic spread
    const priceFactor = 1 + (Math.random() - 0.5) * 0.001; // +/- 0.05% fluctuation
    const baseSpread = SPREAD_MAX[pair] || 0.002;
    const spreadFluctuation = Math.random() * baseSpread;
    const bestBid = latestPrice * (1 - (baseSpread / 2) * priceFactor - spreadFluctuation / 2);
    const bestAsk = latestPrice * (1 + (baseSpread / 2) * priceFactor + spreadFluctuation / 2);
    const mid = (bestAsk + bestBid) / 2;
    const spread = (bestAsk - bestBid) / mid;
    

    return {
        pair: pair,
        ohlcv1m: ohlcv1m,
        ohlcv15m: ohlcv15m,
        promptData1m: generateAIPromptData(ohlcv1m, '1m'),
        promptData15m: generateAIPromptData(ohlcv15m, '15m'),
        indicators: {
            atr14: atr14,
            spread: spread,
            slippage: spread / 2, // Estimate slippage as half the spread
            bestBid,
            bestAsk
        }
    };
}

export async function getAIDecisionStream(
    baseAiInput: Pick<GetLLMTradingDecisionInput, 'availableCapital' | 'currentPosition'>,
    tradablePairs: string[],
    execute: boolean = false
) {
  const streamableValue = createStreamableValue();

  (async () => {
    try {
        const position = baseAiInput.currentPosition;
        let finalDecision: GetLLMTradingDecisionOutput;
        let finalExecutionResult: any = null;
        let finalLatestPrice: number;
        let finalPair: string;
        let finalMetadata: any = {};
        
        const processSinglePair = async (pair: string): Promise<{decision: GetLLMTradingDecisionOutput, metadata: any, latestPrice: number, marketData: MarketData}> => {
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Analisando ${pair}...` } });

            const marketData = await getMarketData(pair);
            const latestPrice = marketData.ohlcv1m[marketData.ohlcv1m.length - 1].close;

            // Hard stop for sick books
            if (marketData.indicators.spread > SPREAD_HARD_STOP) {
                return {
                    decision: {
                        pair: pair, action: "HOLD", notional_usdt: 0, order_type: "MARKET", p_up: 0.5, confidence: 1,
                        rationale: `HOLD forçado: Spread anormalmente alto (${(marketData.indicators.spread * 100).toFixed(3)}%) indica um mercado sem liquidez.`
                    },
                    metadata: { expectedValue: -1, spread: marketData.indicators.spread, estimatedFees: ESTIMATED_FEES, estimatedSlippage: marketData.indicators.slippage },
                    latestPrice,
                    marketData
                };
            }
            
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Consultando Watcher AI para ${pair}...` } });
            const watcherInput: FindBestTradingOpportunityInput = {
                pair: pair,
                ohlcvData1m: marketData.promptData1m,
                ohlcvData15m: marketData.promptData15m,
                marketData: {
                    spread: marketData.indicators.spread,
                    slippageEstimate: marketData.indicators.slippage,
                    orderBookImbalance: 0,
                }
            };
            const watcherOutput = await findBestTradingOpportunity(watcherInput);

            // --- EV & Risk Calculation ---
            const p = Math.max(0, Math.min(1, watcherOutput.p_up));
            const atrPct = marketData.indicators.atr14 / latestPrice;
            const stop_pct = Math.max(0.0025, 0.9 * atrPct);
            const take_pct = Math.max(0.004, Math.min(1.5 * stop_pct, 0.015));
            const cost = ESTIMATED_FEES + marketData.indicators.slippage;
            const expectedValue = (p * take_pct) - ((1 - p) * stop_pct) - cost;

            const metadata = {
                expectedValue: expectedValue,
                spread: marketData.indicators.spread,
                estimatedFees: ESTIMATED_FEES,
                estimatedSlippage: marketData.indicators.slippage,
            };

            if (position.status === 'NONE' && expectedValue <= EV_GATE) {
                return {
                    decision: {
                        pair: pair, action: "HOLD", notional_usdt: 0, order_type: "MARKET", p_up: p, confidence: 1, stop_pct, take_pct,
                        rationale: `HOLD forçado por EV abaixo do limiar. EV: ${(expectedValue * 100).toFixed(3)}%`
                    },
                    metadata, latestPrice, marketData
                };
            }
            
            streamableValue.update({ status: 'analyzing', payload: { pair, text: `Consultando Executor AI para ${pair}...` } });
            const executorInput: GetLLMTradingDecisionInput = {
                ...baseAiInput,
                pair: pair,
                p_up: watcherOutput.p_up,
                score: watcherOutput.score,
                context: watcherOutput.context,
                lastPrice: latestPrice,
                atr14: marketData.indicators.atr14,
                spread: marketData.indicators.spread,
                estimatedFees: ESTIMATED_FEES,
                estimatedSlippage: marketData.indicators.slippage,
            };
            const decision = await getLLMTradingDecision(executorInput);
            
            // Override stop/take with our calculated values
            decision.stop_pct = stop_pct;
            decision.take_pct = take_pct;

            return { decision, metadata, latestPrice, marketData };
        };
        
        // 1. If a position is already open, analyze only that pair.
        if (position.status === 'IN_POSITION' && position.pair) {
            finalPair = position.pair;
            const { decision, metadata, latestPrice, marketData } = await processSinglePair(finalPair);
            finalDecision = decision;
            finalMetadata = metadata;
            finalLatestPrice = latestPrice;

        } else {
            // 2. No position open, scan all pairs to find the best opportunity.
            streamableValue.update({ status: 'analyzing', payload: { pair: null, text: 'Iniciando varredura de mercado...' } });

            const opportunityResults = await Promise.all(tradablePairs.map(processSinglePair));
            
            // Find the best opportunity based on Expected Value
            const bestOpportunity = opportunityResults.reduce((best, current) => {
                if (!best) return current;
                // For BUY signals, higher EV is better.
                if (current.decision.action === 'BUY' && best.decision.action !== 'BUY') return current;
                if (current.decision.action !== 'BUY' && best.decision.action === 'BUY') return best;
                return current.metadata.expectedValue > best.metadata.expectedValue ? current : best;
            }, null as (typeof opportunityResults)[0] | null);
            
            
            if (!bestOpportunity) {
                throw new Error("Nenhuma oportunidade válida retornada pela análise.");
            }

            finalPair = bestOpportunity.decision.pair;
            finalDecision = bestOpportunity.decision;
            finalMetadata = bestOpportunity.metadata;
            finalLatestPrice = bestOpportunity.latestPrice;
            const selectedMarketData = bestOpportunity.marketData;
            
            // --- Determine Order Type (MARKET vs LIMIT) ---
            if (finalDecision.action === 'BUY' || finalDecision.action === 'SELL') {
                 if (selectedMarketData.indicators.spread > (SPREAD_MAX[finalPair] || 0.002)) {
                    finalDecision.order_type = 'LIMIT';
                    const midPrice = (selectedMarketData.indicators.bestAsk + selectedMarketData.indicators.bestBid) / 2;
                    
                    if (finalDecision.action === 'BUY') {
                         finalDecision.limit_price = selectedMarketData.indicators.bestBid + Math.min(selectedMarketData.indicators.spread * midPrice * 0.25, midPrice * 0.0005);
                    } else { // SELL
                         finalDecision.limit_price = selectedMarketData.indicators.bestAsk - Math.min(selectedMarketData.indicators.spread * midPrice * 0.25, midPrice * 0.0005);
                    }

                } else {
                    finalDecision.order_type = 'MARKET';
                    finalDecision.limit_price = null;
                }
            }
            
            // --- Sizing with Capped Kelly Criterion ---
            if (finalDecision.action === 'BUY') {
                 const { p_up, stop_pct, take_pct } = finalDecision;
                 const p = Math.max(0, Math.min(1, p_up || 0));
                 
                 if (take_pct && stop_pct) {
                     const rawKelly = (p * take_pct - (1 - p) * stop_pct) / Math.max(take_pct, 1e-6);
                     const kelly = Math.max(0, Math.min(rawKelly, 0.10)); // Kelly fraction capped at 10%
                     
                     let frac: number;
                     if (finalMetadata.expectedValue > 0) {
                        frac = 0.25 * kelly; // Quarter Kelly for positive EV
                     } else {
                        frac = 0.001; // Probe mode for marginal EV (EV > EV_GATE)
                     }
                     
                     frac = Math.min(frac, RISK_PER_TRADE_CAP); // Hard cap on risk per trade
                     
                     const notional = Math.max(10.0, Math.min(baseAiInput.availableCapital * frac, baseAiInput.availableCapital * 0.2));
                     finalDecision.notional_usdt = notional;
                 } else {
                    finalDecision.notional_usdt = 10.0; // Fallback to minimum size
                 }
            }
        }
        
        // 3. Execute trade if applicable
        if (execute && finalDecision.action !== 'HOLD') {
            console.log(`Executando ${finalDecision.action} ${finalDecision.pair}...`);
            finalExecutionResult = await executeTrade(finalDecision);
        } else {
            const message = execute ? `Decisão HOLD, nenhuma ordem enviada.` : `Execução ignorada no modo de simulação.`;
            console.log(message);
            finalExecutionResult = { success: true, message: message, orderId: null };
        }

        const result = { 
            data: finalDecision, 
            error: !finalExecutionResult.success ? `Execução falhou: ${finalExecutionResult.message}` : null,
            executionResult: finalExecutionResult, 
            latestPrice: finalLatestPrice, 
            pair: finalPair,
            metadata: finalMetadata
        };
        streamableValue.done({ status: 'done', payload: result });

    } catch (error) {
        console.error("Erro ao obter decisão de trading da IA:", error);
        const safeError = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        const errorResult = { data: null, error: `Falha ao obter decisão da IA: ${safeError}`, executionResult: null, latestPrice: null, pair: null, metadata: null };
        streamableValue.done({ status: 'done', payload: errorResult });
    }
  })();

  return streamableValue.value;
}

    

      