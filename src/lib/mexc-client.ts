import axios from 'axios';
import CryptoJS from 'crypto-js';

const API_BASE_URL = 'https://api.mexc.com'; // Using mainnet, as testnet is not available for v3 Spot API

const getMexcApiKeys = () => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error('MEXC_API_KEY or MEXC_SECRET_KEY is not set in .env file');
  }

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

export const createOrder = async (params: OrderParams) => {
  const { apiKey, secretKey } = getMexcApiKeys();
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
