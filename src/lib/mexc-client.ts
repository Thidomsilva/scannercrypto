
import axios from 'axios';
import CryptoJS from 'crypto-js';

const API_BASE_URL = 'https://api.mexc.com';

const getMexcApiKeys = () => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;
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

  if (!apiKey || !secretKey) {
    throw new Error('MEXC_API_KEY or MEXC_SECRET_KEY is not set.');
  }
  
  const timestamp = Date.now();
  const queryString = `recvWindow=5000&timestamp=${timestamp}`;
  const signature = createSignature(secretKey, queryString);
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

  if (!apiKey || !secretKey) {
    console.error('MEXC_API_KEY or MEXC_SECRET_KEY is not set. Cannot create order.');
    return { success: false, msg: 'API keys not configured.', orderId: null };
  }

  const timestamp = Date.now();
  
  // Per MEXC docs, for MARKET SELL, 'quantity' is used for the base asset amount.
  // For MARKET BUY, 'quoteOrderQty' is the amount of quote asset to spend.
  // This logic correctly handles it.
  const orderParams: Record<string, string> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
  };
  
  if (params.type === 'MARKET' && params.side === 'BUY' && params.quoteOrderQty) {
      orderParams.quoteOrderQty = params.quoteOrderQty;
  } else if (params.quantity) { // For LIMIT orders and MARKET SELL
      orderParams.quantity = params.quantity;
  }
  if (params.price) {
      orderParams.price = params.price;
  }


  const allParams: Record<string, string> = {
    ...orderParams,
    recvWindow: "5000",
    timestamp: timestamp.toString()
  };
  
  const queryStringForSignature = Object.entries(allParams)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
    .join('&');
    
  const signature = createSignature(secretKey, queryStringForSignature);
  
  const bodyParams = new URLSearchParams(allParams);
  bodyParams.append('signature', signature);
  
  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    const response = await axios.post(url, bodyParams, { 
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
