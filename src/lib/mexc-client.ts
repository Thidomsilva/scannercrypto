
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
  const queryString = `recvWindow=5000&timestamp=${timestamp}`;
  const signature = createSignature(secretKey, queryString);
  const url = `${API_BASE_URL}/api/v3/account?${queryString}&signature=${signature}`;

  try {
    // A implementação correta para uma requisição GET autenticada.
    // Todos os parâmetros estão na URL, não há corpo de requisição (body) e não há Content-Type.
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

  // Para MARKET BUY orders, quoteOrderQty é obrigatório. Para outras, quantity.
  if (params.type === 'MARKET' && params.side === 'BUY') {
      if(params.quoteOrderQty) queryParams.quoteOrderQty = params.quoteOrderqty;
  } else if (params.quantity) {
      queryParams.quantity = params.quantity;
  }
  
  if ((params.type === 'LIMIT' || params.type === 'LIMIT_MAKER') && params.price) {
      queryParams.price = params.price;
  }
  
  const queryStringForSignature = new URLSearchParams(queryParams).toString();
    
  const signature = createSignature(secretKey, queryStringForSignature);
  
  const bodyParams = new URLSearchParams(queryStringForSignature);
  bodyParams.append('signature', signature);
  
  const url = `${API_BASE_URL}/api/v3/order`;

  try {
    const response = await axios.post(url, bodyParams, { 
      headers: {
        'X-MEXC-APIKEY': apiKey,
        // O Axios definirá automaticamente o Content-Type para application/x-www-form-urlencoded
        // ao passar um objeto URLSearchParams.
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('MEXC API Error creating order:', error.response?.data || error.message);
    // Re-lança um erro mais específico para ser tratado pela action do servidor.
    throw new Error(error.response?.data?.msg || 'Failed to place order.');
  }
};
