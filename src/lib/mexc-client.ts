
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
  // Para requisições GET, todos os parâmetros devem estar na query string para a assinatura.
  const queryString = `timestamp=${timestamp}`;
  const signature = createSignature(secretKey, queryString);

  // A URL final deve conter todos os parâmetros, incluindo a assinatura.
  const url = `${API_BASE_URL}/api/v3/account?${queryString}&signature=${signature}`;

  try {
    // Implementação correta para uma requisição GET autenticada.
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
    timestamp: timestamp.toString()
  };

  if (params.quantity) queryParams.quantity = params.quantity;
  if (params.quoteOrderQty) queryParams.quoteOrderQty = params.quoteOrderQty;
  if (params.price) queryParams.price = params.price;

  const queryString = new URLSearchParams(queryParams).toString();
  const signature = createSignature(secretKey, queryString);
  queryParams.signature = signature;

  const finalQueryString = new URLSearchParams(queryParams).toString();
  
  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    const response = await axios.post(url, finalQueryString, { 
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
