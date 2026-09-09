const fs = require('fs');
const path = require('path');

const dataDir = path.join('/tmp', 'crypto_data');
if (!fs.existsSync(dataDir)) {
    try {
        fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {}
}

const dbFile = path.join(dataDir, 'database.json');

function readDB() {
    try {
        if (!fs.existsSync(dbFile)) {
            const initialData = {
                users: [],
                holdings: [],
                orders: [],
                trades: [],
                transactions: [],
                admin: []
            };
            fs.writeFileSync(dbFile, JSON.stringify(initialData, null, 2));
            return initialData;
        }
        const data = fs.readFileSync(dbFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return { users: [], holdings: [], orders: [], trades: [], transactions: [], admin: [] };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
    } catch (err) {}
}

// Database helper object mimicking SQLite methods used in the app
const db = {
    prepare(query) {
        return {
            get(...params) {
                const dbData = readDB();
                q = query.trim().toUpperCase();
                if (q.startsWith('SELECT * FROM USERS WHERE UID')) {
                    let uid = params[0];
                    return dbData.users.find(u => u.uid === uid) || null;
                }
                if (q.startsWith('SELECT * FROM HOLDINGS WHERE UID')) {
                    let uid = params[0], symbol = params[1];
                    return dbData.holdings.find(h => h.uid === uid && h.symbol === symbol) || null;
                }
                return null;
            },
            all(...params) {
                const dbData = readDB();
                q = query.trim().toUpperCase();
                if (q.startsWith('SELECT * FROM HOLDINGS WHERE UID')) {
                    let uid = params[0];
                    return dbData.holdings.filter(h => h.uid === uid);
                }
                if (q.startsWith('SELECT * FROM ORDERS WHERE UID')) {
                    let uid = params[0];
                    return dbData.orders.filter(o => o.uid === uid).reverse();
                }
                if (q.startsWith('SELECT * FROM TRADES WHERE UID')) {
                    let uid = params[0];
                    return dbData.trades.filter(t => t.uid === uid).reverse();
                }
                if (q.startsWith('SELECT * FROM TRANSACTIONS WHERE UID')) {
                    let uid = params[0];
                    return dbData.transactions.filter(tx => tx.uid === uid).reverse();
                }
                return [];
            },
            run(...params) {
                const dbData = readDB();
                q = query.trim().toUpperCase();
                
                if (q.startsWith('INSERT INTO USERS')) {
                    let [uid, balance, pkr_balance] = params;
                    if (!dbData.users.some(u => u.uid === uid)) {
                        dbData.users.push({ id: Date.now(), uid, balance, pkr_balance, created_at: new Date().toISOString() });
                    }
                } else if (q.startsWith('UPDATE USERS SET BALANCE = BALANCE -')) {
                    let [amount, uid] = params;
                    let u = dbData.users.find(user => user.uid === uid);
                    if (u) u.balance -= amount;
                } else if (q.startsWith('UPDATE USERS SET BALANCE = BALANCE +')) {
                    let [amount, uid] = params;
                    let u = dbData.users.find(user => user.uid === uid);
                    if (u) u.balance += amount;
                } else if (q.startsWith('INSERT INTO HOLDINGS')) {
                    let [uid, symbol, amount, avg_buy_price] = params;
                    dbData.holdings.push({ id: Date.now(), uid, symbol, amount, avg_buy_price });
                } else if (q.startsWith('UPDATE HOLDINGS SET AMOUNT =')) {
                    let [amount, uid, symbol] = params;
                    let h = dbData.holdings.find(item => item.uid === uid && item.symbol === symbol);
                    if (h) h.amount = amount;
                } else if (q.startsWith('UPDATE HOLDINGS SET AMOUNT = ? , AVG_BUY_PRICE')) {
                    let [amount, avg_buy_price, uid, symbol] = params;
                    let h = dbData.holdings.find(item => item.uid === uid && item.symbol === symbol);
                    if (h) { h.amount = amount; h.avg_buy_price = avg_buy_price; }
                } else if (q.startsWith('DELETE FROM HOLDINGS')) {
                    let [uid, symbol] = params;
                    dbData.holdings = dbData.holdings.filter(h => !(h.uid === uid && h.symbol === symbol));
                } else if (q.startsWith('INSERT INTO ORDERS')) {
                    let [order_id, uid, symbol, side, type, price, amount, filled, status, tp, sl] = params;
                    dbData.orders.push({ id: Date.now(), order_id, uid, symbol, side, type, price, amount, filled, status, tp, sl, created_at: new Date().toISOString() });
                } else if (q.startsWith('INSERT INTO TRADES')) {
                    let [trade_id, uid, symbol, side, price, amount, fee, pnl] = params;
                    dbData.trades.push({ id: Date.now(), trade_id, uid, symbol, side, price, amount, fee, pnl, created_at: new Date().toISOString() });
                } else if (q.startsWith('INSERT INTO TRANSACTIONS')) {
                    let [tx_id, uid, type, method, amount, details, status] = params;
                    dbData.transactions.push({ id: Date.now(), tx_id, uid, type, method, amount, details, status, created_at: new Date().toISOString() });
                }

                writeDB(dbData);
                return { changes: 1 };
            }
        };
    },
    exec(sql) {
        // Dummy exec for table initialization compatibility
        readDB();
    }
};

module.exports = db;
