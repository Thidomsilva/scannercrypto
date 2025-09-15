import axios from 'axios';
import CryptoJS from 'crypto-js';

const API_BASE_URL = 'https://api.mexc.com';

const getMexcApiKeys = () => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;

  if (!apiKey || !secretKey) {
    const errorMessage = 'As variáveis de ambiente MEXC_API_KEY e MEXC_SECRET_KEY não estão configuradas. Por favor, adicione-as ao seu arquivo .env e reinicie o servidor.';
    console.error(errorMessage);
    throw new Error(errorMessage);
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
  const recvWindow = 60000; // Increased window to avoid timing issues

  const queryString = `recvWindow=${recvWindow}&timestamp=${timestamp}`;
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
  const recvWindow = 60000; // Increased window

  // Build the parameter object
  const paramObject: { [key: string]: string } = {
    symbol: params.symbol.replace('/', ''),
    side: params.side,
    type: params.type,
    timestamp: timestamp.toString(),
    recvWindow: recvWindow.toString(),
  };

  if (params.quantity) paramObject.quantity = params.quantity;
  if (params.quoteOrderQty) paramObject.quoteOrderQty = params.quoteOrderQty;
  if (params.type !== 'MARKET' && params.price) {
    paramObject.price = params.price;
  }
  if (params.newClientOrderId) paramObject.newClientOrderId = params.newClientOrderId;

  // Build the body string for signing and for the request
  const bodyString = Object.keys(paramObject)
    .map(key => `${key}=${encodeURIComponent(paramObject[key])}`)
    .join('&');
  
  const signature = createSignature(secretKey, bodyString);
  const finalBody = `${bodyString}&signature=${signature}`;
  
  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    const response = await axios.post(url, finalBody, { 
      headers: {
        'X-MEXC-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC API Error creating order:', error.response?.data || error.message);
    throw new Error(error.response?.data?.msg || 'Failed to place order.');
  }
};