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

const API_URL = 'https://api.bitget.com';

// Fetch all live Bitget Spot Markets & Coins so any coin can be selected
app.get('/api/bitget/markets', async (req, res) => {
    try {
        const response = await axios.get(`${API_URL}/api/v2/spot/market/tickers`);
        if (response.data && response.data.data) {
            res.json({ success: true, markets: response.data.data });
        } else {
            res.json({ success: false, markets: [] });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch Bitget markets' });
    }
});

// User Init & Wallet Sync
app.post('/api/user/init', (req, res) => {
    let { uid } = req.body;
    if (!uid) {
        uid = 'UID_' + Math.random().toString(36).substring(2, 10).toUpperCase();
    }
    const dbData = db.getData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    
    if (!wallet) {
        wallet = { uid, usdt_balance: 1000.0, locked_balance: 0.0 }; // Initial test bonus or 0
        dbData.wallets.push(wallet);
        db.saveData(dbData);
    }

    res.json({ success: true, uid, wallet });
});

app.get('/api/user/portfolio/:uid', (req, res) => {
    const { uid } = req.params;
    const dbData = db.getData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) {
        wallet = { uid, usdt_balance: 0.0, locked_balance: 0.0 };
        dbData.wallets.push(wallet);
        db.saveData(dbData);
    }

    const holdings = dbData.holdings.filter(h => h.uid === uid);
    const trades = dbData.trades.filter(t => t.uid === uid);
    const deposits = dbData.deposits.filter(d => d.uid === uid);
    const withdrawals = dbData.withdrawals.filter(w => w.uid === uid);

    res.json({ success: true, wallet, holdings, trades, deposits, withdrawals });
});

// Trade Execution with any selected coin & strict balance check
app.post('/api/trade/execute', async (req, res) => {
    const { uid, symbol, side, type, price, amount } = req.body;
    if (!uid || !symbol || !side || !amount) {
        return res.status(400).json({ success: false, message: 'Invalid trading parameters' });
    }

    const dbData = db.getData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) {
        wallet = { uid, usdt_balance: 0.0, locked_balance: 0.0 };
        dbData.wallets.push(wallet);
    }

    let currentPrice = price || 1;
    try {
        const response = await axios.get(`${API_URL}/api/v2/spot/market/tickers?symbol=${symbol}`);
        if (response.data && response.data.data && response.data.data.length > 0) {
            currentPrice = parseFloat(response.data.data[0].lastPr);
        }
    } catch (e) {}

    const totalCost = currentPrice * amount;
    const fee = totalCost * 0.001; // 0.1% fee
    const totalRequired = totalCost + fee;

    if (side.toUpperCase() === 'BUY') {
        if (wallet.usdt_balance < totalRequired) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient USDT balance. Required: $${totalRequired.toFixed(2)}, Available: $${wallet.usdt_balance.toFixed(2)}` 
            });
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
    res.json({ success: true, message: 'Trade executed successfully with isolated balance', trade: tradeRecord, wallet });
});

// Instant Deposit Route (Auto-credits balance so user doesn't get stuck)
app.post('/api/deposit/request', (req, res) => {
    const { uid, method, amount, details } = req.body;
    if (!uid || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    const dbData = db.getData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) {
        wallet = { uid, usdt_balance: 0.0, locked_balance: 0.0 };
        dbData.wallets.push(wallet);
    }
    
    // Automatically approve deposit for testing/smooth trading flow
    wallet.usdt_balance += parseFloat(amount);

    const deposit = {
        id: 'DEP_' + Date.now(),
        uid,
        method: method || 'USDT TRC20',
        amount: parseFloat(amount),
        details: details || '',
        status: 'Approved',
        timestamp: new Date().toISOString()
    };
    dbData.deposits.push(deposit);
    db.saveData(dbData);

    res.json({ success: true, message: 'Deposit successful and added to balance!', wallet });
});

app.post('/api/admin/data', (req, res) => {
    const { password } = req.body;
    if (password !== 'Mmooossaa35#') {
        return res.status(401).json({ success: false, message: 'Invalid Admin Password' });
    }
    const dbData = db.getData();
    res.json({ success: true, ...dbData, admin_profit: 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
