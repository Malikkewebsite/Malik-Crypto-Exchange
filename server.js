const express = require('express');
const path = require('path');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://quranrecitation657_db_user:Gz9A5swK2qGWDuNr@cluster0.r3imucc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

async function connectDB() {
    if (mongoose.connection.readyState >= 1) return;
    try {
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        console.log('Connected to MongoDB Atlas Successfully!');
    } catch (err) {
        console.error('MongoDB Connection Error:', err);
    }
}

// Schemas & Models
const WalletSchema = new mongoose.Schema({ uid: String, usdt_balance: { type: Number, default: 0.0 } });
const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', WalletSchema);

const HoldingSchema = new mongoose.Schema({ uid: String, symbol: String, amount: Number, avg_price: Number });
const Holding = mongoose.models.Holding || mongoose.model('Holding', HoldingSchema);

const TradeSchema = new mongoose.Schema({ id: String, uid: String, symbol: String, side: String, price: Number, amount: Number, fee: Number, timestamp: String });
const Trade = mongoose.models.Trade || mongoose.model('Trade', TradeSchema);

const DepositSchema = new mongoose.Schema({ id: String, uid: String, method: String, amount: Number, details: String, status: String, timestamp: String });
const Deposit = mongoose.models.Deposit || mongoose.model('Deposit', DepositSchema);

const WithdrawalSchema = new mongoose.Schema({ id: String, uid: String, address: String, amount: Number, status: String, timestamp: String });
const Withdrawal = mongoose.models.Withdrawal || mongoose.model('Withdrawal', WithdrawalSchema);

const ConfigSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: Number });
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

const MaintenanceSchema = new mongoose.Schema({ key: { type: String, unique: true }, enabled: Boolean });
const Maintenance = mongoose.models.Maintenance || mongoose.model('Maintenance', MaintenanceSchema);

// Maintenance Mode Middleware Check
app.use(async (req, res, next) => {
    try {
        await connectDB();
        const m = await Maintenance.findOne({ key: 'maintenance' });
        if (m && m.enabled && !req.path.startsWith('/api/admin')) {
            return res.status(503).json({ success: false, message: 'System is under maintenance. Please try later.' });
        }
    } catch(e) {}
    next();
});

// Bitget API Credentials
const BITGET_API_KEY = process.env.BITGET_API_KEY || 'bg_c548d9fda732eceb14ee1b8607d63f8';
const BITGET_SECRET_KEY = process.env.BITGET_SECRET_KEY || '78a0c22d32bce51efe378cfcc608a5f1007f007fe9d833758e93586464b5c600d855';
const BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE || 'Mmooossaa35';

function executeBitgetRealOrder(symbol, side, size) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now().toString();
        const method = 'POST';
        const requestPath = '/api/v2/spot/trade/place-order';
        
        const bodyObj = {
            symbol: symbol.toUpperCase(),
            productType: 'spot',
            side: side.toLowerCase() === 'buy' ? 'buy' : 'sell',
            orderType: 'market',
            size: size.toString()
        };
        const bodyString = JSON.stringify(bodyObj);

        const preHash = timestamp + method + requestPath + bodyString;
        const signature = crypto.createHmac('sha256', BITGET_SECRET_KEY).update(preHash).digest('base64');

        const options = {
            hostname: 'api.bitget.com',
            port: 443,
            path: requestPath,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'ACCESS-KEY': BITGET_API_KEY,
                'ACCESS-SIGN': signature,
                'ACCESS-PASSPHRASE': BITGET_PASSPHRASE,
                'ACCESS-TIMESTAMP': timestamp
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        });

        req.on('error', err => reject(err));
        req.write(bodyString);
        req.end();
    });
}

