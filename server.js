const crypto = require('crypto');
const fetch = require('node-fetch'); // ya built-in fetch agar Node 18+ hai

// Bitget API Credentials from Vercel Environment Variables
const BITGET_API_KEY = process.env.BITGET_API_KEY;
const BITGET_SECRET_KEY = process.env.BITGET_SECRET_KEY;
const BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE;
const BITGET_BASE_URL = 'https://api.bitget.com'; // Bitget live endpoint

// Helper function to generate Bitget v2 API Signature
function getBitgetSignature(timestamp, method, requestPath, bodyString = '') {
    const what = timestamp + method.toUpperCase() + requestPath + bodyString;
    return crypto.createHmac('sha256', BITGET_SECRET_KEY).update(what).digest('base64');
}

// Real Trade Execution Route
app.post('/api/trade/execute', async (req, res) => {
    try {
        const { uid, symbol, side, type, price, amount } = req.body;
        
        if (!uid || !amount || amount <= 0) {
            return res.json({ success: false, message: 'Invalid trade parameters' });
        }

        // Check if environment keys are present
        if (!BITGET_API_KEY || !BITGET_SECRET_KEY || !BITGET_PASSPHRASE) {
            return res.json({ success: false, message: 'Bitget API keys missing in Vercel Environment Variables!' });
        }

        // Map order side and type to Bitget format
        // Bitget Spot v2 order parameters
        const endpoint = '/api/v2/spot/trade/place-order';
        const bodyData = {
            symbol: symbol, // e.g. BTCUSDT
            productType: 'spot',
            marginMode: 'isolated', // ya cross
            marginCoin: 'USDT',
            side: side.toLowerCase(), // 'buy' or 'sell'
            orderType: type.toLowerCase() === 'market' ? 'market' : 'limit',
            size: amount.toString(),
            price: type.toLowerCase() === 'limit' ? price.toString() : undefined
        };

        // Remove undefined fields for market orders
        if (bodyData.orderType === 'market') {
            delete bodyData.price;
        }

        const bodyString = JSON.stringify(bodyData);
        const timestamp = Date.now().toString();
        const signature = getBitgetSignature(timestamp, 'POST', endpoint, bodyString);

        // Making the real API call to Bitget Exchange
        const bitgetRes = await fetch(`${BITGET_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ACCESS-KEY': BITGET_API_KEY,
                'ACCESS-SIGN': signature,
                'ACCESS-PASSPHRASE': BITGET_PASSPHRASE,
                'ACCESS-TIMESTAMP': timestamp,
                'locale': 'en_US'
            },
            body: bodyString
        });

        const bitgetResponse = await bitgetRes.json();

        if (bitgetResponse.code === '00000' || bitgetResponse.success === true || (bitgetResponse.msg && bitgetResponse.msg === 'success')) {
            // Order successfully placed on real Bitget Exchange!
            
            // Update local database / portfolio for user records
            const db = dbModule.getData();
            if (!db.trades) db.trades = [];
            
            const executionPrice = price || 0; // Or fetch current market price if market order
            const tradeRecord = {
                id: 'TRD_' + Date.now(),
                uid,
                symbol,
                side: side.toUpperCase(),
                price: executionPrice,
                amount: parseFloat(amount),
                fee: amount * 0.001, // Example fee calculation
                timestamp: new Date().toISOString()
            };

            db.trades.push(tradeRecord);
            dbModule.saveData(db);

            return res.json({ 
                success: true, 
                message: `Real Trade Executed on Bitget Exchange successfully! Order ID: ${bitgetResponse.data?.orderId || 'OK'}` 
            });
        } else {
            return res.json({ 
                success: false, 
                message: `Bitget Error: ${bitgetResponse.msg || 'Failed to place order on exchange'}` 
            });
        }

    } catch (e) {
        console.error('Real trade execution error:', e);
        res.json({ success: false, message: 'Server error during real trade execution' });
    }
});
