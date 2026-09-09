const fs = require('fs');
const path = require('path');

const dirPath = path.join(__dirname);
const filePath = path.join(dirPath, 'database.json');

function getData() {
    try {
        if (!fs.existsSync(filePath)) {
            return { wallets: [], holdings: [], trades: [], deposits: [], withdrawals: [], admin_fees: 0 };
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('Read DB Error:', e);
        return { wallets: [], holdings: [], trades: [], deposits: [], withdrawals: [], admin_fees: 0 };
    }
}

function saveData(data) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Save DB Error:', e);
    }
}

module.exports = { getData, saveData };
