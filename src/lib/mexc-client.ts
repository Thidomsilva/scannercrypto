
import axios from 'axios';
import CryptoJS from 'crypto-js';

const API_BASE_URL = 'https://api.mexc.com';

const getMexcApiKeys = () => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error('As variáveis de ambiente MEXC_API_KEY e MEXC_SECRET_KEY não estão configuradas. Por favor, adicione-as ao seu arquivo .env.');
  }

  return { apiKey, secretKey };
};

const createSignature = (secretKey: string, queryString: string): string => {
  return CryptoJS.HmacSHA256(queryString, secretKey).toString(CryptoJS.enc.Hex);
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
  const queryString = `recvWindow=5000&timestamp=${timestamp}`;
  const signature = createSignature(secretKey, queryString);
  const url = `${API_BASE_URL}/api/v3/account?${queryString}&signature=${signature}`;

  try {
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
  
  const queryParams: Record<string, string> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    timestamp: timestamp.toString(),
    recvWindow: '5000',
  };

  if (params.type === 'MARKET' && params.side === 'BUY' && params.quoteOrderQty) {
      queryParams.quoteOrderQty = params.quoteOrderQty;
  } else if (params.quantity) {
      queryParams.quantity = params.quantity;
  }
  
  if (params.type === 'LIMIT' && params.price) {
      queryParams.price = params.price;
  }
  
  const queryStringForSignature = Object.entries(queryParams)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
    
  const signature = createSignature(secretKey, queryStringForSignature);
  queryParams.signature = signature;
  
  const bodyParams = new URLSearchParams(queryParams);
  
  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    const response = await axios.post(url, bodyParams, { 
      headers: {
        'X-MEXC-APIKEY': apiKey,
        // Axios will automatically set Content-Type to application/x-www-form-urlencoded
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC API Error creating order:', error.response?.data || error.message);
    throw new Error(error.response?.data?.msg || 'Failed to place order.');
  }
};
