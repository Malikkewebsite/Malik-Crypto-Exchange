const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const { getLiveMarketPrice, placeBitgetSpotOrder } = require('../services/bitgetService');

// 1. Get Live Market Price for a Symbol
router.get('/market/price/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const price = await getLiveMarketPrice(symbol);
        if (!price) {
            return res.status(404).json({ success: false, message: 'Price not found' });
        }
        res.json({ success: true, symbol, price });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Place Order (Market / Limit)
router.post('/order/place', async (req, res) => {
    const uid = req.headers['x-user-uid'];
    const { symbol, side, type, price, amount, tp, sl } = req.body; // side: BUY/SELL, type: MARKET/LIMIT

    if (!uid || !symbol || !side || !type || !amount) {
        return res.status(400).json({ success: false, message: 'Missing required order parameters' });
    }

    try {
        let currentPrice = price;
        if (type.toUpperCase() === 'MARKET') {
            currentPrice = await getLiveMarketPrice(symbol);
            if (!currentPrice) return res.status(400).json({ success: false, message: 'Failed to fetch live market price' });
        }

        const totalCost = currentPrice * amount;
        let user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid);

        if (side.toUpperCase() === 'BUY') {
            if (user.balance < totalCost) {
                return res.status(400).json({ success: false, message: 'Insufficient USDT balance' });
            }
            // Deduct balance
            db.prepare('UPDATE users SET balance = balance - ? WHERE uid = ?').run(totalCost, uid);
            
            // Update holdings
            let holding = db.prepare('SELECT * FROM holdings WHERE uid = ? AND symbol = ?').get(uid, symbol);
            if (holding) {
                let newAmount = holding.amount + parseFloat(amount);
                let newAvg = ((holding.amount * holding.avg_buy_price) + totalCost) / newAmount;
                db.prepare('UPDATE holdings SET amount = ?, avg_buy_price = ? WHERE uid = ? AND symbol = ?').run(newAmount, newAvg, uid, symbol);
            } else {
                db.prepare('INSERT INTO holdings (uid, symbol, amount, avg_buy_price) VALUES (?, ?, ?, ?)').run(uid, symbol, amount, currentPrice);
            }
        } else if (side.toUpperCase() === 'SELL') {
            let holding = db.prepare('SELECT * FROM holdings WHERE uid = ? AND symbol = ?').get(uid, symbol);
            if (!holding || holding.amount < amount) {
                return res.status(400).json({ success: false, message: 'Insufficient crypto holdings to sell' });
            }
            let newAmount = holding.amount - parseFloat(amount);
            if (newAmount <= 0.0000001) {
                db.prepare('DELETE FROM holdings WHERE uid = ? AND symbol = ?').run(uid, symbol);
            } else {
                db.prepare('UPDATE holdings SET amount = ? WHERE uid = ? AND symbol = ?').run(newAmount, uid, symbol);
            }
            // Add USDT balance
            db.prepare('UPDATE users SET balance = balance + ? WHERE uid = ?').run(totalCost, uid);
        }

        const orderId = 'ORD_' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const tradeId = 'TRD_' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const fee = totalCost * 0.001; // 0.1% trading fee

        // Record order and trade history
        db.prepare('INSERT INTO orders (order_id, uid, symbol, side, type, price, amount, filled, status, tp, sl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(orderId, uid, symbol.toUpperCase(), side.toUpperCase(), type.toUpperCase(), currentPrice, amount, amount, 'FILLED', tp || null, sl || null);

        db.prepare('INSERT INTO trades (trade_id, uid, symbol, side, price, amount, fee, pnl) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(tradeId, uid, symbol.toUpperCase(), side.toUpperCase(), currentPrice, amount, fee, 0);

        // Optionally send live order to Bitget API in background
        placeBitgetSpotOrder(symbol, side, type, amount, currentPrice).catch(err => console.log('Bitget background sync error:', err.message));

        res.json({ success: true, message: 'Order executed successfully', orderId, tradeId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
