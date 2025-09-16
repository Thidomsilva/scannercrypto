export type OHLCVData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const BASE_PRICES: Record<string, number> = {
    'BTC/USDT': 65000,
    'ETH/USDT': 3500,
    'SOL/USDT': 150,
    'XRP/USDT': 0.47,
    'DOGE/USDT': 0.12,
    'MATIC/USDT': 0.57,
};

const PRICE_VOLATILITY: Record<string, number> = {
    'BTC/USDT': 150,
    'ETH/USDT': 50,
    'SOL/USDT': 5,
    'XRP/USDT': 0.01,
    'DOGE/USDT': 0.005,
    'MATIC/USDT': 0.02,
}

// Generates a single candlestick
const generateCandle = (prevClose: number, time: Date, pair: string): OHLCVData => {
  const volatility = PRICE_VOLATILITY[pair] || 10;
  const open = parseFloat(prevClose.toFixed(4));
  const close = parseFloat((open + (Math.random() - 0.5) * volatility).toFixed(4));
  const high = parseFloat(Math.max(open, close, open + Math.random() * (volatility / 2)).toFixed(4));
  const low = parseFloat(Math.min(open, close, open - Math.random() * (volatility / 2)).toFixed(4));
  const volume = Math.floor(Math.random() * 1000) + 100;
  return {
    time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    open,
    high,
    low,
    close,
    volume,
  };
};

// Generates a series of candlestick data for a given timeframe
export const generateChartData = (count: number, pair: string, intervalMinutes: number): OHLCVData[] => {
  const data: OHLCVData[] = [];
  let lastClose = BASE_PRICES[pair] || 50000;
  const now = new Date();

  for (let i = count - 1; i >= 0; i--) {
    const time = new Date(now.getTime() - i * intervalMinutes * 60000); // Subtract i * interval minutes
    const candle = generateCandle(lastClose, time, pair);
    data.push(candle);
    lastClose = candle.close;
  }
  return data;
};

// Calculates ATR (Average True Range)
const calculateATR = (data: OHLCVData[], period: number): number => {
    if (data.length < period) return 0;
    const trueRanges: number[] = [];
    for (let i = data.length - period; i < data.length; i++) {
        const high = data[i].high;
        const low = data[i].low;
        const prevClose = i > 0 ? data[i - 1].close : data[i].open;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRanges.push(tr);
    }
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}


// Generates a formatted string of mock market data for the AI prompt
export const generateAIPromptData = (ohlcvData: OHLCVData[], timeframeLabel: string): string => {
  if (ohlcvData.length === 0) return "No data available";
  const latestCandle = ohlcvData[ohlcvData.length - 1];
  
  // Calculate some simple indicators from the data
  const recentCloses = ohlcvData.slice(-20).map(c => c.close);
  const ema20 = recentCloses.reduce((acc, val) => acc + val, 0) / recentCloses.length;
  const closes50 = ohlcvData.slice(-50).map(c => c.close);
  const ema50 = closes50.reduce((acc, val) => acc + val, 0) / closes50.length;
  const stdDev = Math.sqrt(recentCloses.map(x => Math.pow(x - ema20, 2)).reduce((a, b) => a + b) / recentCloses.length);

  const atr14 = calculateATR(ohlcvData, 14);

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
```