const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const db = require('./database/db'); // Aapka database module

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const BITGET_API_KEY = process.env.BITGET_API_KEY;
const BITGET_SECRET_KEY = process.env.BITGET_SECRET_KEY;
const BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE;
const BITGET_BASE_URL = 'api.bitget.com';

function getBitgetSignature(timestamp, method, requestPath, bodyString = '') {
    const what = timestamp + method.toUpperCase() + requestPath + bodyString;
    return crypto.createHmac('sha256', BITGET_SECRET_KEY).update(what).digest('base64');
}

function makeBitgetPostRequest(endpoint, bodyData) {
    return new Promise((resolve, reject) => {
        const bodyString = JSON.stringify(bodyData);
        const timestamp = Date.now().toString();
        const signature = getBitgetSignature(timestamp, 'POST', endpoint, bodyString);

        const options = {
            hostname: BITGET_BASE_URL,
            port: 443,
            path: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ACCESS-KEY': BITGET_API_KEY,
                'ACCESS-SIGN': signature,
                'ACCESS-PASSPHRASE': BITGET_PASSPHRASE,
                'ACCESS-TIMESTAMP': timestamp,
                'locale': 'en_US'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        });

        req.on('error', (error) => { reject(error); });
        req.write(bodyString);
        req.end();
    });
}

// User Init
app.post('/api/user/init', (req, res) => {
    let { uid } = req.body;
    if (!uid) {
        uid = 'UID_' + Math.random().toString(36).substring(2, 10).toUpperCase();
    }
    const dbData = db.getData();
    if (!dbData.wallets) dbData.wallets = [];
    let wallet = dbData.wallets.find(w => w.uid === uid);
    
    if (!wallet) {
        wallet = { uid, usdt_balance: 10.0 }; // Initial bonus/balance
        dbData.wallets.push(wallet);
        db.saveData(dbData);
    }
    res.json({ success: true, uid, wallet });
});

// Portfolio Data
app.get('/api/user/portfolio/:uid', (req, res) => {
    const { uid } = req.params;
    const dbData = db.getData();
    if (!dbData.wallets) dbData.wallets = [];
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) {
        wallet = { uid, usdt_balance: 10.0 };
        dbData.wallets.push(wallet);
        db.saveData(dbData);
    }

    const holdings = (dbData.holdings || []).filter(h => h.uid === uid);
    const trades = (dbData.trades || []).filter(t => t.uid === uid);
    res.json({ success: true, wallet, holdings, trades });
});

// Real Trade Execution with Holdings Update
app.post('/api/trade/execute', async (req, res) => {
    try {
        const { uid, symbol, side, type, amount } = req.body;
        
        if (!uid || !amount || amount <= 0) {
            return res.json({ success: false, message: 'Invalid trade parameters' });
        }

        if (!BITGET_API_KEY || !BITGET_SECRET_KEY || !BITGET_PASSPHRASE) {
            return res.json({ success: false, message: 'Bitget API keys missing in Vercel Environment Variables!' });
        }

        const endpoint = '/api/v2/spot/trade/place-order';
        const bodyData = {
            symbol: symbol,
            productType: 'spot',
            marginMode: 'isolated',
            marginCoin: 'USDT',
            side: side.toLowerCase(), // 'buy' or 'sell'
            orderType: type.toLowerCase() === 'market' ? 'market' : 'limit',
            size: amount.toString()
        };

        const bitgetResponse = await makeBitgetPostRequest(endpoint, bodyData);

        if (bitgetResponse && (bitgetResponse.code === '00000' || bitgetResponse.success === true || bitgetResponse.msg === 'success')) {
            const dbData = db.getData();
            if (!dbData.trades) dbData.trades = [];
            if (!dbData.holdings) dbData.holdings = [];

            // Update Holdings locally
            let holding = dbData.holdings.find(h => h.uid === uid && h.symbol === symbol);
            const tradeAmount = parseFloat(amount);

            if (side.toUpperCase() === 'BUY') {
                if (holding) {
                    holding.amount += tradeAmount;
                } else {
                    dbData.holdings.push({ uid, symbol, amount: tradeAmount, avgPrice: 0 });
                }
            } else { // SELL
                if (holding && holding.amount >= tradeAmount) {
                    holding.amount -= tradeAmount;
                    if (holding.amount <= 0) {
                        dbData.holdings = dbData.holdings.filter(h => !(h.uid === uid && h.symbol === symbol));
                    }
                } else {
                    return res.json({ success: false, message: 'Insufficient coin holding to sell!' });
                }
            }

            const tradeRecord = {
                id: 'TRD_' + Date.now(),
                uid,
                symbol,
                side: side.toUpperCase(),
                price: 0,
                amount: tradeAmount,
                timestamp: new Date().toISOString()
            };

            dbData.trades.push(tradeRecord);
            db.saveData(dbData);

            return res.json({ 
                success: true, 
                message: `Real Trade Executed successfully on Bitget!` 
            });
        } else {
            return res.json({ 
                success: false, 
                message: `Bitget Error: ${bitgetResponse?.msg || 'Failed to place order'}` 
            });
        }

    } catch (e) {
        console.error('Trade execution error:', e);
        res.json({ success: false, message: 'Server error during real trade execution' });
    }
});

// Deposit Request (Goes to Admin Panel)
app.post('/api/deposit/request', (req, res) => {
    const { uid, amount } = req.body;
    const dbData = db.getData();
    if (!dbData.deposits) dbData.deposits = [];

    dbData.deposits.push({
        id: 'DEP_' + Date.now(),
        uid,
        amount: parseFloat(amount),
        status: 'Pending',
        timestamp: new Date().toISOString()
    });
    db.saveData(dbData);
    res.json({ success: true, message: 'Deposit request sent to Admin Panel!' });
});

// Withdrawal Request
app.post('/api/withdraw/request', (req, res) => {
    const { uid, address, amount } = req.body;
    const dbData = db.getData();
    if (!dbData.withdrawals) dbData.withdrawals = [];

    dbData.withdrawals.push({
        id: 'WDR_' + Date.now(),
        uid,
        address,
        amount: parseFloat(amount),
        status: 'Pending',
        timestamp: new Date().toISOString()
    });
    db.saveData(dbData);
    res.json({ success: true, message: 'Withdrawal request sent to Admin Panel!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
