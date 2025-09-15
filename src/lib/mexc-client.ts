
import axios from 'axios';
import CryptoJS from 'crypto-js';

const API_BASE_URL = 'https://api.mexc.com';

const getMexcApiKeys = () => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error('As variáveis de ambiente MEXC_API_KEY e MEXC_SECRET_KEY não estão configuradas. Por favor, adicione-as ao seu arquivo .env e reinicie o servidor.');
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
    const response = await axios.get(`${API_BASE_URL}/api/v3/ping`);
    return response.status === 200;
  } catch (error) {
    console.error('MEXC Ping Error:', error);
    return false;
  }
}

export const getAccountInfo = async () => {
  const { apiKey, secretKey } = getMexcApiKeys();
  
  const timestamp = Date.now();
  const recvWindow = 60000;

  // For GET requests, all parameters must be in the query string.
  const queryString = `recvWindow=${recvWindow}&timestamp=${timestamp}`;
  const signature = createSignature(secretKey, queryString);

  // The final URL must contain all parameters including the signature.
  const url = `${API_BASE_URL}/api/v3/account?${queryString}&signature=${signature}`;

  try {
    // Correct implementation for a GET request: All params in the URL, no body, no Content-Type.
    const response = await axios.get(url, {
      headers: {
        'X-MEXC-APIKEY': apiKey,
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC Get Account Info Error:', error.response?.data || error.message);
    throw error;
  }
}

export const createOrder = async (params: OrderParams) => {
  const { apiKey, secretKey } = getMexcApiKeys();
  const timestamp = Date.now();
  const recvWindow = 60000;
  
  const queryParams: Record<string, string | number> = {
    symbol: params.symbol.replace('/',''),
    side: params.side,
    type: params.type,
    timestamp: timestamp,
    recvWindow: recvWindow,
  };

  if (params.quantity) {
    queryParams.quantity = params.quantity;
  }
  if (params.quoteOrderQty) {
    queryParams.quoteOrderQty = params.quoteOrderQty;
  }
  if (params.price) {
    queryParams.price = params.price;
  }
  
  const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();
  const signature = createSignature(secretKey, queryString);
  const fullQueryString = `${queryString}&signature=${signature}`;

  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    const response = await axios.post(url, fullQueryString, { 
      headers: {
        'X-MEXC-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC API Error creating order:', error.response?.data || error.message);
    throw new Error(error.response?.data?.msg || 'Failed to place order.');
  }
};
