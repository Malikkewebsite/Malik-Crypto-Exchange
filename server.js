const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const db = require('./database/db');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to ensure user UID exists
app.use((req, res, next) => {
    next();
});

// 1. Get or Initialize User & Wallet
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
        
        // Initialize Wallet with 1000 USDT demo balance
        dbData.wallets.push({ uid, usdt_balance: 1000.0, locked_balance: 0.0 });
        db.saveData(dbData);
    }
    
    let wallet = dbData.wallets.find(w => w.uid === uid) || { usdt_balance: 1000.0, locked_balance: 0.0 };
    res.json({ success: true, uid, wallet });
});

// 2. Get User Portfolio & Holdings
app.get('/api/user/portfolio/:uid', (req, res) => {
    const { uid } = req.params;
    const dbData = db.getData();
    const wallet = dbData.wallets.find(w => w.uid === uid) || { usdt_balance: 0, locked_balance: 0 };
    const holdings = dbData.holdings.filter(h => h.uid === uid);
    const orders = dbData.orders.filter(o => o.uid === uid);
    const trades = dbData.trades.filter(t => t.uid === uid);
    const deposits = dbData.deposits.filter(d => d.uid === uid);
    const withdrawals = dbData.withdrawals.filter(w => w.uid === uid);

    res.json({ success: true, wallet, holdings, orders, trades, deposits, withdrawals });
});

// 3. Server-Side Paper Trading Engine (BUY / SELL)
app.post('/api/trade/execute', async (req, res) => {
    const { uid, symbol, side, type, price, amount, tp, sl } = req.body;
    if (!uid || !symbol || !side || !amount) {
        return res.status(400).json({ success: false, message: 'Invalid trading parameters' });
    }

    const dbData = db.getData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) return res.status(400).json({ success: false, message: 'Wallet not found' });

    // Fetch live price from Bitget public API to prevent client manipulation
    let currentPrice = price;
    try {
        const response = await axios.get(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${symbol}`);
        if (response.data && response.data.data && response.data.data.length > 0) {
            currentPrice = parseFloat(response.data.data[0].lastPr);
        }
    } catch (e) {
        // fallback to provided price if API fails
    }

    const totalCost = currentPrice * amount;
    const feeRate = 0.001; // 0.1% trading fee
    const fee = totalCost * feeRate;

    if (side.toUpperCase() === 'BUY') {
        if (wallet.usdt_balance < (totalCost + fee)) {
            return res.status(400).json({ success: false, message: 'Insufficient USDT balance' });
        }
        wallet.usdt_balance -= (totalCost + fee);

        // Update Holdings
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
        const proceeds = totalCost - fee;
        wallet.usdt_balance += proceeds;
    }

    // Record Trade & Fee
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
    res.json({ success: true, message: 'Trade executed successfully', trade: tradeRecord, wallet });
});

// 4. Deposit Request Submission
app.post('/api/deposit/request', (req, res) => {
    const { uid, method, amount, details } = req.body;
    if (!uid || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid deposit details' });

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

// 5. Withdrawal Request Submission
app.post('/api/withdraw/request', (req, res) => {
    const { uid, address, amount } = req.body;
    if (!uid || !address || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid withdrawal parameters' });

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

// 6. Admin Panel API: Get All Central Data
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
        admin_profit: totalFees,
        admin_settings: dbData.admin_settings
    });
});

// 7. Admin Action: Approve / Reject Deposit or Withdrawal
app.post('/api/admin/action', (req, res) => {
    const { type, id, status } = req.body; // type: 'deposit' or 'withdrawal', status: 'Approved' or 'Rejected'
    const dbData = db.getData();

    if (type === 'deposit') {
        let dep = dbData.deposits.find(d => d.id === id);
        if (!dep || dep.status !== 'Pending') return res.status(400).json({ success: false, message: 'Deposit not found or processed' });

        dep.status = status;
        if (status === 'Approved') {
            let wallet = dbData.wallets.find(w => w.uid === dep.uid);
            if (wallet) wallet.usdt_balance += dep.amount;
        }
    } else if (type === 'withdrawal') {
        let wdr = dbData.withdrawals.find(w => w.id === id);
        if (!wdr || wdr.status !== 'Pending') return res.status(400).json({ success: false, message: 'Withdrawal not found or processed' });

        wdr.status = status;
        if (status === 'Rejected') {
            // Refund user if rejected
            let wallet = dbData.wallets.find(w => w.uid === wdr.uid);
            if (wallet) wallet.usdt_balance += wdr.amount;
        }
    }

    db.saveData(dbData);
    res.json({ success: true, message: `Request ${status} successfully` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Crypto exchange server running on port ${PORT}`);
});
