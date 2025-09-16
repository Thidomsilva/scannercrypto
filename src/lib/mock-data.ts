
export type OHLCVData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
// This file is now deprecated for generating live market data.
// It is kept for potential testing or fallback scenarios.
// The primary data source is now `getKlineData` in `mexc-client.ts`.
// Indicator calculation logic has been moved to `actions.tsx`.
