const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'database.json');

// Ensure database file exists
if (!fs.existsSync(filePath)) {
    const initialData = {
        wallets: [],
        holdings: [],
        trades: [],
        deposits: [],
        withdrawals: [],
        admin_fees: 0
    };
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2));
}

function getData() {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { wallets: [], holdings: [], trades: [], deposits: [], withdrawals: [], admin_fees: 0 };
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error saving database:', e);
    }
}

module.exports = { getData, saveData };
