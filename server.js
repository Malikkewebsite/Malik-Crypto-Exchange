const express = require('express');
const path = require('path');
const cors = require('cors');
const https = require('https');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://quranrecitation657_db_user:Gz9A5swK2qGWDuNr@cluster0.r3imucc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB Atlas Successfully!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Mongoose Schemas & Models
const WalletSchema = new mongoose.Schema({
    uid: { type: String, unique: true, required: true },
    usdt_balance: { type: Number, default: 0.0 }
});
const Wallet = mongoose.model('Wallet', WalletSchema);

const HoldingSchema = new mongoose.Schema({
    uid: String,
    symbol: String,
    amount: Number,
    avg_price: Number
});
const Holding = mongoose.model('Holding', HoldingSchema);

const TradeSchema = new mongoose.Schema({
    id: String,
    uid: String,
    symbol: String,
    side: String,
    price: Number,
    amount: Number,
    fee: Number,
    timestamp: String
});
const Trade = mongoose.model('Trade', TradeSchema);

const DepositSchema = new mongoose.Schema({
    id: String,
    uid: String,
    method: String,
    amount: Number,
    details: String,
    status: String,
    timestamp: String
});
const Deposit = mongoose.model('Deposit', DepositSchema);

const WithdrawalSchema = new mongoose.Schema({
    id: String,
    uid: String,
    address: String,
    amount: Number,
    status: String,
    timestamp: String
});
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

const ConfigSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: Number
});
const Config = mongoose.model('Config', ConfigSchema);

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

