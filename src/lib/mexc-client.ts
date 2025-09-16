
import axios from 'axios';
import CryptoJS from 'crypto-js';

const API_BASE_URL = 'https://api.mexc.com';

// This function now returns null if keys are missing, allowing callers to handle it gracefully.
const getMexcApiKeys = (): { apiKey: string; secretKey: string } | null => {
  const apiKey = process.env.MEXC_API_KEY;
  const secretKey = process.env.MEXC_SECRET_KEY;

  // Checks if keys are missing, empty, or still the placeholder values.
  if (!apiKey || !secretKey || apiKey === 'mx0vglyy8aspR5IMQl' || secretKey === 'b6fac4ed1dd94a53a5aa5e40743660c0') {
    console.error('As variáveis de ambiente MEXC_API_KEY e MEXC_SECRET_KEY não estão configuradas ou são inválidas.');
    return null;
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
    // Ping should still check for keys first to provide a clear status.
    const keys = getMexcApiKeys();
    if (!keys) {
        return false;
    }
    const response = await axios.get(`${API_BASE_URL}/api/v3/ping`, { timeout: 10000 });
    return response.status === 200;
  } catch (error) {
    // Don't log spam if it's a simple network error. The UI will reflect the disconnected state.
    return false;
  }
}

export const getAccountInfo = async () => {
  const keys = getMexcApiKeys();
  if (!keys) {
    throw new Error('As chaves da API da MEXC não estão configuradas no ambiente de produção.');
  }
  const { apiKey, secretKey } = keys;

  const timestamp = Date.now();
  const recvWindow = 60000;

  const queryString = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
  const signature = createSignature(secretKey, queryString);
  
  const url = `${API_BASE_URL}/api/v3/account?${queryString}&signature=${signature}`;

  try {
    const response = await axios.get(url, {
      headers: {
        'X-MEXC-APIKEY': apiKey,
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.msg || error.message;
    console.error('Erro ao obter informações da conta na MEXC:', errorMessage, error.response?.data);
    throw new Error(errorMessage);
  }
}

export const createOrder = async (params: OrderParams) => {
    const keys = getMexcApiKeys();
    if (!keys) {
      throw new Error('Não é possível criar a ordem: As chaves da API da MEXC não estão configuradas.');
    }
    const { apiKey, secretKey } = keys;

    const url = `${API_BASE_URL}/api/v3/order`;
    
    const bodyParams: { [key: string]: string } = {
        symbol: params.symbol.replace('/', ''),
        side: params.side,
        type: params.type,
        timestamp: Date.now().toString(),
        recvWindow: '60000'
    };

    if (params.quoteOrderQty) {
        bodyParams.quoteOrderQty = params.quoteOrderQty;
    }
    if (params.quantity) {
        bodyParams.quantity = params.quantity;
    }
     if (params.type !== 'MARKET' && params.price) {
        bodyParams.price = params.price;
    }
    if (params.newClientOrderId) {
        bodyParams.newClientOrderId = params.newClientOrderId;
    }

    const requestBody = new URLSearchParams(bodyParams);
    const signature = createSignature(secretKey, requestBody.toString());
    requestBody.append('signature', signature);

    try {
        const response = await axios.post(url, requestBody.toString(), {
            headers: {
                'X-MEXC-APIKEY': apiKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000,
        });
        return response.data;
    } catch (error: any) {
        const errorMessage = error.response?.data?.msg || 'Falha ao enviar ordem.';
        console.error('Erro da API MEXC ao criar ordem:', errorMessage, error.response?.data);
        throw new Error(errorMessage);
    }
};
