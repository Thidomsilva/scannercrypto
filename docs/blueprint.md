# **App Name**: CryptoSage

## Core Features:

- Data Ingestion: Collect OHLCV data from MEXC via REST API (1m, 5m candles). Maintain a buffer of the last 200 candles in memory, updated via WebSocket.
- Technical Indicator Calculation: Calculate technical indicators (EMA20, EMA50, ATR(14), ADX(14), RSI(14), Bollinger(20,2), volume delta, order book imbalance) on the candle data.
- AI Prediction Integration: Send snapshots of the data to an external LLM (Gemini/GPT) and receive trading decisions in JSON format. The prompt for the external LLM contains 'tool' to emphasize the need of reasoning to the model.
- Order Execution: Execute MARKET or LIMIT orders via MEXC's REST API based on the LLM's decisions, with automated confirmation and logging.
- Risk Management: Implement a kill-switch that activates if the accumulated daily loss exceeds -2%. Limit the risk per trade to 0.5% of the capital.
- Automated Trading Loop: Run the trading logic in a continuous loop, triggered by each closed 1m candle. Log decisions and P&L.
- Logging and Monitoring: Record detailed logs (timestamp, decision, rationale, PnL) in a .log file for analysis and debugging.

## Style Guidelines:

- Primary color: Deep purple (#673AB7) for sophistication and intelligence.
- Background color: Very dark purple (#1A122B) - nearly black, but reflecting the primary hue - provides a professional, serious feel suitable for a finance application.
- Accent color: Electric green (#7CFC00) to highlight key actions and performance metrics.
- Body and headline font: 'Inter' sans-serif for a clean and modern aesthetic, appropriate for both data display and headlines.
- Minimalist icons to represent different trading actions and statuses.
- Clean, data-dense layout optimized for quick decision-making.