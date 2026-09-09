let userUid = localStorage.getItem('crypto_uid') || '';

async function initApp() {
    try {
        const headers = userUid ? { 'x-user-uid': userUid } : {};
        const response = await axios.get('/api/user/profile', { headers });
        
        if (response.data.success) {
            userUid = response.data.user.uid;
            localStorage.setItem('crypto_uid', userUid);
            
            document.getElementById('userUidDisplay').innerText = userUid;
            document.getElementById('usdtBalance').innerText = parseFloat(response.data.user.balance).toFixed(2);
            
            renderHoldings(response.data.holdings);
            fetchLivePrice();
        }
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

async function fetchLivePrice() {
    try {
        const res = await axios.get('/api/market/price/BTCUSDT');
        if (res.data.success) {
            document.getElementById('currentPrice').innerText = res.data.price.toFixed(2);
        }
    } catch (err) {
        console.error('Error fetching price:', err);
    }
}

async function placeOrder(side) {
    const type = document.getElementById('orderType').value;
    const amount = parseFloat(document.getElementById('orderAmount').value);
    const msgEl = document.getElementById('orderMessage');

    if (!amount || amount <= 0) {
        msgEl.style.color = '#f6465d';
        msgEl.innerText = 'Please enter a valid amount';
        return;
    }

    try {
        const response = await axios.post('/api/order/place', {
            symbol: 'BTCUSDT',
            side: side,
            type: type,
            amount: amount
        }, {
            headers: { 'x-user-uid': userUid }
        });

        if (response.data.success) {
            msgEl.style.color = '#0ecb81';
            msgEl.innerText = 'Order executed successfully!';
            initApp(); // Refresh user balance & holdings
        }
    } catch (error) {
        msgEl.style.color = '#f6465d';
        msgEl.innerText = error.response?.data?.message || 'Order execution failed';
    }
}

function renderHoldings(holdings) {
    const tbody = document.querySelector('#holdingsTable tbody');
    tbody.innerHTML = '';
    if (!holdings || holdings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#848e9c;">No holdings found</td></tr>';
        return;
    }
    holdings.forEach(h => {
        tbody.innerHTML += `<tr><td>${h.symbol}</td><td>${h.amount}</td><td>$${h.avg_buy_price.toFixed(2)}</td></tr>`;
    });
}

// Initialize on load and poll price every 5 seconds
initApp();
setInterval(fetchLivePrice, 5000);
