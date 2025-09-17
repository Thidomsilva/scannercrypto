
import axios from 'axios';
import CryptoJS from 'crypto-js';
import type { OHLCVData } from '@/ai/schemas';

const API_BASE_URL = 'https://api.mexc.com';

// This function now throws an error if keys are missing for authenticated calls.
const getMexcApiKeys = (): { apiKey: string; secretKey: string } => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('As variáveis de ambiente MEXC_API_KEY e MEXC_SECRET_KEY não estão configuradas.');
    throw new Error('As chaves da API da MEXC não estão configuradas no ambiente.');
  }

  return { apiKey, secretKey };
};

const createSignature = (secretKey: string, data: string): string => {
  return CryptoJS.HmacSHA256(data, secretKey).toString(CryptoJS.enc.Hex);
};

interface OrderParams {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'LIMIT_MAKER' | 'TAKE_PROFIT_MARKET' | 'STOP_MARKET';
    quantity?: string;
    quoteOrderQty?: string;
    price?: string;
    newClientOrderId?: string;
}

export const ping = async () => {
  try {
    const apiKey = process.env.MEXC_API_KEY;
    const response = await axios.get(`${API_BASE_URL}/api/v3/ping`, { 
        timeout: 15000,
        headers: apiKey ? { 'X-MEXC-APIKEY': apiKey } : {}
    });
    return response.status === 200;
  } catch (error) {
    console.error("Ping para a API da MEXC falhou:", error);
    return false;
  }
}

/**
 * Fetches real-time ticker data (including best bid/ask) from MEXC.
 * @param symbol The trading pair (e.g., 'BTCUSDT').
 * @returns A promise that resolves to the ticker data object.
 */
export const getTickerData = async (symbol: string): Promise<{ bestBid: number, bestAsk: number }> => {
    const apiKey = process.env.MEXC_API_KEY;
    const url = `${API_BASE_URL}/api/v3/ticker/bookTicker`;
    try {
        const response = await axios.get(url, {
            params: { symbol: symbol.replace('/', '') },
            headers: apiKey ? { 'X-MEXC-APIKEY': apiKey } : {},
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


/**
 * Fetches k-line (candlestick) data from MEXC.
 * @param symbol The trading pair (e.g., 'BTCUSDT').
 * @param interval The interval ('1m', '15m').
 * @param limit The number of data points to retrieve.
 * @returns A promise that resolves to an array of OHLCVData objects.
 */
export const getKlineData = async (symbol: string, interval: string, limit: number): Promise<OHLCVData[]> => {
    const apiKey = process.env.MEXC_API_KEY;
    const url = `${API_BASE_URL}/api/v3/klines`;
    try {
        const response = await axios.get(url, {
            params: {
                symbol: symbol.replace('/', ''),
                interval,
                limit,
            },
            headers: apiKey ? { 'X-MEXC-APIKEY': apiKey } : {},
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


export const getAccountInfo = async () => {
  const { apiKey, secretKey } = getMexcApiKeys(); // Throws error if keys are missing

  const params: Record<string, string> = {
    timestamp: Date.now().toString(),
    recvWindow: '60000',
  };

  const queryString = new URLSearchParams(params).toString();
  const signature = createSignature(secretKey, queryString);
  params.signature = signature;
  
  const url = `${API_BASE_URL}/api/v3/account`;

  try {
    const response = await axios.get(url, {
      headers: { 'X-MEXC-APIKEY': apiKey },
      params: params,
      timeout: 15000,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.msg || error.message;
    console.error('Erro ao obter informações da conta na MEXC:', errorMessage, error.response?.data);
    throw new Error(`Falha ao obter informações da conta: ${errorMessage}`);
  }
}

/**
 * Fetches the user's trade history for a specific symbol.
 * @param symbol The trading pair (e.g., 'BTCUSDT').
 * @param limit The number of trades to retrieve.
 * @returns A promise that resolves to an array of trade objects.
 */
export const getMyTrades = async (symbol: string, limit: number = 50): Promise<any[]> => {
    const { apiKey, secretKey } = getMexcApiKeys(); // Throws error if keys are missing

    const params: Record<string, string> = {
        symbol: symbol.replace('/', ''),
        limit: limit.toString(),
        timestamp: Date.now().toString(),
        recvWindow: '60000',
    };
    
    const queryString = new URLSearchParams(params).toString();
    const signature = createSignature(secretKey, queryString);
    params.signature = signature;

    const url = `${API_BASE_URL}/api/v3/myTrades`;

    try {
        const response = await axios.get(url, {
            headers: { 'X-MEXC-APIKEY': apiKey },
            params: params,
            timeout: 15000,
        });
        return response.data;
    } catch (error: any) {
        const errorMessage = error.response?.data?.msg || error.message;
        console.error(`Erro ao buscar histórico de trades para ${symbol}:`, errorMessage, error.response?.data);
        throw new Error(`Falha ao buscar histórico de trades: ${errorMessage}`);
    }
};


export const createOrder = async (params: OrderParams) => {
    const { apiKey, secretKey } = getMexcApiKeys(); // Throws error if keys are missing
    
    // Use URLSearchParams to ensure correct application/x-www-form-urlencoded format
    const bodyParams = new URLSearchParams({
        symbol: params.symbol.replace('/', ''),
        side: params.side,
        type: params.type,
        timestamp: Date.now().toString(),
        recvWindow: '60000'
    });

    if (params.quoteOrderQty) {
        bodyParams.append('quoteOrderQty', params.quoteOrderQty);
    }
    if (params.quantity) {
        bodyParams.append('quantity', params.quantity);
    }
    if (params.type.includes('LIMIT') && params.price) {
        bodyParams.append('price', params.price);
    }
    if (params.newClientOrderId) {
        bodyParams.append('newClientOrderId', params.newClientOrderId);
    }
    
    const signature = createSignature(secretKey, bodyParams.toString());
    bodyParams.append('signature', signature);

    const url = `${API_BASE_URL}/api/v3/order`;
    
    try {
        const response = await axios.post(url, bodyParams, {
            headers: {
                'X-MEXC-APIKEY': apiKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 15000,
        });
        return response.data;
    } catch (error: any) {
        const errorMessage = error.response?.data?.msg || 'Falha ao enviar ordem.';
        console.error('Erro da API MEXC ao criar ordem:', errorMessage, error.response?.data);
        if (error.response?.data) {
            return error.response.data; // Return the error response from MEXC
        }
        throw new Error(errorMessage);
    }
};
