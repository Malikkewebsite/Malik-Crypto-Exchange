let currentUid = localStorage.getItem('crypto_uid') || '';

document.addEventListener('DOMContentLoaded', () => {
    initUser();
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

async function loadPortfolio() {
    if (!currentUid) return;
    try {
        const res = await fetch(`/api/user/portfolio/${currentUid}`);
        const data = await res.json();
        if (data.success) {
            const balEl = document.getElementById('userBalance');
            if (balEl) balEl.innerText = `USDT Balance: ${data.wallet.usdt_balance.toFixed(2)}`;
            
            // Render Holdings
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

            // Render Trades
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

    // Modals Handling (Deposit, Withdraw, Admin)
    const depositModal = document.getElementById('depositModal');
    const withdrawModal = document.getElementById('withdrawModal');
    const adminModal = document.getElementById('adminModal');

    const depositBtn = document.getElementById('depositBtn');
    const closeDeposit = document.getElementById('closeDeposit');
    if (depositBtn && depositModal) {
        depositBtn.onclick = () => { depositModal.style.display = 'block'; };
    }
    if (closeDeposit && depositModal) {
        closeDeposit.onclick = () => { depositModal.style.display = 'none'; };
    }

    const withdrawBtn = document.getElementById('withdrawBtn');
    const closeWithdraw = document.getElementById('closeWithdraw');
    if (withdrawBtn && withdrawModal) {
        withdrawBtn.onclick = () => { withdrawModal.style.display = 'block'; };
    }
    if (closeWithdraw && withdrawModal) {
        closeWithdraw.onclick = () => { withdrawModal.style.display = 'none'; };
    }

    const adminBtn = document.getElementById('adminBtn');
    const closeAdmin = document.getElementById('closeAdmin');
    if (adminBtn && adminModal) {
        adminBtn.onclick = () => {
            adminModal.style.display = 'block';
            loadAdminData();
        };
    }
    if (closeAdmin && adminModal) {
        closeAdmin.onclick = () => { adminModal.style.display = 'none'; };
    }

    // Submit Deposit
    const submitDeposit = document.getElementById('submitDeposit');
    if (submitDeposit) {
        submitDeposit.onclick = async () => {
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
    }

    // Submit Withdraw
    const submitWithdraw = document.getElementById('submitWithdraw');
    if (submitWithdraw) {
        submitWithdraw.onclick = async () => {
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
}

async function executeTrade(side) {
    const type = document.getElementById('orderType').value;
    const amount = parseFloat(document.getElementById('tradeAmount').value);
    const price = type === 'Limit' ? parseFloat(document.getElementById('limitPrice').value) : 78950;

    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    try {
        const res = await fetch('/api/trade/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: currentUid, symbol: 'BTCUSDT', side, type, price, amount })
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

async function loadAdminData() {
    try {
        const res = await fetch('/api/admin/data');
        const data = await res.json();
        if (data.success) {
            const profitEl = document.getElementById('adminProfit');
            if (profitEl) profitEl.innerText = data.admin_profit.toFixed(4);
            
            let allRequests = [
                ...(data.deposits || []).map(d => ({ ...d, reqType: 'deposit' })),
                ...(data.withdrawals || []).map(w => ({ ...w, reqType: 'withdrawal', details: w.address }))
            ];

            const tbody = document.getElementById('adminRequestsBody');
            if (tbody) {
                if (allRequests.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="6">No pending or past requests</td></tr>`;
                } else {
                    tbody.innerHTML = allRequests.reverse().log ? allRequests.map(r => `
                        <tr>
                            <td>${r.reqType.toUpperCase()} (${r.method || 'TRC20'})</td>
                            <td>${r.uid}</td>
                            <td>$${r.amount}</td>
                            <td>${r.details || '-'}</td>
                            <td><b>${r.status}</b></td>
                            <td>
                                ${r.status === 'Pending' ? `
                                    <button onclick="handleAdminAction('${r.reqType}', '${r.id}', 'Approved')" class="btn-sm btn-buy">Approve</button>
                                    <button onclick="handleAdminAction('${r.reqType}', '${r.id}', 'Rejected')" class="btn-sm btn-sell">Reject</button>
                                ` : r.status}
                            </td>
                        </tr>
                    `).join('') : allRequests.map(r => `
                        <tr>
                            <td>${r.reqType.toUpperCase()} (${r.method || 'TRC20'})</td>
                            <td>${r.uid}</td>
                            <td>$${r.amount}</td>
                            <td>${r.details || '-'}</td>
                            <td><b>${r.status}</b></td>
                            <td>
                                ${r.status === 'Pending' ? `
                                    <button onclick="handleAdminAction('${r.reqType}', '${r.id}', 'Approved')" class="btn-sm btn-buy">Approve</button>
                                    <button onclick="handleAdminAction('${r.reqType}', '${r.id}', 'Rejected')" class="btn-sm btn-sell">Reject</button>
                                ` : r.status}
                            </td>
                        </tr>
                    `).join('');
                }
            }
        }
    } catch (e) {
        console.error('Error loading admin data', e);
    }
}

async function handleAdminAction(type, id, status) {
    const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, status })
    });
    const data = await res.json();
    alert(data.message);
    if (data.success) {
        loadAdminData();
    }
                }
