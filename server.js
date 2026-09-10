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

const WalletSchema = new mongoose.Schema({ uid: String, usdt_balance: { type: Number, default: 0.0 } });
const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', WalletSchema);

const HoldingSchema = new mongoose.Schema({ uid: String, symbol: String, amount: Number, avg_price: Number });
const Holding = mongoose.models.Holding || mongoose.model('Holding', HoldingSchema);

const TradeSchema = new mongoose.Schema({ 
    id: String, 
    uid: String, 
    symbol: String, 
    side: String, 
    price: Number, 
    amount: Number, 
    fee: Number, 
    status: { type: String, default: 'Running' }, 
    timestamp: String 
});
const Trade = mongoose.models.Trade || mongoose.model('Trade', TradeSchema);

const DepositSchema = new mongoose.Schema({ id: String, uid: String, method: String, amount: Number, details: String, status: String, timestamp: String });
const Deposit = mongoose.models.Deposit || mongoose.model('Deposit', DepositSchema);

const WithdrawalSchema = new mongoose.Schema({ id: String, uid: String, address: String, amount: Number, status: String, timestamp: String });
const Withdrawal = mongoose.models.Withdrawal || mongoose.model('Withdrawal', WithdrawalSchema);

const ConfigSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: Number });
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

const MaintenanceSchema = new mongoose.Schema({ key: { type: String, unique: true }, enabled: Boolean });
const Maintenance = mongoose.models.Maintenance || mongoose.model('Maintenance', MaintenanceSchema);

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

const BITGET_API_KEY = process.env.BITGET_API_KEY || 'bg_c548d9fda732eceb14ee1b8607d63f8';
const BITGET_SECRET_KEY = process.env.BITGET_SECRET_KEY || '78a0c22d32bce51efe378cfcc608a5f1007f007fe9d833758e93586464b5c600d855';
const BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE || 'Mmooossaa35';

function executeBitgetRealOrder(symbol, side, size) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now().toString();
        const method = 'POST';
        const requestPath = '/api/v2/spot/trade/place-order';
        const cleanSymbol = symbol.toUpperCase().replace(/[\/_\\-]/g, '');
        const orderSide = side.toLowerCase() === 'sell' ? 'sell' : 'buy';

        const bodyObj = {
            symbol: cleanSymbol,
            productType: 'spot',
            side: orderSide,
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
                try { 
                    const parsed = JSON.parse(data);
                    if (parsed.code && parsed.code !== '00000') {
                        reject(new Error(parsed.msg || 'Bitget Exchange Error'));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) { reject(e); }
            });
        });

        req.on('error', err => reject(err));
        req.write(bodyString);
        req.end();
    });
}