app.get('/api/bitget/markets', async (req, res) => {
    const options = { hostname: 'api.bitget.com', port: 443, path: '/api/v2/spot/market/tickers', method: 'GET' };
    const externalReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
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

app.post('/api/user/init', async (req, res) => {
    try {
        await connectDB();
        let { uid, initial_balance } = req.body;
        if (!uid || uid === 'null' || uid === 'undefined') uid = 'USER_' + Math.floor(100000 + Math.random() * 900000);
        let wallet = await Wallet.findOne({ uid });
        if (!wallet) {
            wallet = new Wallet({ uid, usdt_balance: initial_balance || 0.0 });
            await wallet.save();
        }
        res.json({ success: true, uid, wallet });
    } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/user/sync', async (req, res) => {
    try {
        await connectDB();
        const { uid, balance } = req.body;
        if (!uid) return res.json({ success: false });
        let wallet = await Wallet.findOne({ uid });
        if (!wallet) {
            wallet = new Wallet({ uid, usdt_balance: balance || 0 });
        } else if (wallet.usdt_balance === 0 && balance > 0) {
            wallet.usdt_balance = balance;
        }
        await wallet.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/user/portfolio/:uid', async (req, res) => {
    try {
        await connectDB();
        const { uid } = req.params;
        let wallet = await Wallet.findOne({ uid });
        if (!wallet) {
            wallet = new Wallet({ uid, usdt_balance: 0.0 });
            await wallet.save();
        }
        const holdings = await Holding.find({ uid });
        const trades = await Trade.find({ uid });
        const deposits = await Deposit.find({ uid });
        const withdrawals = await Withdrawal.find({ uid });

        const totalDeposited = deposits.filter(d => d.status === 'Approved').reduce((acc, d) => acc + d.amount, 0);
        const totalWithdrawn = withdrawals.filter(w => w.status === 'Approved').reduce((acc, w) => acc + w.amount, 0);
        const netProfitLoss = (wallet.usdt_balance + totalWithdrawn) - totalDeposited;

        res.json({ success: true, wallet, holdings, trades, deposits, withdrawals, stats: { totalDeposited, totalWithdrawn, netProfitLoss } });
    } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/trade/execute', async (req, res) => {
    try {
        await connectDB();
        const { uid, symbol, side, price, amount } = req.body;
        if (!uid || !amount || amount <= 0) return res.json({ success: false, message: 'Invalid parameters' });

        let wallet = await Wallet.findOne({ uid });
        if (!wallet) return res.json({ success: false, message: 'Wallet not found' });

        const tradeAmountUSDT = parseFloat(amount);
        const fee = tradeAmountUSDT * 0.02;
        const effectiveAmount = tradeAmountUSDT - fee;

        let bitgetSize = 0;

        if (side.toUpperCase() === 'BUY') {
            if (wallet.usdt_balance < tradeAmountUSDT) return res.json({ success: false, message: 'Insufficient USDT balance!' });
            wallet.usdt_balance -= tradeAmountUSDT;
            await wallet.save();
            
            let holding = await Holding.findOne({ uid, symbol });
            if (!holding) {
                holding = new Holding({ uid, symbol, amount: effectiveAmount, avg_price: price || 0 });
            } else {
                holding.amount += effectiveAmount;
            }
            await holding.save();
            bitgetSize = effectiveAmount; // For Buy, Bitget takes USDT amount/value size
        } else {
            let holding = await Holding.findOne({ uid, symbol });
            if (!holding || holding.amount < tradeAmountUSDT) return res.json({ success: false, message: 'Insufficient coin holding to sell!' });
            holding.amount -= tradeAmountUSDT;
            await holding.save();
            wallet.usdt_balance += effectiveAmount;
            await wallet.save();
            bitgetSize = tradeAmountUSDT; // For Sell, Bitget takes exact coin quantity size
        }

        executeBitgetRealOrder(symbol, side, bitgetSize).catch(() => {});

        const newTrade = new Trade({
            id: 'TRD_' + Date.now(), uid, symbol, side: side.toUpperCase(), price: price || 0, amount: effectiveAmount, fee, timestamp: new Date().toISOString()
        });
        await newTrade.save();

        let adminConfig = await Config.findOne({ key: 'admin_fees' });
        if (!adminConfig) {
            adminConfig = new Config({ key: 'admin_fees', value: fee });
        } else {
            adminConfig.value += fee;
        }
        await adminConfig.save();

        return res.json({ success: true, message: `Trade executed successfully! Real Bitget order sent & 2% fee ($${fee.toFixed(2)}) applied.` });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error during trade' });
    }
});

app.post('/api/deposit/request', async (req, res) => {
    try {
        await connectDB();
        const { uid, method, amount, details } = req.body;
        const newDeposit = new Deposit({ id: 'DEP_' + Date.now(), uid, method: method || 'USDT TRC20', amount: parseFloat(amount), details: details || '', status: 'Pending', timestamp: new Date().toISOString() });
        await newDeposit.save();
        res.json({ success: true, message: 'Deposit request submitted successfully!' });
    } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/withdraw/request', async (req, res) => {
    try {
        await connectDB();
        const { uid, address, amount } = req.body;
        let wallet = await Wallet.findOne({ uid });
        if (!wallet || wallet.usdt_balance < parseFloat(amount)) return res.json({ success: false, message: 'Insufficient balance' });
        wallet.usdt_balance -= parseFloat(amount);
        await wallet.save();
        const newWithdrawal = new Withdrawal({ id: 'WDR_' + Date.now(), uid, address, amount: parseFloat(amount), status: 'Pending', timestamp: new Date().toISOString() });
        await newWithdrawal.save();
        res.json({ success: true, message: 'Withdrawal request submitted successfully!' });
    } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// Community Leaderboard Route
app.get('/api/community/leaderboard', async (req, res) => {
    try {
        await connectDB();
        const wallets = await Wallet.find().sort({ usdt_balance: -1 }).limit(10);
        const leaderboard = wallets.map((w, index) => ({
            rank: index + 1,
            uid: w.uid.substring(0, 6) + '***',
            balance: w.usdt_balance
        }));
        res.json({ success: true, leaderboard });
    } catch (e) {
        res.status(500).json({ success: false, leaderboard: [] });
    }
});

// Admin Panel Data Route
app.post('/api/admin/data', async (req, res) => {
    try {
        await connectDB();
        const { password } = req.body;
        if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35')) return res.json({ success: false, message: 'Invalid Password' });
        const deposits = await Deposit.find();
        const withdrawals = await Withdrawal.find();
        const trades = await Trade.find();
        const wallets = await Wallet.find();
        const adminConfig = await Config.findOne({ key: 'admin_fees' });
        const maintenanceConfig = await Maintenance.findOne({ key: 'maintenance' });
        res.json({ success: true, deposits, withdrawals, trades, wallets, admin_profit: adminConfig ? adminConfig.value : 0, maintenance: maintenanceConfig ? maintenanceConfig.enabled : false });
    } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// Admin System Management Route (Maintenance & User Management)
app.post('/api/admin/system-action', async (req, res) => {
    try {
        await connectDB();
        const { password, action, targetUid, newBalance } = req.body;
        if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35')) {
            return res.json({ success: false, message: 'Invalid Password' });
        }

        if (action === 'toggle_maintenance') {
            let m = await Maintenance.findOne({ key: 'maintenance' });
            const newState = m ? !m.enabled : true;
            await Maintenance.findOneAndUpdate({ key: 'maintenance' }, { enabled: newState }, { upsert: true });
            return res.json({ success: true, message: `Maintenance mode ${newState ? 'Enabled' : 'Disabled'}` });
        }

        if (action === 'adjust_balance') {
            let wallet = await Wallet.findOne({ uid: targetUid });
            if (!wallet) return res.json({ success: false, message: 'User not found' });
            wallet.usdt_balance = parseFloat(newBalance);
            await wallet.save();
            return res.json({ success: true, message: 'User balance updated successfully!' });
        }

        res.json({ success: false, message: 'Invalid action' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin Unified Action Route
app.post('/api/admin/action', async (req, res) => {
    try {
        await connectDB();
        const { password, type, id, status } = req.body;
        
        if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35')) {
            return res.json({ success: false, message: 'Invalid Password' });
        }

        if (type === 'deposit') {
            const deposit = await Deposit.findOne({ id });
            if (!deposit) return res.json({ success: false, message: 'Deposit request not found' });
            if (deposit.status !== 'Pending') return res.json({ success: false, message: 'Request already processed' });

            deposit.status = status;
            await deposit.save();

            if (status === 'Approved') {
                let wallet = await Wallet.findOne({ uid: deposit.uid });
                if (!wallet) {
                    wallet = new Wallet({ uid: deposit.uid, usdt_balance: 0 });
                }
                wallet.usdt_balance += deposit.amount;
                await wallet.save();
            }
        } else if (type === 'withdrawal') {
            const withdrawal = await Withdrawal.findOne({ id });
            if (!withdrawal) return res.json({ success: false, message: 'Withdrawal request not found' });
            if (withdrawal.status !== 'Pending') return res.json({ success: false, message: 'Request already processed' });

            withdrawal.status = status;
            await withdrawal.save();

            if (status === 'Rejected') {
                let wallet = await Wallet.findOne({ uid: withdrawal.uid });
                if (wallet) {
                    wallet.usdt_balance += withdrawal.amount;
                    await wallet.save();
                }
            }
        }

        res.json({ success: true, message: `Request ${status} successfully!` });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
