let currentUid = localStorage.getItem('crypto_uid') || '';
let selectedSymbol = 'BTCUSDT';
let marketDataList = [];

document.addEventListener('DOMContentLoaded', () => {
    initUser();
    fetchBitgetMarkets();
    setupEventListeners();
});

async function initUser() {
    try {
        const res = await fetch('/api/user/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: currentUid })
        });
        const data = await res.json();
        if (data.success) {
            currentUid = data.uid;
            localStorage.setItem('crypto_uid', currentUid);
            const uidEl = document.getElementById('userUid');
            const balEl = document.getElementById('userBalance');
            if (uidEl) uidEl.innerText = `UID: ${currentUid}`;
            if (balEl) balEl.innerText = `USDT Balance: ${data.wallet.usdt_balance.toFixed(2)}`;
            loadPortfolio();
        }
    } catch (e) {
        console.error('Initialization error', e);
    }
}

async function fetchBitgetMarkets() {
    try {
        const res = await fetch('/api/bitget/markets');
        const data = await res.json();
        if (data.success && data.markets) {
            marketDataList = data.markets;
            renderMarkets(marketDataList);
        }
    } catch (e) {
        console.error('Failed to fetch markets', e);
    }
}

function renderMarkets(markets) {
    const container = document.getElementById('marketListContainer');
    if (!container) return;

    // Filter only USDT pairs
    const usdtPairs = markets.filter(m => m.symbol.endsWith('USDT'));
    
    if (usdtPairs.length === 0) {
        container.innerHTML = `<div style="padding: 10px; text-align:center;">No markets found</div>`;
        return;
    }

    container.innerHTML = usdtPairs.map(m => `
        <div class="market-item" onclick="selectSymbol('${m.symbol}')">
            <span class="market-symbol">${m.symbol}</span>
            <span class="market-price">${parseFloat(m.lastPr || 0).toFixed(4)}</span>
        </div>
    `).join('');
}

function selectSymbol(symbol) {
    selectedSymbol = symbol;
    document.getElementById('selectedPairHeader').innerText = symbol;
    document.getElementById('tradingPairTitle').innerText = symbol;
}

async function loadPortfolio() {
    if (!currentUid) return;
    try {
        const res = await fetch(`/api/user/portfolio/${currentUid}`);
        const data = await res.json();
        if (data.success) {
            const balEl = document.getElementById('userBalance');
            if (balEl) balEl.innerText = `USDT Balance: ${data.wallet.usdt_balance.toFixed(2)}`;
            
            const holdingsBody = document.getElementById('holdingsTableBody');
            if (holdingsBody) {
                if (!data.holdings || data.holdings.length === 0) {
                    holdingsBody.innerHTML = `<tr><td colspan="3">No holdings found</td></tr>`;
                } else {
                    holdingsBody.innerHTML = data.holdings.map(h => `
                        <tr>
                            <td>${h.symbol}</td>
                            <td>${h.amount.toFixed(4)}</td>
                            <td>${h.avg_buy_price.toFixed(2)}</td>
                        </tr>
                    `).join('');
                }
            }

            const tradesBody = document.getElementById('tradesTableBody');
            if (tradesBody) {
                if (!data.trades || data.trades.length === 0) {
                    tradesBody.innerHTML = `<tr><td colspan="5">No trades found</td></tr>`;
                } else {
                    tradesBody.innerHTML = data.trades.slice(-5).reverse().map(t => `
                        <tr>
                            <td>${t.id}</td>
                            <td style="color:${t.side==='BUY'?'#0ecb81':'#f6465d'}">${t.side}</td>
                            <td>${t.price.toFixed(2)}</td>
                            <td>${t.amount.toFixed(4)}</td>
                            <td>${t.fee.toFixed(4)}</td>
                        </tr>
                    `).join('');
                }
            }
        }
    } catch (e) {
        console.error('Error loading portfolio', e);
    }
}

