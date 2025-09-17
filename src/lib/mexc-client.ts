import axios from 'axios';
import type { OHLCVData } from '@/ai/schemas';

const API_BASE_URL = 'https://api.mexc.com';

// --- PUBLIC ENDPOINTS ---
// Sem chave de API ou assinatura.

export const ping = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/v3/ping`, { timeout: 15000 });
    return response.status === 200;
  } catch (error) {
    console.error("Ping para a API da MEXC falhou:", error);
    return false;
  }
}

export const getTickerData = async (symbol: string): Promise<{ bestBid: number, bestAsk: number }> => {
    const url = `${API_BASE_URL}/api/v3/ticker/bookTicker`;
    try {
        const response = await axios.get(url, {
            params: { symbol: symbol.replace('/', '') },
            timeout: 15000,
        });
        const { bidPrice, askPrice } = response.data;
        return {
            bestBid: parseFloat(bidPrice),
            bestAsk: parseFloat(askPrice),
        };
    } catch (error: any) {
        const errorMessage = error.response?.data?.msg || error.message;
        console.error(`Erro ao buscar dados de ticker para ${symbol} na MEXC:`, errorMessage);
        throw new Error(`Falha ao buscar dados do livro de ordens para ${symbol}: ${errorMessage}`);
    }
};

export const getKlineData = async (symbol: string, interval: string, limit: number): Promise<OHLCVData[]> => {
    const url = `${API_BASE_URL}/api/v3/klines`;
    try {
        const response = await axios.get(url, {
            params: {
                symbol: symbol.replace('/', ''),
                interval,
                limit,
            },
            timeout: 15000,
        });

        const formattedData: OHLCVData[] = response.data.map((d: any[]) => ({
            time: new Date(d[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
        }));

        return formattedData;
    } catch (error: any) {
        const errorMessage = error.response?.data?.msg || error.message;
        console.error(`Erro ao buscar dados de k-line para ${symbol} na MEXC:`, errorMessage);
        throw new Error(`Falha ao buscar dados de mercado para ${symbol}: ${errorMessage}`);
    }
};
