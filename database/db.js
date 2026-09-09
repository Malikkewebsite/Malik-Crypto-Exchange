const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists for serverless/local environments
const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'crypto_platform.db');
const db = new Database(dbPath, { verbose: null });

// Initialize database tables for multi-user automatic UID system
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT UNIQUE NOT NULL,
        balance REAL DEFAULT 1000.0,
        pkr_balance REAL DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        symbol TEXT NOT NULL,
        amount REAL NOT NULL,
        avg_buy_price REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT UNIQUE NOT NULL,
        uid TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        price REAL NOT NULL,
        amount REAL NOT NULL,
        filled REAL DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        tp REAL,
        sl REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT UNIQUE NOT NULL,
        uid TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        price REAL NOT NULL,
        amount REAL NOT NULL,
        fee REAL NOT NULL,
        pnl REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tx_id TEXT UNIQUE NOT NULL,
        uid TEXT NOT NULL,
        type TEXT NOT NULL, -- DEPOSIT / WITHDRAWAL
        method TEXT NOT NULL, -- USDT_TRC20 / EASYPAISA
        amount REAL NOT NULL,
        status TEXT DEFAULT 'PENDING', -- PENDING / APPROVED / REJECTED
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    );
`);

module.exports = db;
