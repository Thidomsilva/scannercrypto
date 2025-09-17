import axios from 'axios';
import CryptoJS from 'crypto-js';
import type { OHLCVData } from '@/ai/schemas';

const API_BASE_URL = 'https://api.mexc.com';

const getMexcApiKeys = (): { apiKey: string; secretKey: string } | null => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;

  if (!apiKey || !secretKey) {
    return null;
  }

  return { apiKey, secretKey };
};

// --- PUBLIC ENDPOINTS ---
// No API Key or Signature required

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

// --- PRIVATE ENDPOINTS ---
// API Key and Signature required

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

export const getAccountInfo = async () => {
  const keys = getMexcApiKeys();
  if (!keys) {
     throw new Error('As chaves da API da MEXC não estão configuradas no ambiente.');
  }
  const { apiKey, secretKey } = keys;

  const params = {
    timestamp: Date.now().toString(),
    recvWindow: '60000',
  };

  const queryString = new URLSearchParams(params).toString();
  const signature = createSignature(secretKey, queryString);
  
  const finalParams = new URLSearchParams(params);
  finalParams.append('signature', signature);
  
  const url = `${API_BASE_URL}/api/v3/account`;

  try {
    const response = await axios.get(url, {
      headers: { 'X-MEXC-APIKEY': apiKey },
      params: finalParams,
      timeout: 15000,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.msg || error.message;
    console.error('Erro ao obter informações da conta na MEXC:', errorMessage, error.response?.data);
    throw new Error(`Falha ao obter informações da conta: ${errorMessage}`);
  }
}

export const getMyTrades = async (symbol: string, limit: number = 50): Promise<any[]> => {
    const keys = getMexcApiKeys();
    if (!keys) {
        throw new Error('As chaves da API da MEXC não estão configuradas no ambiente.');
    }
    const { apiKey, secretKey } = keys;

    const params = {
        symbol: symbol.replace('/', ''),
        limit: limit.toString(),
        timestamp: Date.now().toString(),
        recvWindow: '60000',
    };
    
    const queryString = new URLSearchParams(params).toString();
    const signature = createSignature(secretKey, queryString);
    
    const finalParams = new URLSearchParams(params);
    finalParams.append('signature', signature);

    const url = `${API_BASE_URL}/api/v3/myTrades`;

    try {
        const response = await axios.get(url, {
            headers: { 'X-MEXC-APIKEY': apiKey },
            params: finalParams,
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
    const keys = getMexcApiKeys();
     if (!keys) {
        throw new Error('As chaves da API da MEXC não estão configuradas no ambiente.');
    }
    const { apiKey, secretKey } = keys;
    
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
