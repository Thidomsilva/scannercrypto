export type OHLCVData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Generates a single candlestick
const generateCandle = (prevClose: number, time: Date): OHLCVData => {
  const open = parseFloat(prevClose.toFixed(2));
  const close = parseFloat((open + (Math.random() - 0.5) * 150).toFixed(2));
  const high = parseFloat(Math.max(open, close, open + Math.random() * 80).toFixed(2));
  const low = parseFloat(Math.min(open, close, open - Math.random() * 80).toFixed(2));
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

// Generates a series of candlestick data
export const generateChartData = (count = 200): OHLCVData[] => {
  const data: OHLCVData[] = [];
  let lastClose = 65000;
  const now = new Date();

  for (let i = count - 1; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60000); // Subtract i minutes
    const candle = generateCandle(lastClose, time);
    data.push(candle);
    lastClose = candle.close;
  }
  return data;
};

// Determines the trend on a higher timeframe (e.g., 15m)
export const getHigherTimeframeTrend = (ohlcvData: OHLCVData[]): 'UP' | 'DOWN' | 'SIDEWAYS' => {
    if (ohlcvData.length < 50) return 'SIDEWAYS'; // Not enough data

    const recentCloses = ohlcvData.slice(-50).map(c => c.close); // Use a longer period for HTF
    const firstPart = recentCloses.slice(0, 25);
    const secondPart = recentCloses.slice(25);

    const avgFirst = firstPart.reduce((a, b) => a + b, 0) / firstPart.length;
    const avgSecond = secondPart.reduce((a, b) => a + b, 0) / secondPart.length;

    const trendRatio = avgSecond / avgFirst;

    if (trendRatio > 1.01) return 'UP'; // Trend is up if price increased by more than 1%
    if (trendRatio < 0.99) return 'DOWN'; // Trend is down if price decreased by more than 1%
    
    return 'SIDEWAYS';
}


// Generates a formatted string of mock market data for the AI prompt
export const generateAIPromptData = (ohlcvData: OHLCVData[]): string => {
  const latestCandle = ohlcvData[ohlcvData.length - 1];
  
  // Calculate some simple indicators from the data
  const recentCloses = ohlcvData.slice(-20).map(c => c.close);
  const ema20 = recentCloses.reduce((acc, val) => acc + val, 0) / recentCloses.length;
  const closes50 = ohlcvData.slice(-50).map(c => c.close);
  const ema50 = closes50.reduce((acc, val) => acc + val, 0) / closes50.length;
  const stdDev = Math.sqrt(recentCloses.map(x => Math.pow(x - ema20, 2)).reduce((a, b) => a + b) / recentCloses.length);

  const indicators = {
    "Price": latestCandle.close.toFixed(2),
    "EMA(20)": ema20.toFixed(2),
    "EMA(50)": ema50.toFixed(2),
    "RSI(14)": (40 + Math.random() * 20).toFixed(1), // Mocked for simplicity
    "MACD(12,26)": `${(Math.random() * 100 - 50).toFixed(2)} (Signal: ${(Math.random() * 80 - 40).toFixed(2)})`,
    "BollingerBands(20,2)": `Upper: ${(ema20 + 2 * stdDev).toFixed(2)}, Mid: ${ema20.toFixed(2)}, Lower: ${(ema20 - 2 * stdDev).toFixed(2)}`,
    "ATR(14)": (150 + Math.random() * 50).toFixed(2),
    "ADX(14)": (20 + Math.random() * 30).toFixed(1),
    "Volume": latestCandle.volume,
    "Support/Resistance": `S1: ${(latestCandle.close * 0.99).toFixed(0)}, R1: ${(latestCandle.close * 1.01).toFixed(0)}`, // Basic pivot
  };

  const ohlcvSummary = ohlcvData.slice(-10).map(c => 
    `{t: ${c.time}, o: ${c.open}, h: ${c.high}, l: ${c.low}, c: ${c.close}, v: ${c.volume}}`
  ).join(',\n    ');

  return `
    Recent 10 periods (1m): 
    [
      ${ohlcvSummary}
    ]
    
    Current Technical Indicators:
    ${JSON.stringify(indicators, null, 2)}
  `;
};
