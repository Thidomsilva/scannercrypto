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

// Generates a formatted string of mock market data for the AI prompt
export const generateAIPromptData = (ohlcvData: OHLCVData[]): string => {
  const latestCandle = ohlcvData[ohlcvData.length - 1];
  
  const indicators = {
    EMA20: (latestCandle.close * 0.98).toFixed(2),
    EMA50: (latestCandle.close * 0.95).toFixed(2),
    "ATR(14)": (150 + Math.random() * 50).toFixed(2),
    "ADX(14)": (20 + Math.random() * 30).toFixed(1),
    "RSI(14)": (40 + Math.random() * 20).toFixed(1),
    "Bollinger(20,2)": `Upper: ${(latestCandle.close + 200).toFixed(2)}, Lower: ${(latestCandle.close - 200).toFixed(2)}`,
    "Volume Delta": `${(Math.random() > 0.5 ? '+' : '-')}${(Math.random() * 100).toFixed(2)} BTC`,
    "Order Book Imbalance": `${(0.8 + Math.random() * 0.4).toFixed(2)} (Bid/Ask Ratio)`,
  };

  const ohlcvString = ohlcvData.slice(-5).map(c => 
    `{time: ${c.time}, o: ${c.open}, h: ${c.high}, l: ${c.low}, c: ${c.close}, v: ${c.volume}}`
  ).join(', ');

  return `
    Latest OHLCV (1m): [${ohlcvString}]
    Technical Indicators: ${JSON.stringify(indicators, null, 2)}
  `;
};
