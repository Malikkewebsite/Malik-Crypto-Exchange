const express = require('express');
const path = require('path');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Global In-Memory Database for Vercel stability
global.dbStore = global.dbStore || {
    wallets: [],
    holdings: [],
    trades: [],
    deposits: [],
    withdrawals: [],
    admin_fees: 0
};

function getDbData() {
    return global.dbStore;
}

function saveDbData(data) {
    global.dbStore = data;
}

const BITGET_BASE_URL = 'api.bitget.com';

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

// User Init with Backup Sync support
app.post('/api/user/init', (req, res) => {
    let { uid, initial_balance } = req.body;
    const dbData = getDbData();

    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) {
        wallet = { uid, usdt_balance: initial_balance || 0.0 };
        dbData.wallets.push(wallet);
        saveDbData(dbData);
    } else if (wallet.usdt_balance === 0 && initial_balance > 0) {
        wallet.usdt_balance = initial_balance;
        saveDbData(dbData);
    }

    res.json({ success: true, uid, wallet });
});

// User Sync Endpoint for LocalStorage Backup
app.post('/api/user/sync', (req, res) => {
    let { uid, balance } = req.body;
    const dbData = getDbData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (wallet) {
        wallet.usdt_balance = balance;
        saveDbData(dbData);
    } else {
        dbData.wallets.push({ uid, usdt_balance: balance });
        saveDbData(dbData);
    }
    res.json({ success: true });
});

// User Portfolio
app.get('/api/user/portfolio/:uid', (req, res) => {
    const { uid } = req.params;
    const dbData = getDbData();
    
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet) {
        wallet = { uid, usdt_balance: 0.0 };
        dbData.wallets.push(wallet);
        saveDbData(dbData);
    }

    const holdings = dbData.holdings.filter(h => h.uid === uid);
    const trades = dbData.trades.filter(t => t.uid === uid);
    const deposits = dbData.deposits.filter(d => d.uid === uid);
    const withdrawals = dbData.withdrawals.filter(w => w.uid === uid);

    const totalDeposited = deposits.filter(d => d.status === 'Approved').reduce((acc, d) => acc + d.amount, 0);
    const totalWithdrawn = withdrawals.filter(w => w.status === 'Approved').reduce((acc, w) => acc + w.amount, 0);
    const netProfitLoss = (wallet.usdt_balance + totalWithdrawn) - totalDeposited;

    res.json({ 
        success: true, 
        wallet, 
        holdings, 
        trades, 
        deposits, 
        withdrawals,
        stats: { totalDeposited, totalWithdrawn, netProfitLoss }
    });
});

// Trade Execution with 2% Fee
app.post('/api/trade/execute', async (req, res) => {
    try {
        const { uid, symbol, side, type, price, amount } = req.body;
        if (!uid || !amount || amount <= 0) {
            return res.json({ success: false, message: 'Invalid trade parameters' });
        }

        const dbData = getDbData();
        let wallet = dbData.wallets.find(w => w.uid === uid);
        if (!wallet) return res.json({ success: false, message: 'Wallet not found' });

        const tradeAmountUSDT = parseFloat(amount);
        const fee = tradeAmountUSDT * 0.02; // 2% fee
        const effectiveAmount = tradeAmountUSDT - fee;

        if (side.toUpperCase() === 'BUY') {
            if (wallet.usdt_balance < tradeAmountUSDT) {
                return res.json({ success: false, message: 'Insufficient USDT balance including 2% fee!' });
            }
            wallet.usdt_balance -= tradeAmountUSDT;
            
            let holding = dbData.holdings.find(h => h.uid === uid && h.symbol === symbol);
            if (!holding) {
                holding = { uid, symbol, amount: effectiveAmount, avg_price: price || 0 };
                dbData.holdings.push(holding);
            } else {
                holding.amount += effectiveAmount;
            }
        } else {
            let holding = dbData.holdings.find(h => h.uid === uid && h.symbol === symbol);
            if (!holding || holding.amount < tradeAmountUSDT) {
                return res.json({ success: false, message: 'Insufficient coin holding to sell!' });
            }
            holding.amount -= tradeAmountUSDT;
            wallet.usdt_balance += effectiveAmount;
        }

        dbData.trades.push({
            id: 'TRD_' + Date.now(),
            uid,
            symbol,
            side: side.toUpperCase(),
            price: price || 0,
            amount: effectiveAmount,
            fee: fee,
            timestamp: new Date().toISOString()
        });

        dbData.admin_fees += fee;
        saveDbData(dbData);

        return res.json({ success: true, message: `Trade executed! 2% fee ($${fee.toFixed(2)}) applied.` });
    } catch (e) {
        res.json({ success: false, message: 'Server error during trade' });
    }
});

