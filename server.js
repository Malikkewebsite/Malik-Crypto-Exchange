const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./database/db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to ensure automatic UID generation for normal users
app.use((req, res, next) => {
    let userUid = req.headers['x-user-uid'] || req.query.uid || req.body.uid;
    
    if (userUid) {
        // Check if user exists, else create automatically
        let user = db.prepare('SELECT * FROM users WHERE uid = ?').get(userUid);
        if (!user) {
            db.prepare('INSERT INTO users (uid, balance, pkr_balance) VALUES (?, ?, ?)').run(userUid, 1000.0, 0.0);
        }
    }
    next();
});

// --- API ROUTES ---

// 1. Get or Generate UID & Profile
app.get('/api/user/profile', (req, res) => {
    let uid = req.headers['x-user-uid'] || req.query.uid;
    if (!uid) {
        uid = 'UID_' + crypto.randomBytes(4).toString('hex').toUpperCase();
        db.prepare('INSERT INTO users (uid, balance, pkr_balance) VALUES (?, ?, ?)').run(uid, 1000.0, 0.0);
    } else {
        let user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid);
        if (!user) {
            db.prepare('INSERT INTO users (uid, balance, pkr_balance) VALUES (?, ?, ?)').run(uid, 1000.0, 0.0);
        }
    }
    let user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid);
    let holdings = db.prepare('SELECT * FROM holdings WHERE uid = ?').all(uid);
    let orders = db.prepare('SELECT * FROM orders WHERE uid = ? ORDER BY id DESC').all(uid);
    let trades = db.prepare('SELECT * FROM trades WHERE uid = ? ORDER BY id DESC').all(uid);

    res.json({ success: true, user, holdings, orders, trades });
});

// 2. Get User Wallet / Balances
app.get('/api/wallet', (req, res) => {
    const uid = req.headers['x-user-uid'];
    if (!uid) return res.status(400).json({ success: false, message: 'UID missing' });

    let user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid);
    let holdings = db.prepare('SELECT * FROM holdings WHERE uid = ?').all(uid);
    let transactions = db.prepare('SELECT * FROM transactions WHERE uid = ? ORDER BY id DESC').all(uid);

    res.json({ success: true, balance: user.balance, pkr_balance: user.pkr_balance, holdings, transactions });
});

// 3. Deposit / Withdrawal Request Endpoint
app.post('/api/wallet/transaction', (req, res) => {
    const uid = req.headers['x-user-uid'];
    const { type, method, amount, details } = req.body; // type: DEPOSIT/WITHDRAWAL, method: USDT_TRC20/EASYPAISA
    if (!uid || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid data' });

    const txId = 'TX_' + crypto.randomBytes(4).toString('hex').toUpperCase();
    
    // If withdrawal, check if user has enough balance
    if (type === 'WITHDRAWAL') {
        let user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid);
        if (user.balance < amount) {
            return res.status(400).json({ success: false, message: 'Insufficient balance for withdrawal' });
        }
    }

    db.prepare('INSERT INTO transactions (tx_id, uid, type, method, amount, details, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(txId, uid, type, method, amount, details || '', 'PENDING');

    res.json({ success: true, message: 'Transaction request submitted successfully', txId });
});

// Root fallback to frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
