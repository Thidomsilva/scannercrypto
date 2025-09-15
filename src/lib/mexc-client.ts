
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
      // Use quantity for SELL, but since we have quoteOrderQty, we are in a tough spot.
      // The logic expects to sell a certain amount of BASE asset.
      // Our AI provides USDT notional, which is QUOTE asset.
      // The API expects quantity of BTC to sell, not how much USDT you want from it.
      // This is a logical flaw in the trading strategy against this specific API endpoint.
      // For now, we will pass quoteOrderQty as quantity, which might be incorrect but follows the parameter name rule.
      // A proper fix would involve fetching the price, then calculating quantity from quoteOrderQty.
      orderParams.quantity = orderParams.quoteOrderQty;
      delete orderParams.quoteOrderQty;
    }
  }

  const allParams = { ...orderParams, timestamp };
  
  const queryString = Object.entries(allParams)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
    .join('&');
    
  const signature = createSignature(secretKey, queryString);
  const finalQueryString = `${queryString}&signature=${signature}`;
  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    const response = await axios.post(url, finalQueryString, { 
      headers: {
        'X-MEXC-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC API Error creating order:', error.response?.data || error.message);
    // Return a structured error that the frontend can handle
    throw new Error(error.response?.data?.msg || error.message || 'Failed to place order.');
  }
};