// Deposit Request
app.post('/api/deposit/request', (req, res) => {
    const { uid, method, amount, details } = req.body;
    if (!uid || !amount || amount <= 0) return res.json({ success: false, message: 'Invalid amount' });

    const dbData = getDbData();
    dbData.deposits.push({
        id: 'DEP_' + Date.now(),
        uid,
        method: method || 'USDT TRC20',
        amount: parseFloat(amount),
        details: details || '',
        status: 'Pending',
        timestamp: new Date().toISOString()
    });
    saveDbData(dbData);
    res.json({ success: true, message: 'Deposit request submitted successfully!' });
});

// Withdrawal Request
app.post('/api/withdraw/request', (req, res) => {
    const { uid, address, amount } = req.body;
    if (!uid || !amount || !address || amount <= 0) return res.json({ success: false, message: 'Invalid details' });

    const dbData = getDbData();
    let wallet = dbData.wallets.find(w => w.uid === uid);
    if (!wallet || wallet.usdt_balance < parseFloat(amount)) {
        return res.json({ success: false, message: 'Insufficient balance for withdrawal' });
    }

    wallet.usdt_balance -= parseFloat(amount);
    dbData.withdrawals.push({
        id: 'WDR_' + Date.now(),
        uid,
        address,
        amount: parseFloat(amount),
        status: 'Pending',
        timestamp: new Date().toISOString()
    });
    saveDbData(dbData);
    res.json({ success: true, message: 'Withdrawal request submitted successfully!' });
});

// Admin Data
app.post('/api/admin/data', (req, res) => {
    const { password } = req.body;
    if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35#')) {
        return res.json({ success: false, message: 'Invalid Password' });
    }
    const dbData = getDbData();
    res.json({ 
        success: true, 
        deposits: dbData.deposits, 
        withdrawals: dbData.withdrawals, 
        trades: dbData.trades,
        wallets: dbData.wallets,
        admin_profit: dbData.admin_fees 
    });
});

// Admin Action
app.post('/api/admin/action', (req, res) => {
    const { password, type, id, status } = req.body;
    if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35#')) {
        return res.json({ success: false, message: 'Invalid Password' });
    }

    const dbData = getDbData();
    if (type === 'deposit') {
        const deposit = dbData.deposits.find(d => d.id === id);
        if (!deposit) return res.json({ success: false, message: 'Not found' });
        deposit.status = status;
        if (status === 'Approved') {
            let wallet = dbData.wallets.find(w => w.uid === deposit.uid);
            if (!wallet) {
                wallet = { uid: deposit.uid, usdt_balance: 0 };
                dbData.wallets.push(wallet);
            }
            wallet.usdt_balance += parseFloat(deposit.amount);
        }
        saveDbData(dbData);
        return res.json({ success: true, message: `Deposit ${status}` });
    }

    if (type === 'withdrawal') {
        const withdrawal = dbData.withdrawals.find(w => w.id === id);
        if (!withdrawal) return res.json({ success: false, message: 'Not found' });
        withdrawal.status = status;
        if (status === 'Rejected') {
            let wallet = dbData.wallets.find(w => w.uid === withdrawal.uid);
            if (wallet) wallet.usdt_balance += parseFloat(withdrawal.amount);
        }
        saveDbData(dbData);
        return res.json({ success: true, message: `Withdrawal ${status}` });
    }

    res.json({ success: false, message: 'Invalid type' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
