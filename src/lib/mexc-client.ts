
import axios from 'axios';
import CryptoJS from 'crypto-js';

const API_BASE_URL = 'https://api.mexc.com'; // Using mainnet, as testnet is not available for v3 Spot API

const getMexcApiKeys = () => {
  // We will allow these to be undefined for ping checks, but throw if they are needed for trading.
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;
  return { apiKey, secretKey };
};

// Function to create the signature required by MEXC API
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
  const queryString = `timestamp=${timestamp}`;
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

  if (!apiKey || !secretKey) {
    console.error('MEXC_API_KEY or MEXC_SECRET_KEY is not set. Cannot create order.');
    return { success: false, msg: 'API keys not configured.', orderId: null };
  }

  const timestamp = Date.now();
  
  // Combine original params with the timestamp for the signature
  const allParams = { ...params, timestamp };

  const queryString = Object.entries(allParams)
    // Filter out undefined/null values so they are not included in the signature
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
    .join('&');
    
  const signature = createSignature(secretKey, queryString);
  const finalQueryStringWithSignature = `${queryString}&signature=${signature}`;
  
  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    // For POST requests, MEXC expects the signed query string in the request body.
    const response = await axios.post(url, finalQueryStringWithSignature, {
      headers: {
        'X-MEXC-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC API Error creating order:', error.response?.data || error.message);
    throw error;
  }
};
