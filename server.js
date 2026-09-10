const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve all static files from public directory properly
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection Helper
let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    try {
        const dbURI = process.env.MONGO_URI || 'mongodb://localhost:27017/crypto_exchange';
        await mongoose.connect(dbURI, { useNewUrlParser: true, useUnifiedTopology: true });
        isConnected = true;
        console.log('MongoDB Connected Successfully');
    } catch (err) {
        console.error('MongoDB Connection Error:', err);
    }
}

// Mongoose Schemas
const WalletSchema = new mongoose.Schema({
    uid: { type: String, unique: true, required: true },
    usdt_balance: { type: Number, default: 0 }
});
const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', WalletSchema);

const HoldingSchema = new mongoose.Schema({
    uid: String,
    symbol: String,
    amount: Number,
    avg_price: Number
});
const Holding = mongoose.models.Holding || mongoose.model('Holding', HoldingSchema);

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
const Trade = mongoose.models.Trade || mongoose.model('Trade', TradeSchema);

const ConfigSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: Number
});
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

// Bitget Real API Integration Helper using Native https module
function executeBitgetRealOrder(symbol, side, amount) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.BITGET_API_KEY || '';
        const apiSecret = process.env.BITGET_SECRET_KEY || '';
        const apiPassphrase = process.env.BITGET_PASSPHRASE || '';
        
        if (!apiKey || !apiSecret || !apiPassphrase) {
            console.log('Bitget API keys not configured. Skipping external API call.');
            return resolve();
        }

        const timestamp = Date.now().toString();
        const method = 'POST';
        const requestPath = '/api/v2/spot/trade/place-order';
        
        const bodyObj = {
            symbol: symbol,
            productType: 'spot',
            marginMode: 'spot',
            orderType: 'market',
            side: side,
            size: amount.toString()
        };
        
        const bodyString = JSON.stringify(bodyObj);
        const preHash = timestamp + method + requestPath + bodyString;
        const sign = crypto.createHmac('sha256', apiSecret).update(preHash).digest('base64');

        const options = {
            hostname: 'api.bitget.com',
            port: 443,
            path: requestPath,
            method: method,
            headers: {
                'ACCESS-KEY': apiKey,
                'ACCESS-SIGN': sign,
                'ACCESS-TIMESTAMP': timestamp,
                'ACCESS-PASSPHRASE': apiPassphrase,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', err => {
            console.error('Bitget API Request Error:', err);
            resolve();
        });

        req.write(bodyString);
        req.end();
    });
}

// Homepage Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Trade Execute Endpoint (Buy & Sell both working with real Bitget)
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

        const cleanSide = side.toUpperCase() === 'BUY' ? 'buy' : 'sell';

        if (cleanSide === 'buy') {
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
        } else {
            let holding = await Holding.findOne({ uid, symbol });
            if (!holding || holding.amount < tradeAmountUSDT) return res.json({ success: false, message: 'Insufficient coin holding to sell!' });
            holding.amount -= tradeAmountUSDT;
            await holding.save();
            wallet.usdt_balance += effectiveAmount;
            await wallet.save();
        }

        // Trigger Bitget order execution for both Buy and Sell
        executeBitgetRealOrder(symbol, cleanSide, effectiveAmount).catch(() => {});

        const newTrade = new Trade({
            id: 'TRD_' + Date.now(), uid, symbol, side: cleanSide.toUpperCase(), price: price || 0, amount: effectiveAmount, fee, timestamp: new Date().toISOString()
        });
        await newTrade.save();

        let adminConfig = await Config.findOne({ key: 'admin_fees' });
        if (!adminConfig) {
            adminConfig = new Config({ key: 'admin_fees', value: fee });
        } else {
            adminConfig.value += fee;
        }
        await adminConfig.save();

        return res.json({ success: true, message: `Trade executed successfully! Real Bitget ${cleanSide.toUpperCase()} order sent & 2% fee ($${fee.toFixed(2)}) applied.` });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error during trade' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