// User Init
app.post('/api/user/init', async (req, res) => {
    try {
        let { uid, initial_balance } = req.body;
        let wallet = await Wallet.findOne({ uid });
        if (!wallet) {
            wallet = new Wallet({ uid, usdt_balance: initial_balance || 0.0 });
            await wallet.save();
        } else if (wallet.usdt_balance === 0 && initial_balance > 0) {
            wallet.usdt_balance = initial_balance;
            await wallet.save();
        }
        res.json({ success: true, uid, wallet });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// User Portfolio
app.get('/api/user/portfolio/:uid', async (req, res) => {
    try {
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

        res.json({ 
            success: true, 
            wallet, 
            holdings, 
            trades, 
            deposits, 
            withdrawals,
            stats: { totalDeposited, totalWithdrawn, netProfitLoss }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Trade Execution with 2% Fee
app.post('/api/trade/execute', async (req, res) => {
    try {
        const { uid, symbol, side, type, price, amount } = req.body;
        if (!uid || !amount || amount <= 0) {
            return res.json({ success: false, message: 'Invalid trade parameters' });
        }

        let wallet = await Wallet.findOne({ uid });
        if (!wallet) return res.json({ success: false, message: 'Wallet not found' });

        const tradeAmountUSDT = parseFloat(amount);
        const fee = tradeAmountUSDT * 0.02; // 2% fee
        const effectiveAmount = tradeAmountUSDT - fee;

        if (side.toUpperCase() === 'BUY') {
            if (wallet.usdt_balance < tradeAmountUSDT) {
                return res.json({ success: false, message: 'Insufficient USDT balance including 2% fee!' });
            }
            wallet.usdt_balance -= tradeAmountUSDT;
            await wallet.save();
            
            let holding = await Holding.findOne({ uid, symbol });
            if (!holding) {
                holding = new Holding({ uid, symbol, amount: effectiveAmount, avg_price: price || 0 });
            } else {
                holding.amount += effectiveAmount;
            }
            await holding.save();
        } else {
            let holding = await Holding.findOne({ uid, symbol });
            if (!holding || holding.amount < tradeAmountUSDT) {
                return res.json({ success: false, message: 'Insufficient coin holding to sell!' });
            }
            holding.amount -= tradeAmountUSDT;
            await holding.save();
            wallet.usdt_balance += effectiveAmount;
            await wallet.save();
        }

        const newTrade = new Trade({
            id: 'TRD_' + Date.now(),
            uid,
            symbol,
            side: side.toUpperCase(),
            price: price || 0,
            amount: effectiveAmount,
            fee: fee,
            timestamp: new Date().toISOString()
        });
        await newTrade.save();

        // Update admin fees config
        let adminConfig = await Config.findOne({ key: 'admin_fees' });
        if (!adminConfig) {
            adminConfig = new Config({ key: 'admin_fees', value: fee });
        } else {
            adminConfig.value += fee;
        }
        await adminConfig.save();

        return res.json({ success: true, message: `Trade executed! 2% fee ($${fee.toFixed(2)}) applied.` });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error during trade' });
    }
});

// Deposit Request
app.post('/api/deposit/request', async (req, res) => {
    try {
        const { uid, method, amount, details } = req.body;
        if (!uid || !amount || amount <= 0) return res.json({ success: false, message: 'Invalid amount' });

        const newDeposit = new Deposit({
            id: 'DEP_' + Date.now(),
            uid,
            method: method || 'USDT TRC20',
            amount: parseFloat(amount),
            details: details || '',
            status: 'Pending',
            timestamp: new Date().toISOString()
        });
        await newDeposit.save();
        res.json({ success: true, message: 'Deposit request submitted successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Withdrawal Request
app.post('/api/withdraw/request', async (req, res) => {
    try {
        const { uid, address, amount } = req.body;
        if (!uid || !amount || !address || amount <= 0) return res.json({ success: false, message: 'Invalid details' });

        let wallet = await Wallet.findOne({ uid });
        if (!wallet || wallet.usdt_balance < parseFloat(amount)) {
            return res.json({ success: false, message: 'Insufficient balance for withdrawal' });
        }

        wallet.usdt_balance -= parseFloat(amount);
        await wallet.save();

        const newWithdrawal = new Withdrawal({
            id: 'WDR_' + Date.now(),
            uid,
            address,
            amount: parseFloat(amount),
            status: 'Pending',
            timestamp: new Date().toISOString()
        });
        await newWithdrawal.save();
        res.json({ success: true, message: 'Withdrawal request submitted successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin Data
app.post('/api/admin/data', async (req, res) => {
    try {
        const { password } = req.body;
        if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35#')) {
            return res.json({ success: false, message: 'Invalid Password' });
        }
        const deposits = await Deposit.find();
        const withdrawals = await Withdrawal.find();
        const trades = await Trade.find();
        const wallets = await Wallet.find();
        
        const adminConfig = await Config.findOne({ key: 'admin_fees' });
        const admin_profit = adminConfig ? adminConfig.value : 0;

        res.json({ 
            success: true, 
            deposits, 
            withdrawals, 
            trades,
            wallets,
            admin_profit 
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin Action
app.post('/api/admin/action', async (req, res) => {
    try {
        const { password, type, id, status } = req.body;
        if (password !== (process.env.ADMIN_PASSWORD || 'Mmooossaa35#')) {
            return res.json({ success: false, message: 'Invalid Password' });
        }

        if (type === 'deposit') {
            const deposit = await Deposit.findOne({ id });
            if (!deposit) return res.json({ success: false, message: 'Not found' });
            deposit.status = status;
            await deposit.save();

            if (status === 'Approved') {
                let wallet = await Wallet.findOne({ uid: deposit.uid });
                if (!wallet) {
                    wallet = new Wallet({ uid: deposit.uid, usdt_balance: 0 });
                }
                wallet.usdt_balance += parseFloat(deposit.amount);
                await wallet.save();
            }
            return res.json({ success: true, message: `Deposit ${status}` });
        }

        if (type === 'withdrawal') {
            const withdrawal = await Withdrawal.findOne({ id });
            if (!withdrawal) return res.json({ success: false, message: 'Not found' });
            withdrawal.status = status;
            await withdrawal.save();

            if (status === 'Rejected') {
                let wallet = await Wallet.findOne({ uid: withdrawal.uid });
                if (wallet) {
                    wallet.usdt_balance += parseFloat(withdrawal.amount);
                    await wallet.save();
                }
            }
            return res.json({ success: true, message: `Withdrawal ${status}` });
        }

        res.json({ success: false, message: 'Invalid type' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
