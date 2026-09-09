const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const db = require('./database/db');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Bitget API Helper for Real Trading
const API_URL = 'https://api.bitget.com';

function sign(method, requestPath, body, timestamp, secretKey) {
    const message = timestamp + method.toUpperCase() + requestPath + (body ? JSON.stringify(body) : '');
    return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

async function executeBitgetApiOrder(symbol, side, orderType, size, price) {
    const apiKey = process.env.BITGET_API_KEY;
    const secretKey = process.env.BITGET_SECRET_KEY;
    const passphrase = process.env.BITGET_PASSPHRASE;

    if (!apiKey || !secretKey || !passphrase) {
        throw new Error('Bitget API credentials missing');
    }

    const timestamp = Date.now().toString();
    const method = 'POST';
    const requestPath = '/api/v2/spot/trade/place-order';
    
    const body = {
        symbol: symbol,
        productType: 'spot',
        side: side.toLowerCase(),
        orderType: orderType.toLowerCase(),
        size: size.toString(),
        force: 'normal'
    };
    if (orderType.toLowerCase() === 'limit') {
        body.price = price.toString();
    }

    const signature = sign(method, requestPath, body, timestamp, secretKey);

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
}

// 1. User Initialization & Isolated Wallet
app.post('/api/user/init', (req, res) => {
    let { uid } = req.body;
    if (!uid) {
        uid = 'UID_' + Math.random().toString(36).substring(2, 10).toUpperCase();
    }
    const dbData = db.getData();
    let user = dbData.users.find(u => u.uid === uid);
    
    if (!user) {
        user = { uid, created_at: new Date().toISOString() };
        dbData.users.push(user);
        dbData.wallets.push({ uid, usdt_balance: 1000.0, locked_balance: 0.0 });
        db.saveData(dbData);
    }
    
    let wallet = dbData.wallets.find(w => w.uid === uid) || { usdt_balance: 1000.0, locked_balance: 0.0 };
    res.json({ success: true, uid, wallet });
});

// 2. Portfolio & Holdings
app.get('/api/user/portfolio/:uid', (req, res) => {
    const { uid } = req.params;
    const dbData = db.getData();
    const wallet = dbData.wallets.find(w => w.uid === uid) || { usdt_balance: 0, locked_balance: 0 };
    const holdings = dbData.holdings.filter(h => h.uid === uid);
    const trades = dbData.trades.filter(t => t.uid === uid);
    const deposits = dbData.deposits.filter(d => d.uid === uid);
    const withdrawals = dbData.withdrawals.filter(w => w.uid === uid);

    res.json({ success: true, wallet, holdings, trades, deposits, withdrawals });
});

// 3. Real Trading Route with Strict Isolated Balance Validation
app.post('/api/trade/execute', async (req, res) => {
    const { uid, symbol, side, type, price, amount } = req.body;
    if (!uid || !symbol || !side || !amount) {
        return res.status(400).json({ success: false, message: 'Invalid trading parameters' });
    }

    const dbData = db.getData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) return res.status(400).json({ success: false, message: 'Wallet not found' });

    let currentPrice = price || 78950;
    try {
        const response = await axios.get(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${symbol}`);
        if (response.data && response.data.data && response.data.data.length > 0) {
            currentPrice = parseFloat(response.data.data[0].lastPr);
        }
    } catch (e) {}

    const totalCost = currentPrice * amount;
    const feeRate = 0.001; // 0.1% fee
    const fee = totalCost * feeRate;
    const totalRequired = totalCost + fee;

    if (side.toUpperCase() === 'BUY') {
        if (wallet.usdt_balance < totalRequired) {
            return res.status(400).json({ success: false, message: 'Insufficient USDT balance in your isolated wallet' });
        }
        wallet.usdt_balance -= totalRequired;

        let holding = dbData.holdings.find(h => h.uid === uid && h.symbol === symbol);
        if (holding) {
            const newAmount = holding.amount + amount;
            holding.avg_buy_price = ((holding.amount * holding.avg_buy_price) + totalCost) / newAmount;
            holding.amount = newAmount;
        } else {
            dbData.holdings.push({ uid, symbol, amount, avg_buy_price: currentPrice });
        }
    } else if (side.toUpperCase() === 'SELL') {
        let holding = dbData.holdings.find(h => h.uid === uid && h.symbol === symbol);
        if (!holding || holding.amount < amount) {
            return res.status(400).json({ success: false, message: 'Insufficient coin holdings to sell' });
        }
        holding.amount -= amount;
        if (holding.amount <= 0) {
            dbData.holdings = dbData.holdings.filter(h => !(h.uid === uid && h.symbol === symbol));
        }
        wallet.usdt_balance += (totalCost - fee);
    }

    let realApiResponse = null;
    let apiStatusMsg = 'Trade executed with isolated balance';
    try {
        realApiResponse = await executeBitgetApiOrder(symbol, side, type, amount, currentPrice);
        apiStatusMsg = 'Trade executed successfully on Bitget Exchange & Local Ledger';
    } catch (err) {
        // If API credentials are not set or exchange fails, local isolated trade remains successful
    }

    const tradeRecord = {
        id: 'TRD_' + Date.now(),
        uid,
        symbol,
        side: side.toUpperCase(),
        price: currentPrice,
        amount,
        fee,
        pnl: 0,
        timestamp: new Date().toISOString()
    };
    dbData.trades.push(tradeRecord);
    dbData.fees.push({ id: 'FEE_' + Date.now(), uid, amount: fee, timestamp: new Date().toISOString() });

    db.saveData(dbData);
    res.json({ success: true, message: apiStatusMsg, trade: tradeRecord, wallet, realApiResponse });
});

// 4. Deposit & Withdrawal Routes
app.post('/api/deposit/request', (req, res) => {
    const { uid, method, amount, details } = req.body;
    if (!uid || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    const dbData = db.getData();
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

    res.json({ success: true, message: 'Deposit request submitted successfully', deposit });
});

app.post('/api/withdraw/request', (req, res) => {
    const { uid, address, amount } = req.body;
    if (!uid || !address || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid parameters' });

    const dbData = db.getData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet || wallet.usdt_balance < amount) {
        return res.status(400).json({ success: false, message: 'Insufficient balance for withdrawal' });
    }

    wallet.usdt_balance -= parseFloat(amount);
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

    res.json({ success: true, message: 'Withdrawal request submitted successfully', withdrawal });
});

// 5. Admin Panel Data & Actions
app.get('/api/admin/data', (req, res) => {
    const dbData = db.getData();
    const totalFees = dbData.fees.reduce((acc, f) => acc + f.amount, 0);
    res.json({
        success: true,
        users: dbData.users,
        wallets: dbData.wallets,
        holdings: dbData.holdings,
        orders: dbData.orders,
        trades: dbData.trades,
        deposits: dbData.deposits,
        withdrawals: dbData.withdrawals,
        admin_profit: totalFees
    });
});

app.post('/api/admin/action', (req, res) => {
    const { type, id, status } = req.body;
    const dbData = db.getData();

    if (type === 'deposit') {
        let dep = dbData.deposits.find(d => d.id === id);
        if (!dep || dep.status !== 'Pending') return res.status(400).json({ success: false, message: 'Not found' });
        dep.status = status;
        if (status === 'Approved') {
            let wallet = dbData.wallets.find(w => w.uid === dep.uid);
            if (wallet) wallet.usdt_balance += dep.amount;
        }
    } else if (type === 'withdrawal') {
        let wdr = dbData.withdrawals.find(w => w.id === id);
        if (!wdr || wdr.status !== 'Pending') return res.status(400).json({ success: false, message: 'Not found' });
        wdr.status = status;
        if (status === 'Rejected') {
            let wallet = dbData.wallets.find(w => w.uid === wdr.uid);
            if (wallet) wallet.usdt_balance += wdr.amount;
        }
    }

    db.saveData(dbData);
    res.json({ success: true, message: `Request ${status} successfully` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
