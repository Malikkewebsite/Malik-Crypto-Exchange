document.addEventListener('DOMContentLoaded', () => {
    let currentPair = 'BTCUSDT';
    
    // Persistent UID and Local Balance Backup for Vercel Serverless
    let uid = localStorage.getItem('crypto_uid') || localStorage.getItem('uid');
    if (!uid) {
        uid = 'UID_' + Math.random().toString(36).substring(2, 10).toUpperCase();
        localStorage.setItem('crypto_uid', uid);
        localStorage.setItem('uid', uid);
    }

    let localBalance = parseFloat(localStorage.getItem('crypto_balance') || '0');

    // Initialize user session on server with local backup sync
    fetch('/api/user/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, initial_balance: localBalance })
    }).then(res => res.json()).then(data => {
        if (data.success) {
            loadUserData();
        }
    });

    // Fetch Bitget Markets
    loadMarkets();
    setInterval(loadMarkets, 10000);

    async function loadMarkets() {
        try {
            const res = await fetch('/api/bitget/markets');
            const data = await res.json();
            if (data.success && data.markets) {
                const container = document.getElementById('marketListContainer');
                const search = document.getElementById('marketSearch').value.toUpperCase();
                
                container.innerHTML = '';
                data.markets.filter(m => m.symbol.includes(search)).forEach(m => {
                    const div = document.createElement('div');
                    div.style.cssText = 'display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #2b313a; cursor: pointer; font-size: 12px;';
                    div.innerHTML = `<span><b>${m.symbol}</b></span> <span style="color: #0ecb81;">$${parseFloat(m.lastPr || 0).toFixed(4)}</span>`;
                    div.onclick = () => {
                        currentPair = m.symbol.toUpperCase().replace(/[\/_\\-]/g, '');
                        document.getElementById('selectedPairHeader').innerText = currentPair;
                        document.getElementById('tradingPairTitle').innerText = currentPair;
                    };
                    container.appendChild(div);
                });
            }
        } catch (e) {
            console.error('Market load error', e);
        }
    }

    const searchInput = document.getElementById('marketSearch');
    if(searchInput) searchInput.addEventListener('input', loadMarkets);

    async function loadUserData() {
        try {
            const res = await fetch(`/api/user/portfolio/${uid}`);
            const data = await res.json();
            if (data.success) {
                if (data.wallet.usdt_balance === 0 && localBalance > 0) {
                    await fetch('/api/user/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uid, balance: localBalance })
                    });
                    data.wallet.usdt_balance = localBalance;
                } else {
                    localBalance = data.wallet.usdt_balance;
                    localStorage.setItem('crypto_balance', localBalance);
                }

                document.getElementById('userBalance').innerText = 'USDT Balance: ' + data.wallet.usdt_balance.toFixed(2);
                document.getElementById('userUid').innerText = 'UID: ' + uid;
                
                // Render Holdings
                const holdingsBody = document.getElementById('holdingsTableBody');
                if (data.holdings && data.holdings.length > 0) {
                    holdingsBody.innerHTML = data.holdings.map(h => `
                        <tr>
                            <td>${h.symbol}</td>
                            <td>${h.amount.toFixed(4)}</td>
                            <td>$${h.avgPrice.toFixed(2)}</td>
                            <td style="color:${h.pnlUsdt >= 0 ? '#0ecb81' : '#f6465d'}">$${h.pnlUsdt.toFixed(2)}</td>
                            <td style="color:${h.pnlPkr >= 0 ? '#0ecb81' : '#f6465d'}">Rs ${h.pnlPkr.toFixed(2)}</td>
                        </tr>
                    `).join('');
                } else {
                    holdingsBody.innerHTML = `<tr><td colspan="5">No holdings found</td></tr>`;
                }

                // Render Trades
                const tradesBody = document.getElementById('tradesTableBody');
                if (data.trades && data.trades.length > 0) {
                    tradesBody.innerHTML = data.trades.slice(-10).reverse().map(t => `
                        <tr>
                            <td>${t.id}</td>
                            <td style="color:${t.side === 'BUY' ? '#0ecb81' : '#f6465d'}">${t.side}</td>
                            <td>$${t.price.toFixed(2)}</td>
                            <td>${t.amount.toFixed(4)}</td>
                            <td>$${t.fee.toFixed(2)}</td>
                            <td><b>${t.status}</b></td>
                        </tr>
                    `).join('');
                } else {
                    tradesBody.innerHTML = `<tr><td colspan="6">No trades found</td></tr>`;
                }

                if (data.stats) {
                    document.getElementById('userStatsSummary').innerHTML = `Total Deposited: $${data.stats.totalDeposited.toFixed(2)} | Withdrawn: $${data.stats.totalWithdrawn.toFixed(2)} | Net P&L: $${data.stats.netProfitLoss.toFixed(2)}`;
                }
            }
        } catch (e) {
            console.error('User data error', e);
        }
    }

    // Trade Execution
    async function executeTrade(side) {
        const amount = parseFloat(document.getElementById('tradeAmount').value);
        const orderType = document.getElementById('orderType').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;

        if (!amount || amount <= 0) {
            alert('Please enter a valid amount');
            return;
        }

        try {
            const res = await fetch('/api/trade/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid, symbol: currentPair, side, type: orderType, price: limitPrice, amount })
            });
            const result = await res.json();
            alert(result.message);
            if (result.success) {
                document.getElementById('tradeAmount').value = '';
                await loadUserData();
            }
        } catch (e) {
            console.error('Trade error', e);
        }
    }

    document.getElementById('buyBtn').onclick = () => executeTrade('BUY');
    document.getElementById('sellBtn').onclick = () => executeTrade('SELL');

    // Modals Handling
    const depositModal = document.getElementById('depositModal');
    const withdrawModal = document.getElementById('withdrawModal');
    const adminModal = document.getElementById('adminModal');

    document.getElementById('depositBtn').onclick = () => depositModal.style.display = 'flex';
    document.getElementById('closeDeposit').onclick = () => depositModal.style.display = 'none';

    document.getElementById('withdrawBtn').onclick = () => {
        withdrawModal.style.display = 'flex';
        updateWhatsAppLink();
    };
    document.getElementById('closeWithdraw').onclick = () => withdrawModal.style.display = 'none';

    document.getElementById('adminBtn').onclick = () => adminModal.style.display = 'flex';
    document.getElementById('closeAdmin').onclick = () => adminModal.style.display = 'none';

    function updateWhatsAppLink() {
        const balanceText = document.getElementById('userBalance').innerText;
        const message = `Hello Admin, I want to request a withdrawal.\nMy User ID: ${uid}\n${balanceText}`;
        const encodedMsg = encodeURIComponent(message);
        
        const waLink = withdrawModal.querySelector('a[href*="wa.me"]');
        if(waLink) {
            waLink.href = `https://wa.me/923125124424?text=${encodedMsg}`;
        }
    }

    document.getElementById('submitDeposit').onclick = async () => {
        const method = document.getElementById('depositMethod').value;
        const amount = parseFloat(document.getElementById('depositAmount').value);
        const details = document.getElementById('depositDetails').value;

        if (!amount || amount <= 0) {
            alert('Enter valid deposit amount');
            return;
        }

        const res = await fetch('/api/deposit/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, method, amount, details })
        });
        const r = await res.json();
        alert(r.message);
        if (r.success) {
            depositModal.style.display = 'none';
            document.getElementById('depositAmount').value = '';
            document.getElementById('depositDetails').value = '';
            loadUserData();
        }
    };

    document.getElementById('submitWithdraw').onclick = async () => {
        const address = document.getElementById('withdrawAddress').value;
        const amount = parseFloat(document.getElementById('withdrawAmount').value);

        if (!address || !amount || amount <= 0) {
            alert('Enter valid withdrawal details');
            return;
        }

        const res = await fetch('/api/withdraw/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, address, amount })
        });
        const r = await res.json();
        alert(r.message);
        if (r.success) {
            withdrawModal.style.display = 'none';
            document.getElementById('withdrawAddress').value = '';
            document.getElementById('withdrawAmount').value = '';
            loadUserData();
        }
    };

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
            document.getElementById('adminProfit').innerText = data.admin_profit.toFixed(2);

            const tbody = document.getElementById('adminRequestsBody');
            let allReqs = [];
            data.deposits.forEach(d => allReqs.push({ ...d, reqType: 'deposit' }));
            data.withdrawals.forEach(w => allReqs.push({ ...w, reqType: 'withdrawal' }));

            if (allReqs.length > 0) {
                tbody.innerHTML = allReqs.map(r => `
                    <tr>
                        <td>${r.reqType.toUpperCase()}</td>
                        <td>${r.uid}</td>
                        <td>$${r.amount}</td>
                        <td>${r.details || r.address || '-'}</td>
                        <td><b>${r.status}</b></td>
                        <td>
                            ${r.status === 'Pending' ? `
                                <button onclick="handleAdminAction('${r.reqType}', '${r.id}', 'Approved', '${password}')" style="background:#0ecb81; color:#fff; border:none; padding:4px 8px; cursor:pointer; border-radius:3px;">Approve</button>
                                <button onclick="handleAdminAction('${r.reqType}', '${r.id}', 'Rejected', '${password}')" style="background:#f6465d; color:#fff; border:none; padding:4px 8px; cursor:pointer; border-radius:3px;">Reject</button>
                            ` : r.status}
                        </td>
                    </tr>
                `).join('');
            } else {
                tbody.innerHTML = `<tr><td colspan="6">No requests found</td></tr>`;
            }
        } else {
            alert(data.message);
        }
    };
});

window.handleAdminAction = async function(type, id, status, password) {
    const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, type, id, status })
    });
    const r = await res.json();
    alert(r.message);
    if (r.success) {
        document.getElementById('adminBtn').click();
    }
};
