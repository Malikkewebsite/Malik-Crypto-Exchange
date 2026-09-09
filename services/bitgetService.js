const crypto = require('crypto');
const axios = require('axios');

const API_URL = 'https://api.bitget.com'; // Bitget Production API endpoint

// Helper to generate Bitget v2 API Signature
function sign(method, requestPath, body, timestamp, secretKey) {
    const message = timestamp + method.toUpperCase() + requestPath + (body ? JSON.stringify(body) : '');
    return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

async function placeBitgetRealOrder(symbol, side, orderType, size, price) {
    const apiKey = process.env.BITGET_API_KEY;
    const secretKey = process.env.BITGET_SECRET_KEY;
    const passphrase = process.env.BITGET_PASSPHRASE;

    if (!apiKey || !secretKey || !passphrase) {
        throw new Error('Bitget API credentials are not configured on server environment variables.');
    }

    const timestamp = Date.now().toString();
    const method = 'POST';
    const requestPath = '/api/v2/spot/trade/place-order';
    
    const body = {
        symbol: symbol, // e.g., 'BTCUSDT'
        productType: 'USDT-FUTURES' or 'spot',
        marginMode: 'spot',
        side: side.toLowerCase(), // 'buy' or 'sell'
        orderType: orderType.toLowerCase(), // 'market' or 'limit'
        size: size.toString(),
        price: orderType.toLowerCase() === 'limit' ? price.toString() : undefined
    };

    const signature = sign(method, requestPath, body, timestamp, secretKey);

    try {
        const response = await axios.post(`${API_URL}${requestPath}`, body, {
            headers: {
                'ACCESS-KEY': apiKey,
                'ACCESS-SIGN': signature,
                'ACCESS-TIMESTAMP': timestamp,
                'ACCESS-PASSPHRASE': passphrase,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to execute order on Bitget Exchange');
    }
}

module.exports = { placeBitgetRealOrder };
