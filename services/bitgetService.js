const axios = require('axios');
const crypto = require('crypto');

// Bitget API Base URL for Spot Trading
const BASE_URL = 'https://api.bitget.com';

// Helper to sign Bitget API requests securely
function signRequest(method, requestPath, body = '') {
    const apiKey = process.env.BITGET_API_KEY || 'bg_c548d9fda7a32eceb14ee1b8607d63f8';
    const secretKey = process.env.BITGET_SECRET_KEY || '78a0c22d32bce51efe378cfcc608a5f1007fe9d833758e93586464b5c600d855';
    const passphrase = process.env.BITGET_PASSPHRASE || 'Mmoossaa35';

    const timestamp = Date.now().toString();
    const signPayload = timestamp + method.toUpperCase() + requestPath + body;
    const signature = crypto.createHmac('sha256', secretKey).update(signPayload).digest('base64');

    return {
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase,
        'Content-Type': 'application/json',
        'Locale': 'en_US'
    };
}

// Fetch Live Ticker / Market Price from Bitget
async function getLiveMarketPrice(symbol = 'BTCUSDT') {
    try {
        const response = await axios.get(`${BASE_URL}/api/v2/spot/market/tickers?symbol=${symbol}`);
        if (response.data && response.data.data && response.data.data.length > 0) {
            return parseFloat(response.data.data[0].lastPr);
        }
        return null;
    } catch (error) {
        console.error('Error fetching Bitget ticker:', error.message);
        return null;
    }
}

// Place Live Spot Order on Bitget
async function placeBitgetSpotOrder(symbol, side, orderType, size, price = 0) {
    try {
        const requestPath = '/api/v2/spot/trade/place-order';
        const bodyData = {
            symbol: symbol,
            productType: 'spot',
            marginMode: 'not_applicable',
            marginCoin: 'usdt',
            side: side.toLowerCase(), // 'buy' or 'sell'
            orderType: orderType.toLowerCase(), // 'limit' or 'market'
            force: 'gtc',
            size: size.toString(),
            price: orderType.toLowerCase() === 'limit' ? price.toString() : undefined
        };

        const bodyString = JSON.stringify(bodyData);
        const headers = signRequest('POST', requestPath, bodyString);

        const response = await axios.post(`${BASE_URL}${requestPath}`, bodyString, { headers });
        return response.data;
    } catch (error) {
        console.error('Bitget Order Execution Error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.message || 'Bitget order execution failed');
    }
}

module.exports = {
    getLiveMarketPrice,
    placeBitgetSpotOrder
};
