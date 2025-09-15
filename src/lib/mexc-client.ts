
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
  
  // Create a mutable copy for potential modifications
  const orderParams: Record<string, string | number | undefined> = { ...params };

  // Per MEXC Docs: For MARKET SELL, 'quantity' should be used. For MARKET BUY, 'quoteOrderQty'.
  if (orderParams.type === 'MARKET') {
    if (orderParams.side === 'SELL' && orderParams.quoteOrderQty) {
      // The API expects quantity of the base asset to sell, but our AI provides notional in quote asset.
      // This is a logical mismatch. For now, we will assume the AI provides the correct parameter.
      // A robust solution would fetch the price, calculate quantity, and then sell.
      // For this simulation, we'll log a warning and proceed, which may fail.
      console.warn("Attempting MARKET SELL with quoteOrderQty. The API likely requires 'quantity' of the base asset. This may fail.");
      // We do not auto-convert here to avoid unexpected behavior. The AI flow should be fixed if this is an issue.
    }
  }

  const allParams = { ...orderParams, timestamp };
  
  const queryString = Object.entries(allParams)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
    .join('&');
    
  const signature = createSignature(secretKey, queryString);
  const finalQueryStringWithSignature = `${queryString}&signature=${signature}`;
  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    const response = await axios.post(url, finalQueryStringWithSignature, { 
      headers: {
        'X-MEXC-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC API Error creating order:', error.response?.data || error.message);
    // Return a structured error that the frontend can handle
    throw new Error(error.response?.data?.msg || 'Failed to place order.');
  }
};
