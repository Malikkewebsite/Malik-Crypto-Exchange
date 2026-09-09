const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const db = require('./database/db');

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

// Fetch Bitget markets
app.get('/api/bitget/markets', async (req, res) => {
    const options = { hostname: BITGET_BASE_URL, port: 443, path: '/api/v2/spot/market/tickers', method: 'GET' };
    const externalReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => { data += chunk; });
        apiRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                res.json({ success: true, markets: parsed?.data || [] });
            } catch (e) { res.status(500).json({ success: false, markets: [] }); }
        });
    });
    externalReq.on('error', () => { res.status(500).json({ success: false, markets: [] }); });
    externalReq.end();
});

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
        wallet = { uid, usdt_balance: 0.0 };
        dbData.wallets.push(wallet);
        db.saveData(dbData);
    }
    res.json({ success: true, uid, wallet });
});

// User Portfolio with Full Financial History & Profit/Loss Calculation
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

    // Calculate Financial Metrics (with 2% fee factored in)
    const totalDeposited = deposits.filter(d => d.status === 'Approved').reduce((acc, d) => acc + d.amount, 0);
    const totalWithdrawn = withdrawals.filter(w => w.status === 'Approved').reduce((acc, w) => acc + w.amount, 0);
    const totalFeesPaid = trades.reduce((acc, t) => acc + (t.fee || 0), 0);
    
    // Net Profit / Loss = Current Wallet Balance + Total Withdrawn - Total Deposited
    const netProfitLoss = (wallet.usdt_balance + totalWithdrawn) - totalDeposited;

    res.json({ 
        success: true, 
        wallet, 
        holdings, 
        trades, 
        deposits, 
        withdrawals,
        stats: {
            totalDeposited,
            totalWithdrawn,
            totalFeesPaid,
            netProfitLoss
        }
    });
});

// Trade Execution with 2% Fee Cut on both Buy and Sell
app.post('/api/trade/execute', async (req, res) => {
    try {
        const { uid, symbol, side, type, price, amount } = req.body;
        
        if (!uid || !amount || amount <= 0) {
            return res.json({ success: false, message: 'Invalid trade parameters' });
        }

        const dbData = db.getData();
        if (!dbData.wallets) dbData.wallets = [];
        let wallet = dbData.wallets.find(w => w.uid === uid);
        if (!wallet) return res.json({ success: false, message: 'Wallet not found' });

        const tradeAmountUSDT = parseFloat(amount);
        const fee = tradeAmountUSDT * 0.02; // Exact 2% fee
        const effectiveAmount = tradeAmountUSDT - fee;

        if (side.toUpperCase() === 'BUY') {
            if (wallet.usdt_balance < tradeAmountUSDT) {
                return res.json({ success: false, message: 'Insufficient USDT balance including 2% fee!' });
            }
            wallet.usdt_balance -= tradeAmountUSDT; // Deduct total amount + fee from wallet
        } else {
            // SELL logic
            if (!dbData.holdings) dbData.holdings = [];
            let holding = dbData.holdings.find(h => h.uid === uid && h.symbol === symbol);
            if (!holding || holding.amount < tradeAmountUSDT) {
                return res.json({ success: false, message: 'Insufficient coin holding to sell!' });
            }
            holding.amount -= tradeAmountUSDT;
            wallet.usdt_balance += effectiveAmount; // Add proceed after 2% fee cut
        }

        // Send to Bitget Live API if keys available
        if (BITGET_API_KEY && BITGET_SECRET_KEY && BITGET_PASSPHRASE) {
            try {
                await makeBitgetPostRequest('/api/v2/spot/trade/place-order', {
                    symbol, productType: 'spot', marginMode: 'isolated', marginCoin: 'USDT',
                    side: side.toLowerCase(), orderType: type.toLowerCase() === 'market' ? 'market' : 'limit',
                    size: effectiveAmount.toString()
                });
            } catch (err) { console.error('Bitget API notice:', err); }
        }

        if (!dbData.trades) dbData.trades = [];
        const tradeRecord = {
            id: 'TRD_' + Date.now(),
            uid,
            symbol,
            side: side.toUpperCase(),
            price: price || 0,
            amount: effectiveAmount,
            fee: fee,
            timestamp: new Date().toISOString()
        };

        dbData.trades.push(tradeRecord);
        if (!dbData.admin_fees) dbData.admin_fees = 0;
        dbData.admin_fees += fee;

        db.saveData(dbData);
        return res.json({ success: true, message: `Trade executed successfully! 2% fee ($${fee.toFixed(2)}) applied.` });

    } catch (e) {
        console.error('Trade error:', e);
        res.json({ success: false, message: 'Server error during trade execution' });
    }
});

// Deposit Request
app.post('/api/deposit/request', (req, res) => {
    const { uid, method, amount, details } = req.body;
    if (!uid || !amount || amount <= 0) return res.json({ success: false, message: 'Invalid amount' });

    const dbData = db.getData();
    if (!dbData.deposits) dbData.deposits = [];
    dbData.deposits.push({
        id: 'DEP_' + Date.now(),
        uid,
        method: method || 'USDT TRC20',
        amount: parseFloat(amount),
        details: details || '',
        status: 'Pending',
        timestamp: new Date().toISOString()
    });
    db.saveData(dbData);
    res.json({ success: true, message: 'Deposit request submitted successfully!' });
});

// Withdrawal Request
app.post('/api/withdraw/request', (req, res) => {
    const { uid, address, amount } = req.body;
    if (!uid || !amount || !address || amount <= 0) return res.json({ success: false, message: 'Invalid details' });

    const dbData = db.getData();
    if (!dbData.wallets) dbData.wallets = [];
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet || wallet.usdt_balance < parseFloat(amount)) {
        return res.json({ success: false, message: 'Insufficient balance for withdrawal' });
    }

    wallet.usdt_balance -= parseFloat(amount); // Deduct immediately on request

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
    res.json({ success: true, message: 'Withdrawal request submitted successfully!' });
});

// Admin Data
app.post('/api/admin/data', (req, res) => {
    const { password } = req.body;
    if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35#')) {
        return res.json({ success: false, message: 'Invalid Password' });
    }
    const dbData = db.getData();
    res.json({ 
        success: true, 
        deposits: dbData.deposits || [], 
        withdrawals: dbData.withdrawals || [], 
        trades: dbData.trades || [],
        wallets: dbData.wallets || [],
        admin_profit: dbData.admin_fees || 0 
    });
});

// Admin Action
app.post('/api/admin/action', (req, res) => {
    const { password, type, id, status } = req.body;
    if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35#')) {
        return res.json({ success: false, message: 'Invalid Password' });
    }

    const dbData = db.getData();
    if (type === 'deposit') {
        const deposit = (dbData.deposits || []).find(d => d.id === id);
        if (!deposit) return res.json({ success: false, message: 'Not found' });
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
        return res.json({ success: true, message: `Deposit ${status}` });
    }

    if (type === 'withdrawal') {
        const withdrawal = (dbData.withdrawals || []).find(w => w.id === id);
        if (!withdrawal) return res.json({ success: false, message: 'Not found' });
        withdrawal.status = status;
        if (status === 'Rejected') {
            // Refund balance if rejected
            let wallet = dbData.wallets.find(w => w.uid === withdrawal.uid);
            if (wallet) wallet.usdt_balance += parseFloat(withdrawal.amount);
        }
        db.saveData(dbData);
        return res.json({ success: true, message: `Withdrawal ${status}` });
    }

    res.json({ success: false, message: 'Invalid type' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
