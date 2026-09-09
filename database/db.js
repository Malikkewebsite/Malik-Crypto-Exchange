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
                wallets: [],
                holdings: [],
                orders: [],
                trades: [],
                deposits: [],
                withdrawals: [],
                transactions: [],
                fees: [],
                admin_settings: { usdt_address: 'TRC20_DEFAULT_ADDRESS_HERE', easypaisa_number: '03001234567' },
                audit_logs: []
            };
            fs.writeFileSync(dbFile, JSON.stringify(initialData, null, 2));
            return initialData;
        }
        const data = fs.readFileSync(dbFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return {
            users: [], wallets: [], holdings: [], orders: [], trades: [],
            deposits: [], withdrawals: [], transactions: [], fees: [],
            admin_settings: {}, audit_logs: []
        };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
    } catch (err) {}
}

const db = {
    getData() { return readDB(); },
    saveData(data) { writeDB(data); },
    
    // Helper to log admin/user actions
    logAudit(uid, action, details) {
        const dbData = readDB();
        dbData.audit_logs.push({
            id: Date.now(),
            uid,
            action,
            details,
            timestamp: new Date().toISOString()
        });
        writeDB(dbData);
    }
};

module.exports = db;
