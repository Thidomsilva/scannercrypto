
import axios from 'axios';
import CryptoJS from 'crypto-js';
import type { OHLCVData } from '@/ai/schemas';

const API_BASE_URL = 'https://api.mexc.com';

// This function now returns null if keys are missing, allowing callers to handle it gracefully.
const getMexcApiKeys = (): { apiKey: string; secretKey: string } | null => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;

  // Checks if keys are missing or empty.
  if (!apiKey || !secretKey) {
    console.warn('As variáveis de ambiente MEXC_API_KEY e MEXC_SECRET_KEY não estão configuradas.');
    return null;
  }

  return { apiKey, secretKey };
};

const createSignature = (secretKey: string, data: string): string => {
  return CryptoJS.HmacSHA256(data, secretKey).toString(CryptoJS.enc.Hex);
};

interface OrderParams {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'LIMIT_MAKER';
    quantity?: string;
    quoteOrderQty?: string;
    price?: string;
    newClientOrderId?: string;
}

export const ping = async () => {
  try {
    // Ping should still check for keys first to provide a clear status.
    const keys = getMexcApiKeys();
    if (!keys) {
        return false;
    }
    const response = await axios.get(`${API_BASE_URL}/api/v3/ping`, { timeout: 10000 });
    return response.status === 200;
  } catch (error) {
    // Don't log spam if it's a simple network error. The UI will reflect the disconnected state.
    return false;
  }
}

/**
 * Fetches real-time ticker data (including best bid/ask) from MEXC.
 * @param symbol The trading pair (e.g., 'BTCUSDT').
 * @returns A promise that resolves to the ticker data object.
 */
export const getTickerData = async (symbol: string): Promise<{ bestBid: number, bestAsk: number }> => {
    const url = `${API_BASE_URL}/api/v3/ticker/bookTicker`;
    try {
        const response = await axios.get(url, {
            params: { symbol: symbol.replace('/', '') },
            timeout: 10000,
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
    const url = `${API_BASE_URL}/api/v3/klines`;
    try {
        const response = await axios.get(url, {
            params: {
                symbol: symbol.replace('/', ''),
                interval,
                limit,
            },
            timeout: 10000,
        });

        // The API returns an array of arrays. We need to map it to our OHLCVData structure.
        // [open time, open, high, low, close, volume, close time, quote asset volume, ...]
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
  const keys = getMexcApiKeys();
  if (!keys) {
    throw new Error('As chaves da API da MEXC não estão configuradas no ambiente de produção.');
  }
  const { apiKey, secretKey } = keys;

  const timestamp = Date.now();
  const recvWindow = 60000;

  const queryString = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
  const signature = createSignature(secretKey, queryString);
  
  const url = `${API_BASE_URL}/api/v3/account?${queryString}&signature=${signature}`;

  try {
    const response = await axios.get(url, {
      headers: {
        'X-MEXC-APIKEY': apiKey,
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.msg || error.message;
    console.error('Erro ao obter informações da conta na MEXC:', errorMessage, error.response?.data);
    throw new Error(errorMessage);
  }
}

export const createOrder = async (params: OrderParams) => {
    const keys = getMexcApiKeys();
    if (!keys) {
      throw new Error('Não é possível criar a ordem: As chaves da API da MEXC não estão configuradas.');
    }
    const { apiKey, secretKey } = keys;
    
    // All parameters must be included in the signature string.
    const queryParams: Record<string, string | number> = {
        symbol: params.symbol.replace('/', ''),
        side: params.side,
        type: params.type,
        timestamp: Date.now(),
        recvWindow: 60000
    };

    if (params.quoteOrderQty) {
        queryParams.quoteOrderQty = params.quoteOrderQty;
    }
    if (params.quantity) {
        queryParams.quantity = params.quantity;
    }
    if (params.type.includes('LIMIT') && params.price) {
        queryParams.price = params.price;
    }
    if (params.newClientOrderId) {
        queryParams.newClientOrderId = params.newClientOrderId;
    }
    
    const queryString = Object.entries(queryParams)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
        
    const signature = createSignature(secretKey, queryString);
    
    const url = `${API_BASE_URL}/api/v3/order?${queryString}&signature=${signature}`;
    
    try {
        const response = await axios.post(url, null, {
            headers: {
                'X-MEXC-APIKEY': apiKey,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });
        return response.data;
    } catch (error: any) {
        const errorMessage = error.response?.data?.msg || 'Falha ao enviar ordem.';
        console.error('Erro da API MEXC ao criar ordem:', errorMessage, error.response?.data);
        if (error.response?.data) {
            return error.response.data;
        }
        throw new Error(errorMessage);
    }
};