function setupEventListeners() {
    // Market search filter
    const searchInput = document.getElementById('marketSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toUpperCase();
            const filtered = marketDataList.filter(m => m.symbol.includes(query));
            renderMarkets(filtered);
        });
    }

    // Order Type toggle
    const orderTypeSelect = document.getElementById('orderType');
    if (orderTypeSelect) {
        orderTypeSelect.addEventListener('change', (e) => {
            const isLimit = e.target.value === 'Limit';
            const limitGroup = document.getElementById('limitPriceGroup');
            if (limitGroup) limitGroup.style.display = isLimit ? 'block' : 'none';
        });
    }

    // Buy / Sell execution
    const buyBtn = document.getElementById('buyBtn');
    const sellBtn = document.getElementById('sellBtn');
    if (buyBtn) buyBtn.addEventListener('click', () => executeTrade('BUY'));
    if (sellBtn) sellBtn.addEventListener('click', () => executeTrade('SELL'));

    // Modals Popup Handling
    const depositModal = document.getElementById('depositModal');
    const withdrawModal = document.getElementById('withdrawModal');
    const adminModal = document.getElementById('adminModal');

    document.getElementById('depositBtn').onclick = () => { depositModal.style.display = 'flex'; };
    document.getElementById('closeDeposit').onclick = () => { depositModal.style.display = 'none'; };

    document.getElementById('withdrawBtn').onclick = () => { withdrawModal.style.display = 'flex'; };
    document.getElementById('closeWithdraw').onclick = () => { withdrawModal.style.display = 'none'; };

    document.getElementById('adminBtn').onclick = () => {
        adminModal.style.display = 'flex';
        document.getElementById('adminLoginBox').style.display = 'block';
        document.getElementById('adminDashboardContent').style.display = 'none';
        document.getElementById('adminPasswordInput').value = '';
    };
    document.getElementById('closeAdmin').onclick = () => { adminModal.style.display = 'none'; };

    // Admin Login with password `Mmooossaa35#`
    document.getElementById('adminLoginBtn').onclick = async () => {
        const password = document.getElementById('adminPasswordInput').value;
        const res = await fetch('/api/admin/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('adminLoginBox').style.display = 'none';
            document.getElementById('adminDashboardContent').style.display = 'block';
            document.getElementById('adminProfit').innerText = data.admin_profit.toFixed(4);
            renderAdminRequests(data.deposits, data.withdrawals, password);
        } else {
            alert(data.message || 'Incorrect Password');
        }
    };

    // Submit Deposit
    document.getElementById('submitDeposit').onclick = async () => {
        const amount = parseFloat(document.getElementById('depositAmount').value);
        const method = document.getElementById('depositMethod').value;
        const details = document.getElementById('depositDetails').value;
        if (!amount || amount <= 0) return alert('Enter valid amount');

        const res = await fetch('/api/deposit/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: currentUid, method, amount, details })
        });
        const data = await res.json();
        alert(data.message);
        if (data.success) {
            depositModal.style.display = 'none';
            loadPortfolio();
        }
    };

    // Submit Withdraw
    document.getElementById('submitWithdraw').onclick = async () => {
        const amount = parseFloat(document.getElementById('withdrawAmount').value);
        const address = document.getElementById('withdrawAddress').value;
        if (!amount || !address) return alert('Enter valid withdrawal details');

        const res = await fetch('/api/withdraw/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: currentUid, address, amount })
        });
        const data = await res.json();
        alert(data.message);
        if (data.success) {
            withdrawModal.style.display = 'none';
            loadPortfolio();
        }
    };
}

async function executeTrade(side) {
    const type = document.getElementById('orderType').value;
    const amount = parseFloat(document.getElementById('tradeAmount').value);
    const price = type === 'Limit' ? parseFloat(document.getElementById('limitPrice').value) : 0;

    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    try {
        const res = await fetch('/api/trade/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: currentUid, symbol: selectedSymbol, side, type, price, amount })
        });
        const data = await res.json();
        alert(data.message);
        if (data.success) {
            loadPortfolio();
        }
    } catch (e) {
        alert('Order execution failed');
    }
}

function renderAdminRequests(deposits, withdrawals, password) {
    let allRequests = [
        ...(deposits || []).map(d => ({ ...d, reqType: 'deposit' })),
        ...(withdrawals || []).map(w => ({ ...w, reqType: 'withdrawal', details: w.address }))
    ];

    const tbody = document.getElementById('adminRequestsBody');
    if (!tbody) return;

    if (allRequests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6">No pending or past requests</td></tr>`;
        return;
    }

    tbody.innerHTML = allRequests.reverse().map(r => `
        <tr>
            <td>${r.reqType.toUpperCase()}</td>
            <td>${r.uid}</td>
            <td>$${r.amount}</td>
            <td>${r.details || '-'}</td>
            <td><b>${r.status}</b></td>
            <td>
                ${r.status === 'Pending' ? `
                    <button onclick="handleAdminAction('${r.reqType}', '${r.id}', 'Approved', '${password}')" style="background:#0ecb81; border:none; padding:4px 8px; color:#000; border-radius:3px; cursor:pointer;">Approve</button>
                    <button onclick="handleAdminAction('${r.reqType}', '${r.id}', 'Rejected', '${password}')" style="background:#f6465d; border:none; padding:4px 8px; color:#fff; border-radius:3px; cursor:pointer;">Reject</button>
                ` : r.status}
            </td>
        </tr>
    `).join('');
}

async function handleAdminAction(type, id, status, password) {
    const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, type, id, status })
    });
    const data = await res.json();
    alert(data.message);
    if (data.success) {
        // Refresh admin data
        const adminRes = await fetch('/api/admin/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const adminData = await adminRes.json();
        if (adminData.success) {
            renderAdminRequests(adminData.deposits, adminData.withdrawals, password);
        }
    }
        }
