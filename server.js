const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const db = require('./database/db'); // Aapka local database module

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const BITGET_API_KEY = process.env.BITGET_API_KEY;
const BITGET_SECRET_KEY = process.env.BITGET_SECRET_KEY;
const BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE;
const BITGET_BASE_URL = 'api.bitget.com';

// Bitget API Signature Generator
function getBitgetSignature(timestamp, method, requestPath, bodyString = '') {
    const what = timestamp + method.toUpperCase() + requestPath + bodyString;
    return crypto.createHmac('sha256', BITGET_SECRET_KEY).update(what).digest('base64');
}

// HTTPS helper for Bitget API
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
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (error) => { reject(error); });
        req.write(bodyString);
        req.end();
    });
}

// Fetch live Bitget Spot Markets using HTTPS
app.get('/api/bitget/markets', async (req, res) => {
    const options = {
        hostname: BITGET_BASE_URL,
        port: 443,
        path: '/api/v2/spot/market/tickers',
        method: 'GET'
    };

    const externalReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => { data += chunk; });
        apiRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                if (parsed && parsed.data) {
                    res.json({ success: true, markets: parsed.data });
                } else {
                    res.json({ success: false, markets: [] });
                }
            } catch (e) {
                res.status(500).json({ success: false, markets: [] });
            }
        });
    });

    externalReq.on('error', () => {
        res.status(500).json({ success: false, markets: [] });
    });
    externalReq.end();
});

// User Init & Wallet Sync
app.post('/api/user/init', (req, res) => {
    let { uid } = req.body;
    if (!uid) {
        uid = 'UID_' + Math.random().toString(36).substring(2, 10).toUpperCase();
    }
    const dbData = db.getData();
    if (!dbData.wallets) dbData.wallets = [];
    let wallet = dbData.wallets.find(w => w.uid === uid);
    
    if (!wallet) {
        wallet = { uid, usdt_balance: 0.0 };
        dbData.wallets.push(wallet);
        db.saveData(dbData);
    }

    res.json({ success: true, uid, wallet });
});

// User Portfolio
app.get('/api/user/portfolio/:uid', (req, res) => {
    const { uid } = req.params;
    const dbData = db.getData();
    if (!dbData.wallets) dbData.wallets = [];
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) {
        wallet = { uid, usdt_balance: 0.0 };
        dbData.wallets.push(wallet);
        db.saveData(dbData);
    }

    const holdings = (dbData.holdings || []).filter(h => h.uid === uid);
    const trades = (dbData.trades || []).filter(t => t.uid === uid);
    const deposits = (dbData.deposits || []).filter(d => d.uid === uid);
    const withdrawals = (dbData.withdrawals || []).filter(w => w.uid === uid);

    res.json({ success: true, wallet, holdings, trades, deposits, withdrawals });
});

// Real Trade Execution Route (Bitget Live API)
app.post('/api/trade/execute', async (req, res) => {
    try {
        const { uid, symbol, side, type, price, amount } = req.body;
        
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
            side: side.toLowerCase(),
            orderType: type.toLowerCase() === 'market' ? 'market' : 'limit',
            size: amount.toString(),
            price: type.toLowerCase() === 'limit' ? price.toString() : undefined
        };

        if (bodyData.orderType === 'market') {
            delete bodyData.price;
        }

        const bitgetResponse = await makeBitgetPostRequest(endpoint, bodyData);

        if (bitgetResponse && (bitgetResponse.code === '00000' || bitgetResponse.success === true || bitgetResponse.msg === 'success')) {
            const dbData = db.getData();
            if (!dbData.trades) dbData.trades = [];
            
            const tradeRecord = {
                id: 'TRD_' + Date.now(),
                uid,
                symbol,
                side: side.toUpperCase(),
                price: price || 0,
                amount: parseFloat(amount),
                fee: amount * 0.001,
                timestamp: new Date().toISOString()
            };

            dbData.trades.push(tradeRecord);
            db.saveData(dbData);

            return res.json({ 
                success: true, 
                message: `Real Trade Executed on Bitget successfully! ID: ${bitgetResponse.data?.orderId || 'OK'}` 
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

// Deposit Request Route (Goes to Admin Panel as Pending)
app.post('/api/deposit/request', (req, res) => {
    const { uid, method, amount, details } = req.body;
    if (!uid || !amount || amount <= 0) {
        return res.json({ success: false, message: 'Invalid amount' });
    }

    const dbData = db.getData();
    if (!dbData.deposits) dbData.deposits = [];

    const deposit = {
        id: 'DEP_' + Date.now(),
        uid,
        method: method || 'USDT TRC20',
        amount: parseFloat(amount),
        details: details || '',
        status: 'Pending',
        timestamp: new Date().toISOString()
    };
    dbData.deposits.push(deposit);
    db.saveData(dbData);

    res.json({ success: true, message: 'Deposit request submitted to Admin Panel successfully!' });
});

// Withdrawal Request Route
app.post('/api/withdraw/request', (req, res) => {
    const { uid, address, amount } = req.body;
    if (!uid || !amount || !address || amount <= 0) {
        return res.json({ success: false, message: 'Invalid withdrawal details' });
    }

    const dbData = db.getData();
    if (!dbData.withdrawals) dbData.withdrawals = [];

    const withdrawal = {
        id: 'WDR_' + Date.now(),
        uid,
        address,
        amount: parseFloat(amount),
        status: 'Pending',
        timestamp: new Date().toISOString()
    };
    dbData.withdrawals.push(withdrawal);
    db.saveData(dbData);

    res.json({ success: true, message: 'Withdrawal request submitted to Admin Panel successfully!' });
});

// Admin Data Route
app.post('/api/admin/data', (req, res) => {
    const { password } = req.body;
    if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35#')) {
        return res.json({ success: false, message: 'Invalid Admin Password' });
    }
    const dbData = db.getData();
    res.json({ 
        success: true, 
        deposits: dbData.deposits || [], 
        withdrawals: dbData.withdrawals || [], 
        admin_profit: 0 
    });
});

// Admin Action (Approve/Reject) Route
app.post('/api/admin/action', (req, res) => {
    const { password, type, id, status } = req.body;
    if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35#')) {
        return res.json({ success: false, message: 'Invalid Admin Password' });
    }

    const dbData = db.getData();

    if (type === 'deposit') {
        const deposit = (dbData.deposits || []).find(d => d.id === id);
        if (!deposit) return res.json({ success: false, message: 'Deposit not found' });
        
        deposit.status = status;
        if (status === 'Approved') {
            if (!dbData.wallets) dbData.wallets = [];
            let wallet = dbData.wallets.find(w => w.uid === deposit.uid);
            if (!wallet) {
                wallet = { uid: deposit.uid, usdt_balance: 0 };
                dbData.wallets.push(wallet);
            }
            wallet.usdt_balance += parseFloat(deposit.amount);
        }
        db.saveData(dbData);
        return res.json({ success: true, message: `Deposit ${status} successfully!` });
    }

    if (type === 'withdrawal') {
        const withdrawal = (dbData.withdrawals || []).find(w => w.id === id);
        if (!withdrawal) return res.json({ success: false, message: 'Withdrawal not found' });

        withdrawal.status = status;
        db.saveData(dbData);
        return res.json({ success: true, message: `Withdrawal ${status} successfully!` });
    }

    res.json({ success: false, message: 'Invalid action type' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