function fetchBitgetTickers() {
    return new Promise((resolve) => {
        const options = { hostname: 'api.bitget.com', port: 443, path: '/api/v2/spot/market/tickers', method: 'GET' };
        const externalReq = https.request(options, (apiRes) => {
            let data = '';
            apiRes.on('data', chunk => data += chunk);
            apiRes.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const map = {};
                    if(parsed && parsed.data) {
                        parsed.data.forEach(t => {
                            if(t.symbol) {
                                const cleanSym = t.symbol.toUpperCase().replace(/[\/_\\-]/g, '');
                                map[cleanSym] = parseFloat(t.close || t.lastPr || 0);
                            }
                        });
                    }
                    resolve(map);
                } catch (e) { resolve({}); }
            });
        });
        externalReq.on('error', () => { resolve({}); });
        externalReq.end();
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
        const rawHoldings = await Holding.find({ uid });
        const trades = await Trade.find({ uid }).sort({ _id: -1 });

        const tickers = await fetchBitgetTickers();
        const USD_TO_PKR = 280;

        const holdings = rawHoldings.map(h => {
            const sym = h.symbol ? h.symbol.toUpperCase().replace(/[\/_\\-]/g, '') : '';
            const liveMarketPrice = tickers[sym] || 0;
            const avgPrice = h.avg_price || 0;
            const currentPrice = liveMarketPrice > 0 ? liveMarketPrice : avgPrice;
            const amount = h.amount || 0;
            
            const pnlUsdt = (currentPrice - avgPrice) * amount;
            const pnlPkr = pnlUsdt * USD_TO_PKR;

            return {
                symbol: h.symbol,
                amount: amount,
                avgPrice: avgPrice,
                currentPrice: currentPrice,
                pnlUsdt: pnlUsdt,
                pnlPkr: pnlPkr
            };
        });

        res.json({ success: true, wallet, holdings, trades });
    } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/trade/execute', async (req, res) => {
    try {
        await connectDB();
        const { uid, symbol, side, price, amount } = req.body;
        const tradeAmountUSDT = parseFloat(amount);
        
        if (!uid || !tradeAmountUSDT || tradeAmountUSDT <= 0) {
            return res.json({ success: false, message: 'Invalid amount entered!' });
        }

        let wallet = await Wallet.findOne({ uid });
        if (!wallet) return res.json({ success: false, message: 'Wallet not found' });

        const cleanSymbol = symbol ? symbol.toUpperCase().replace(/[\/_\\-]/g, '') : '';
        let currentPrice = parseFloat(price) || 0;

        if (currentPrice <= 0) {
            const tickers = await fetchBitgetTickers();
            currentPrice = tickers[cleanSymbol] || 0;
        }

        if (currentPrice <= 0) {
            return res.json({ success: false, message: 'Invalid market price for this coin! Please select a valid coin.' });
        }

        const tradeSide = side.toUpperCase();

        if (tradeSide === 'BUY') {
            if (wallet.usdt_balance < tradeAmountUSDT) {
                return res.json({ success: false, message: 'Insufficient USDT balance to buy!' });
            }

            const fee = tradeAmountUSDT * 0.02;
            const effectiveAmountUSDT = tradeAmountUSDT - fee;
            const coinQuantityToAdd = effectiveAmountUSDT / currentPrice;

            wallet.usdt_balance -= tradeAmountUSDT;
            await wallet.save();
            
            let holding = await Holding.findOne({ uid, symbol: cleanSymbol });
            if (!holding) {
                holding = new Holding({ uid, symbol: cleanSymbol, amount: coinQuantityToAdd, avg_price: currentPrice });
            } else {
                const totalCost = (holding.amount * (holding.avg_price || currentPrice)) + effectiveAmountUSDT;
                holding.amount += coinQuantityToAdd;
                holding.avg_price = holding.amount > 0 ? totalCost / holding.amount : currentPrice;
            }
            await holding.save();

            // Real Exchange Order execution with safe size formatting
            try {
                // If coin price is high or whole numbers needed, handle safely. Using 4 decimals max for real orders.
                const formattedBuySize = parseFloat(effectiveAmountUSDT.toFixed(4));
                await executeBitgetRealOrder(cleanSymbol, tradeSide, formattedBuySize);
            } catch (exchangeErr) {
                // Rollback on failure
                wallet.usdt_balance += tradeAmountUSDT;
                holding.amount -= coinQuantityToAdd;
                if (holding.amount <= 0) await Holding.deleteOne({ _id: holding._id });
                else await holding.save();
                await wallet.save();
                return res.json({ success: false, message: `Exchange Error: ${exchangeErr.message}` });
            }

            const newTrade = new Trade({
                id: 'TRD_' + Date.now(), 
                uid, 
                symbol: cleanSymbol, 
                side: tradeSide, 
                price: currentPrice, 
                amount: effectiveAmountUSDT, 
                fee, 
                status: 'Running',
                timestamp: new Date().toISOString()
            });
            await newTrade.save();

            let adminConfig = await Config.findOne({ key: 'admin_fees' });
            if (!adminConfig) {
                adminConfig = new Config({ key: 'admin_fees', value: fee });
            } else {
                adminConfig.value += fee;
            }
            await adminConfig.save();

            return res.json({ success: true, message: `Real buy order executed successfully! 2% fee ($${fee.toFixed(2)}) applied.` });

        } else {
            // Sell logic
            let holding = await Holding.findOne({ uid, symbol: cleanSymbol });
            if (!holding || holding.amount <= 0) {
                return res.json({ success: false, message: 'No holdings found for this coin to sell!' });
            }

            const totalHoldingValueUSDT = holding.amount * currentPrice;
            if (tradeAmountUSDT > totalHoldingValueUSDT + 0.05) {
                return res.json({ success: false, message: 'You are trying to sell more than your total holding value!' });
            }

            const coinQuantityToSell = Math.min(holding.amount, tradeAmountUSDT / currentPrice);
            
            const grossReturnUSDT = coinQuantityToSell * currentPrice;
            const fee = grossReturnUSDT * 0.02;
            const netReturnUSDT = grossReturnUSDT - fee;

            holding.amount -= coinQuantityToSell;
            if (holding.amount < 0.00000001) {
                holding.amount = 0;
                await Holding.deleteOne({ _id: holding._id });
            } else {
                await holding.save();
            }

            wallet.usdt_balance += netReturnUSDT;
            await wallet.save();

            // Real Exchange Order execution with automatic integer/decimal handling to prevent scale errors
            try {
                // Automatically fallback to rounded integer if exchange throws scale error or for safety on restricted coins
                let formattedSize;
                if (coinQuantityToSell < 10 && coinQuantityToSell % 1 !== 0) {
                    formattedSize = parseFloat(coinQuantityToSell.toFixed(2));
                } else {
                    formattedSize = Math.round(coinQuantityToSell);
                    if (formattedSize <= 0) formattedSize = parseFloat(coinQuantityToSell.toFixed(4));
                }

                await executeBitgetRealOrder(cleanSymbol, tradeSide, formattedSize);
            } catch (exchangeErr) {
                // If real exchange fails, rollback balances
                wallet.usdt_balance -= netReturnUSDT;
                holding.amount += coinQuantityToSell;
                await wallet.save();
                await holding.save();
                return res.json({ success: false, message: `Exchange Error: ${exchangeErr.message}` });
            }

            const newTrade = new Trade({
                id: 'TRD_' + Date.now(), 
                uid, 
                symbol: cleanSymbol, 
                side: tradeSide, 
                price: currentPrice, 
                amount: grossReturnUSDT, 
                fee, 
                status: 'Closed',
                timestamp: new Date().toISOString()
            });
            await newTrade.save();

            let adminConfig = await Config.findOne({ key: 'admin_fees' });
            if (!adminConfig) {
                adminConfig = new Config({ key: 'admin_fees', value: fee });
            } else {
                adminConfig.value += fee;
            }
            await adminConfig.save();

            return res.json({ success: true, message: `Real sell order executed successfully! 2% fee ($${fee.toFixed(2)}) applied.` });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error during trade execution' });
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

app.listen(3000, () => {
    console.log('Server running on port 3000');
});

module.exports = app;
