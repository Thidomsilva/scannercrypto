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
const createSignature = (timestamp: string, secretKey: string, queryString: string): string => {
  const dataToSign = timestamp + queryString;
  return CryptoJS.HmacSHA256(dataToSign, secretKey).toString(CryptoJS.enc.Hex);
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

export const createOrder = async (params: OrderParams) => {
  const { apiKey, secretKey } = getMexcApiKeys();

  if (!apiKey || !secretKey) {
    console.error('MEXC_API_KEY or MEXC_SECRET_KEY is not set. Cannot create order.');
    // In a real app, you might not want to throw, but return a structured error.
    // For this simulation, we'll return a failure message consistent with the API.
    return { success: false, msg: 'API keys not configured.' };
  }

  const timestamp = Date.now().toString();
  
  const queryString = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
    
  const signature = createSignature(timestamp, secretKey, queryString);
  const url = `${API_BASE_URL}/api/v3/order?${queryString}&signature=${signature}`;

  try {
    const response = await axios.post(url, null, {
      headers: {
        'X-MEXC-APIKEY': apiKey,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC API Error:', error.response?.data || error.message);
    throw error;
  }
};
