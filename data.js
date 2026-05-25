// ============================================================
//  STATE
// ============================================================
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// *** BAKED-IN Sheets URL — works for ALL visitors regardless of localStorage ***
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxp2HZkG4trQHQpb3nLgj9i-5kwJTlZzU1udMD6OXuXT5HCXuvlUW_oA9gs1PtKDZzmbw/exec';


function getEffectiveSheetsUrl() {
  return (state.settings.sheetsUrl && state.settings.sheetsUrl.trim()) || SHEETS_URL;
}

let state = {
  members: [],
  payments: [],
  expenses: [],
  notices: [],
  settings: {
    sheetsUrl: SHEETS_URL,
    syncMode: 'auto',
    monthlyRate: 2000,
    currency: '৳',
    fundName: 'Future Fund Savings',
    foundedDate: '2026-05',
    noticeDaysBeforeExpiry: 30
  },
  adminPassword: 'admin123',
  isAdmin: false,
  loggedInMember: null, // { id, name, role } when a member is logged in
  currentPage: 'home'
};

function saveSession() {
  sessionStorage.setItem('ffs_session', JSON.stringify({
    isAdmin: state.isAdmin,
    loggedInMember: state.loggedInMember,
    currentPage: state.currentPage
  }));
}

function loadState() {
  try {
    const s = localStorage.getItem('ffs_state');
    if (s) {
      const parsed = JSON.parse(s);
      state = { ...state, ...parsed };
      if (!state.members) state.members = [];
      if (!state.payments) state.payments = [];
      if (!state.expenses) state.expenses = [];
      if (!state.notices) state.notices = [];
    } else {
      seedData();
    }
  } catch(e) { seedData(); }

  // Restore session from sessionStorage (survives refresh, cleared on tab close)
  try {
    const sess = sessionStorage.getItem('ffs_session');
    if (sess) {
      const parsed = JSON.parse(sess);
      state.isAdmin = parsed.isAdmin || false;
      state.loggedInMember = parsed.loggedInMember || null;
      state.currentPage = parsed.currentPage || 'home';
    }
  } catch(e) {}

  const isLoggedIn = state.isAdmin || !!state.loggedInMember;
  populateMemberLoginSelect();
  if (isLoggedIn) {
    hideLoginScreen();
    updateSessionUI();
    navigate(state.currentPage || 'home');
    // Auto-pull fresh data from Google Sheets on every page load
    if (state.settings.sheetsUrl) {
      fetchFromSheets().catch(() => {});
    }
  } else {
    state.isAdmin = false;
    state.loggedInMember = null;
    // Pull from Sheets even before login so member list in dropdown is up-to-date
    showLoginScreen();
    (async () => {
      try {
        const url = getEffectiveSheetsUrl();
        if (!url) return;
        const res = await fetch(url + '?action=fetch');
        const d = await res.json();
        if (d.members) state.members = d.members;
        if (d.payments) state.payments = d.payments;
        if (d.expenses) state.expenses = d.expenses;
        if (d.notices) state.notices = d.notices;
        autoExpireNotices();
        saveState();
        populateMemberLoginSelect();
      } catch(e) {}
    })();
  }
}

function saveState() {
  localStorage.setItem('ffs_state', JSON.stringify(state));
}

function seedData() {
  state.members = [];
  state.payments = [];
  state.expenses = [];
  state.notices = [];
  saveState();
}

// ============================================================
//  NAV
// ============================================================
function navigate(page) {
  // Block members from accessing settings
  if (page === 'settings' && !state.isAdmin) {
    page = 'home';
  }
  state.currentPage = page;
  saveSession();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if(n.textContent.trim().toLowerCase().includes(page === 'home' ? 'home' :
       page === 'dashboard' ? 'dashboard' : page === 'payments' ? 'payment' :
       page === 'expenses' ? 'expense' : page === 'members' ? 'member' : page === 'my-details' ? 'my details' : page === 'notice-board' ? 'notice board' : 'setting')) {
      n.classList.add('active');
    }
  });
  const titles = {home:'Home',dashboard:'Dashboard',payments:'Payments',expenses:'Expenses',members:'Members',settings:'Settings','my-details':'My Details','notice-board':'Notice Board'};
  document.getElementById('topbar-title').textContent = titles[page] || page;
  closeSidebar();
  renderPage(page);
}

function renderPage(page) {
  if(page === 'home') renderHome();
  if(page === 'dashboard') renderDashboard();
  if(page === 'payments') renderPayments();
  if(page === 'expenses') renderExpenses();
  if(page === 'members') renderMembers();
  if(page === 'settings') renderSettings();
  if(page === 'my-details') renderMyDetails();
  if(page === 'notice-board') { if(typeof renderNoticeBoard === 'function') renderNoticeBoard(); }
}

// ============================================================
//  HELPERS
// ============================================================
const C = (n) => state.settings.currency + n.toLocaleString();
const uid = () => Math.random().toString(36).substr(2,9).toUpperCase();
const now = () => new Date().toISOString().split('T')[0];

function getMemberTotals(memberId) {
  const pays = state.payments.filter(p => p.memberId === memberId && p.type === 'deposit');
  const charges = state.payments.filter(p => p.memberId === memberId && (p.type === 'charge' || p.type === 'delay'));
  const totalPaid = pays.reduce((s,p) => s+Number(p.amount),0);
  const totalCharge = charges.reduce((s,p) => s+Number(p.amount),0);
  const paidMonths = new Set(pays.map(p => p.forYear+'-'+p.forMonth)).size;
  const member = state.members.find(m => m.id === memberId);
  const joinDate = member ? new Date(member.joinDate+'-01') : new Date('2024-01-01');
  const today = new Date();
  const totalMonths = (today.getFullYear() - joinDate.getFullYear())*12 + (today.getMonth() - joinDate.getMonth()) + 1;
  const unpaidMonths = Math.max(0, totalMonths - paidMonths);
  return { totalPaid, totalCharge, paidMonths, unpaidMonths, totalMonths };
}

function getTotals() {
  const deposits = state.payments.filter(p=>p.type==='deposit').reduce((s,p)=>s+Number(p.amount),0);
  const charges = state.payments.filter(p=>p.type==='charge'||p.type==='delay').reduce((s,p)=>s+Number(p.amount),0);
  const expenses = state.expenses.reduce((s,e)=>s+Number(e.amount),0);
  const net = deposits + charges - expenses;
  return { deposits, charges, expenses, net };
}

function getThisMonthTotal() {
  const t = new Date();
  const m = t.getMonth(), y = t.getFullYear();
  const pays = state.payments.filter(p=>p.type==='deposit' && new Date(p.date).getMonth()===m && new Date(p.date).getFullYear()===y);
  return pays.reduce((s,p)=>s+Number(p.amount),0);
}

function getAvatar(name) {
  return (name||'?').split(' ').map(n=>n[0]).join('').substr(0,2).toUpperCase();
}

// ============================================================
//  HOME
// ============================================================
function renderHome() {
  const totals = getTotals();
  document.getElementById('h-total').textContent = C(totals.deposits);
  document.getElementById('h-rate').textContent = C(state.settings.monthlyRate);
  document.getElementById('h-month').textContent = C(getThisMonthTotal());
  document.getElementById('h-expense').textContent = C(totals.expenses);
  document.getElementById('h-balance').textContent = C(totals.net);

  // Months active
  const fd = new Date(state.settings.foundedDate+'-01');
  const today = new Date();
  const months = (today.getFullYear()-fd.getFullYear())*12+(today.getMonth()-fd.getMonth())+1;
  document.getElementById('h-months').textContent = months;

  // Core committee list
  const core = state.members.filter(m=>m.role==='core').slice(0,7);
  document.getElementById('core-list').innerHTML = core.map(m=>
    `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
      <div class="avatar" style="width:24px;height:24px;font-size:10px">${getAvatar(m.name)}</div>
      <div><div style="font-weight:600">${m.name}</div><div style="color:var(--muted);font-size:10px">${m.position||'Committee'}</div></div>
    </div>`
  ).join('');

  // Recent payments
  const recent = [...state.payments].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
  document.getElementById('recent-payments').innerHTML = recent.map(p=>{
    const fmtDate = p.date
  ? new Date(p.date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  : '—';
    return `<tr><td><div class="member-name"><div class="avatar">${getAvatar(p.memberName)}</div>${p.memberName}</div></td>
     <td class="mono">${C(Number(p.amount))}</td>
     <td>${MONTHS_SHORT[p.forMonth-1]||p.forMonth} ${p.forYear}</td>
     <td>${fmtDate}</td>
     <td style="color:var(--muted)">${p.note||'—'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">No payments yet</td></tr>';
}

// ============================================================
//  DASHBOARD
// ============================================================
// ============================================================
//  CHARTS
// ============================================================
let depositChartInstance = null;
let expensePieInstance = null;

function renderDepositChart() {
  const canvas = document.getElementById('deposit-chart');
  if (!canvas) return;
  const yr = parseInt(document.getElementById('chart-year-select').value);
  if (!yr) return;

  const labels = MONTHS_SHORT;
  const data = MONTHS.map((m, i) => {
    const mo = i + 1;
    return state.payments.filter(p => p.forYear === yr && p.forMonth === mo && p.type === 'deposit')
      .reduce((s, p) => s + Number(p.amount), 0);
  });

  if (depositChartInstance) { depositChartInstance.destroy(); depositChartInstance = null; }

  depositChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Deposits',
          data,
          backgroundColor: 'rgba(11,31,59,0.18)',
          borderColor: 'rgba(108,99,255,0.5)',
          borderWidth: 1.5,
          borderRadius: 6,
          order: 2
        },
        {
          type: 'line',
          label: 'Trend',
          data,
          borderColor: '#2F5D8C',
          backgroundColor: 'rgba(56,178,172,0.08)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: '#2F5D8C',
          tension: 0.35,
          fill: true,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ' ' + C(ctx.raw)
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#8892b0' } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 }, color: '#8892b0', callback: v => C(v) }, beginAtZero: true }
      }
    }
  });
}

function renderExpensePieChart() {
  const canvas = document.getElementById('expense-pie-chart');
  const empty = document.getElementById('pie-empty');
  if (!canvas) return;

  // Group by expense title
  const catMap = {};
  state.expenses.forEach(e => {
    const title = e.title || 'Untitled';
    catMap[title] = (catMap[title] || 0) + Number(e.amount);
  });
  const labels = Object.keys(catMap);
  const data = Object.values(catMap);

  if (expensePieInstance) { expensePieInstance.destroy(); expensePieInstance = null; }

  if (!labels.length) {
    canvas.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  canvas.style.display = '';
  if (empty) empty.style.display = 'none';

  const palette = [
  '#0B1F3B',
  '#E5E7EB',
  '#991B1B',
  '#3B82F6',
  '#10B981',
  '#FFFFFF',
  '#BFDBFE'
];

  expensePieInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: palette.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'right',
          labels: { font: { size: 11, family: 'Nunito' }, color: '#1a1f36', padding: 10, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ' ' + ctx.label + ': ' + C(ctx.raw)
          }
        }
      }
    }
  });
}

function renderDashboard() {
  const totals = getTotals();
  document.getElementById('d-total-deposit').textContent = C(totals.deposits);
  document.getElementById('d-total-charge').textContent = C(totals.charges);
  document.getElementById('d-total-expense').textContent = C(totals.expenses);
  document.getElementById('d-net-balance').textContent = C(totals.net);

  // Year select
  const years = [...new Set(state.payments.map(p=>p.forYear))].sort();
  if(!years.length) years.push(new Date().getFullYear());
  const ys = document.getElementById('year-select');
  ys.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join('');
  ys.value = years[years.length-1];

  // Month/year filter
  const mf = document.getElementById('month-filter-m');
  const yf = document.getElementById('year-filter-m');
  mf.innerHTML = MONTHS.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
  mf.value = new Date().getMonth();
  yf.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join('');
  yf.value = years[years.length-1];

  // Chart year select
  const cys = document.getElementById('chart-year-select');
  if(cys) {
    cys.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join('');
    cys.value = years[years.length-1];
  }

  renderYearlyTable();
  renderMonthly();
  renderGrowthTable();
  renderDepositChart();
  renderExpensePieChart();
}

function renderYearlyTable() {
  const yr = parseInt(document.getElementById('year-select').value);
  let html = '';
  let totalDeps=0, totalChgs=0, totalExps=0;
  MONTHS.forEach((m,i) => {
    const mo = i + 1;
    const deps = state.payments.filter(p=>p.forYear===yr&&p.forMonth===mo&&p.type==='deposit').reduce((s,p)=>s+Number(p.amount),0);
    const chgs = state.payments.filter(p=>p.forYear===yr&&p.forMonth===mo&&p.type==='charge').reduce((s,p)=>s+Number(p.amount),0);
    const exps = state.expenses.filter(e=>{const d=new Date(e.date);return d.getFullYear()===yr&&d.getMonth()+1===mo;}).reduce((s,e)=>s+Number(e.amount),0);
    const net = deps+chgs-exps;
    totalDeps+=deps; totalChgs+=chgs; totalExps+=exps;
    html += `<tr>
      <td>${m}</td>
      <td class="mono">${deps>0?C(deps):'—'}</td>
      <td class="mono" style="color:var(--gold)">${chgs>0?C(chgs):'—'}</td>
      <td class="mono" style="color:var(--red)">${exps>0?C(exps):'—'}</td>
      <td class="mono" style="color:${net>=0?'var(--green)':'var(--red)'}">${C(net)}</td>
    </tr>`;
  });
  const totalNet = totalDeps+totalChgs-totalExps;
  html += `<tr style="background:var(--bg3);font-weight:800;border-top:2px solid var(--border)">
    <td style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">Subtotal</td>
    <td class="mono" style="color:var(--accent-purple)">${C(totalDeps)}</td>
    <td class="mono" style="color:var(--gold)">${totalChgs>0?C(totalChgs):'—'}</td>
    <td class="mono" style="color:var(--red)">${totalExps>0?C(totalExps):'—'}</td>
    <td class="mono" style="color:${totalNet>=0?'var(--green)':'var(--red)'}">${C(totalNet)}</td>
  </tr>`;
  document.getElementById('yearly-table').innerHTML = html;
}

function renderMonthly() {
  const mo = parseInt(document.getElementById('month-filter-m').value)+1;
  const yr = parseInt(document.getElementById('year-filter-m').value);
  const monthPays = state.payments.filter(p=>p.forMonth===mo&&p.forYear===yr&&p.type==='deposit');
  const totalDep = monthPays.reduce((s,p)=>s+Number(p.amount),0);
  const paidCount = new Set(monthPays.map(p=>p.memberId)).size;
  const expected = state.members.filter(m=>m.active).length * state.settings.monthlyRate;
  const pct = expected > 0 ? Math.min(100, Math.round(totalDep/expected*100)) : 0;
  document.getElementById('monthly-details').innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
      <span style="color:var(--muted)">Collected</span><span class="mono">${C(totalDep)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
      <span style="color:var(--muted)">Expected</span><span class="mono">${C(expected)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:12px">
      <span style="color:var(--muted)">Paid Members</span><span>${paidCount} / ${state.members.length}</span>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div style="font-size:11px;color:var(--muted);margin-top:6px;text-align:right">${pct}% collected</div>
    <hr class="divider">
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Paid this month:</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${monthPays.map(p=>`<span class="tag tag-green" style="font-size:10px">${p.memberName.split(' ').slice(0,2).join(' ')}</span>`).join('') || '<span style="color:var(--muted);font-size:12px">None recorded</span>'}
    </div>
    <hr class="divider">
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Yet to pay:</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${(()=>{const paidIds=new Set(monthPays.map(p=>p.memberId));const unpaid=state.members.filter(m=>m.active&&!paidIds.has(m.id));return unpaid.map(m=>`<span class="tag tag-red" style="font-size:10px">${m.name.split(' ').slice(0,2).join(' ')}</span>`).join('')||'<span style="color:var(--muted);font-size:12px">Everyone has paid!</span>';})()}
    </div>`;
}

function renderGrowthTable() {
  document.getElementById('growth-table').innerHTML = state.members.map((m,i)=>{
    const t = getMemberTotals(m.id);
    const pct = t.totalMonths > 0 ? Math.min(100,Math.round(t.paidMonths/t.totalMonths*100)) : 0;
    return `<tr>
      <td><div class="member-name"><div class="avatar">${getAvatar(m.name)}</div><div><div style="font-weight:600;font-size:13px">${m.name}</div><div style="font-size:10px;color:var(--muted)">${m.role==='core'?m.position:'Member'}</div></div></div></td>
      <td class="mono">${C(t.totalPaid)}</td>
      <td><span class="tag tag-green">${t.paidMonths}</span></td>
      <td><span class="${t.unpaidMonths>0?'tag tag-red':'tag tag-teal'}">${t.unpaidMonths}</span></td>
      <td style="min-width:100px"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div style="font-size:10px;color:var(--muted);margin-top:3px">${pct}%</div></td>
    </tr>`;
  }).join('');
}

// ============================================================
//  PAYMENTS
// ============================================================
function renderPayments() {
  const search = (document.getElementById('pay-search')||{value:''}).value.toLowerCase();
  const mf = (document.getElementById('pay-month-filter')||{value:''}).value;
  const yf = (document.getElementById('pay-year-filter')||{value:''}).value;
  let pays = [...state.payments].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(search) pays = pays.filter(p=>p.memberName.toLowerCase().includes(search));
  if(mf) pays = pays.filter(p=>p.forMonth===parseInt(mf));
  if(yf) pays = pays.filter(p=>p.forYear===parseInt(yf));

  const totals = getTotals();
  document.getElementById('p-count').textContent = state.payments.length;
  document.getElementById('p-total').textContent = C(totals.deposits);
  document.getElementById('p-this-month').textContent = C(getThisMonthTotal());
  const paidIds = new Set(state.payments.filter(p=>{
    const t=new Date();return p.forMonth===t.getMonth()+1&&p.forYear===t.getFullYear()&&p.type==='deposit';
  }).map(p=>p.memberId));
  const pendingMembers = state.members.filter(m=>!paidIds.has(m.id));
  const pendingEl = document.getElementById('p-pending');
  if(pendingMembers.length === 0) {
    pendingEl.innerHTML = '<span style="color:var(--green);font-size:18px;font-weight:800;font-family:\'Space Mono\',monospace">0 ✓</span><div style="font-size:11px;color:var(--green);margin-top:2px">All paid!</div>';
  } else {
    pendingEl.innerHTML = `<span style="color:var(--red);font-size:28px;font-weight:800;font-family:'Space Mono',monospace">${pendingMembers.length}</span><div style="font-size:11px;color:var(--muted);margin-top:2px">of ${state.members.length} members</div>`;
  }

  // Filters
  const years = [...new Set(state.payments.map(p=>p.forYear))].sort();
  const ymf = document.getElementById('pay-month-filter');
  const yyf = document.getElementById('pay-year-filter');
  if(ymf.children.length<=1) {
    MONTHS.forEach((m,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=m;ymf.appendChild(o);});
    years.forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;yyf.appendChild(o);});
  }

  const actCol = document.getElementById('pay-actions-col');
  if(actCol) actCol.style.display = state.isAdmin ? '' : 'none';

  document.getElementById('payments-table').innerHTML = pays.map((p,i)=>{
    const typeLabels = {deposit:'Monthly Deposit',charge:'Service Charge',delay:'Delay Charge',extra:'Extra'};
    const typeColors = {deposit:'tag-teal',charge:'tag-gold',delay:'tag-red',extra:'tag-green'};
    const typeLabel = typeLabels[p.type] || p.type || 'Deposit';
    const typeColor = typeColors[p.type] || 'tag-teal';
    const fmtDate = p.date
  ? new Date(p.date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  : '—'; 
    return `<tr>
    <td style="color:var(--muted)">${i+1}</td>
    <td><div class="member-name"><div class="avatar">${getAvatar(p.memberName)}</div>${p.memberName}</div></td>
    <td class="mono">${C(Number(p.amount))}</td>
    <td><span class="tag ${typeColor}" style="white-space:nowrap">${typeLabel}</span></td>
    <td>${MONTHS_SHORT[(p.forMonth||1)-1]} ${p.forYear}</td>
    <td style="white-space:nowrap">${fmtDate}</td>
    <td style="color:var(--muted)">${p.note||'—'}</td>
    ${state.isAdmin?`<td><button class="btn btn-outline btn-sm" onclick="editPayment('${p.id}')">Edit</button> <button class="btn btn-danger btn-sm" onclick="deletePayment('${p.id}')">Del</button></td>`:''}
  </tr>`;
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">No payments found</td></tr>';
}

function openPaymentModal(editId) {
  const sel = document.getElementById('pay-member');
  sel.innerHTML = state.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  const yr = document.getElementById('pay-for-year');
  const today = new Date();
  yr.innerHTML = [today.getFullYear()-1,today.getFullYear(),today.getFullYear()+1].map(y=>`<option value="${y}">${y}</option>`).join('');
  yr.value = today.getFullYear();
  const mo = document.getElementById('pay-for-month');
  mo.innerHTML = MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
  mo.value = today.getMonth()+1;
  document.getElementById('pay-date').value = now();
  document.getElementById('pay-edit-id').value = '';
  document.getElementById('pay-amount').value = state.settings.monthlyRate;
  document.getElementById('pay-note').value = '';
  document.getElementById('payment-modal-title').textContent = 'Add Payment';
  if(editId) {
    const p = state.payments.find(x=>x.id===editId);
    if(p) {
      document.getElementById('pay-edit-id').value = p.id;
      document.getElementById('pay-member').value = p.memberId;
      document.getElementById('pay-amount').value = p.amount;
      document.getElementById('pay-type').value = p.type||'deposit';
      document.getElementById('pay-for-month').value = p.forMonth;
      document.getElementById('pay-for-year').value = p.forYear;
      document.getElementById('pay-date').value = p.date;
      document.getElementById('pay-note').value = p.note||'';
      document.getElementById('payment-modal-title').textContent = 'Edit Payment';
    }
  }
  document.getElementById('payment-modal').classList.add('open');
}

function editPayment(id) { requireAdmin(()=>openPaymentModal(id)); }

function savePayment() {
  const memberId = document.getElementById('pay-member').value;
  const member = state.members.find(m=>m.id===memberId);
  const amount = parseFloat(document.getElementById('pay-amount').value);
  if(!memberId||!amount) return alert('Fill required fields');
  const editId = document.getElementById('pay-edit-id').value;
  const entry = {
    id: editId || 'P'+uid(),
    memberId, memberName: member.name,
    amount, type: document.getElementById('pay-type').value,
    forMonth: parseInt(document.getElementById('pay-for-month').value),
    forYear: parseInt(document.getElementById('pay-for-year').value),
    date: document.getElementById('pay-date').value,
    note: document.getElementById('pay-note').value
  };
  if(editId) { const idx = state.payments.findIndex(p=>p.id===editId); state.payments[idx]=entry; }
  else state.payments.push(entry);
  saveState(); closeModal('payment-modal'); renderPayments();
  if(state.settings.syncMode==='auto') syncNow();
}

function deletePayment(id) {
  if(!confirm('Delete this payment?')) return;
  state.payments = state.payments.filter(p=>p.id!==id);
  saveState(); renderPayments();
  if(state.settings.syncMode==='auto') syncNow();
}

// ============================================================
//  EXPENSES
// ============================================================
function renderExpenses() {
  const search = (document.getElementById('exp-search')||{value:''}).value.toLowerCase();
  const catf = (document.getElementById('exp-cat-filter')||{value:''}).value;
  let exps = [...state.expenses].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(search) exps = exps.filter(e=>e.title.toLowerCase().includes(search)||e.note.toLowerCase().includes(search));
  if(catf) exps = exps.filter(e=>e.category===catf);

  const total = state.expenses.reduce((s,e)=>s+Number(e.amount),0);
  const t = new Date();
  const thisMonth = state.expenses.filter(e=>{const d=new Date(e.date);return d.getMonth()===t.getMonth()&&d.getFullYear()===t.getFullYear();}).reduce((s,e)=>s+Number(e.amount),0);
  document.getElementById('e-total').textContent = C(total);
  document.getElementById('e-this-month').textContent = C(thisMonth);
  const cats = [...new Set(state.expenses.map(e=>e.category))];
  document.getElementById('e-cats').textContent = cats.length;

  const catF = document.getElementById('exp-cat-filter');
  if(catF.children.length<=1) cats.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;catF.appendChild(o);});

  const actCol = document.getElementById('exp-actions-col');
  if(actCol) actCol.style.display = state.isAdmin ? '' : 'none';

  document.getElementById('expenses-table').innerHTML = exps.map((e,i)=>`<tr>
    <td style="color:var(--muted)">${i+1}</td>
    <td style="font-weight:600">${e.title}</td>
    <td><span class="chip" style="background:rgba(96,165,250,.1);color:var(--blue)">${e.category}</span></td>
    <td class="mono" style="color:var(--red)">${C(Number(e.amount))}</td>
    <td>${new Date(e.date).toLocaleDateString('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric' })} </td>
    <td>${e.by||'—'}</td>
    <td style="color:var(--muted)">${e.note||'—'}</td>
    ${state.isAdmin?`<td><button class="btn btn-outline btn-sm" onclick="editExpense('${e.id}')">Edit</button> <button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')">Del</button></td>`:''}
  </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">No expenses found</td></tr>';
}

function openExpenseModal(editId) {
  const byEl = document.getElementById('exp-by');
  byEl.innerHTML = state.members.filter(m=>m.role==='core').map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
  document.getElementById('exp-date').value = now();
  document.getElementById('exp-edit-id').value = '';
  document.getElementById('exp-title').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-note').value = '';
  document.getElementById('expense-modal-title').textContent = 'Add Expense';
  if(editId) {
    const e = state.expenses.find(x=>x.id===editId);
    if(e) {
      document.getElementById('exp-edit-id').value = e.id;
      document.getElementById('exp-title').value = e.title;
      document.getElementById('exp-category').value = e.category;
      document.getElementById('exp-amount').value = e.amount;
      document.getElementById('exp-date').value = e.date;
      document.getElementById('exp-by').value = e.by;
      document.getElementById('exp-note').value = e.note||'';
      document.getElementById('expense-modal-title').textContent = 'Edit Expense';
    }
  }
  document.getElementById('expense-modal').classList.add('open');
}

function editExpense(id) { requireAdmin(()=>openExpenseModal(id)); }

function saveExpense() {
  const title = document.getElementById('exp-title').value;
  const amount = parseFloat(document.getElementById('exp-amount').value);
  if(!title||!amount) return alert('Fill required fields');
  const editId = document.getElementById('exp-edit-id').value;
  const entry = {
    id: editId || 'E'+uid(),
    title, category: document.getElementById('exp-category').value,
    amount, date: document.getElementById('exp-date').value,
    by: document.getElementById('exp-by').value,
    note: document.getElementById('exp-note').value
  };
  if(editId) { const idx = state.expenses.findIndex(e=>e.id===editId); state.expenses[idx]=entry; }
  else state.expenses.push(entry);
  saveState(); closeModal('expense-modal'); renderExpenses();
  if(state.settings.syncMode==='auto') syncNow();
}

function deleteExpense(id) {
  if(!confirm('Delete this expense?')) return;
  state.expenses = state.expenses.filter(e=>e.id!==id);
  saveState(); renderExpenses();
}

// ============================================================
//  MEMBERS
// ============================================================
function renderMembers() {
  const search = (document.getElementById('mem-search')||{value:''}).value.toLowerCase();
  const rf = (document.getElementById('mem-role-filter')||{value:''}).value;
  let mems = [...state.members];
  if(search) mems = mems.filter(m=>m.name.toLowerCase().includes(search)||m.email.toLowerCase().includes(search));
  if(rf) mems = mems.filter(m=>m.role===rf);

  const active = state.members.filter(m=>m.active).length;
  const withDues = state.members.filter(m=>getMemberTotals(m.id).unpaidMonths>0).length;
  document.getElementById('m-active').textContent = active;
  document.getElementById('m-dues').textContent = withDues;

  const grid = document.getElementById('members-grid');
  if(!grid) return;

  if(!mems.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px">No members found</div>';
    return;
  }

  const coreMembers = mems.filter(m=>m.role==='core');
  const otherMembers = mems.filter(m=>m.role!=='core');

  function memberCard(m) {
    const t = getMemberTotals(m.id);
    const memberPays = state.payments.filter(p=>p.memberId===m.id && p.type==='deposit').sort((a,b)=>new Date(b.date)-new Date(a.date));
    const lastPay = memberPays[0];
    let lastDepLabel = 'No deposits yet';
if(lastPay && lastPay.date) {
  const d = new Date(lastPay.date);
  if(!isNaN(d)) {
    lastDepLabel = d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }
}
    const isCore = m.role === 'core';
    const initials = getAvatar(m.name);
    const roleLabel = isCore ? (m.position || 'Core Member') : 'General Member';
    const roleTagClass = isCore ? 'core-chip' : 'member-chip';
    const adminBtns = state.isAdmin ? `<div style="display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><button class="btn btn-outline btn-sm" style="flex:1" onclick="editMember('${m.id}')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteMember('${m.id}')">Del</button></div>` : '';
    return `<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);border-top:3px solid ${isCore?'var(--accent-purple)':'var(--blue)'};display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px">
      <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,${isCore?'var(--accent-purple),#123A63':'var(--blue),var(--teal)'});display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;box-shadow:0 4px 14px rgba(47,93,140,0.25);margin-bottom:4px">${initials}</div>
      <div style="font-weight:700;font-size:14px;color:var(--text)">${m.name}</div>
      <div style="font-size:11px;color:var(--muted)">${roleLabel}</div>
      <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px">📞 ${m.phone||'—'}</div>
      <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;word-break:break-all">✉️ ${m.email||'—'}</div>
      <div style="font-size:12px;font-weight:600;color:${isCore?'var(--accent-purple)':'var(--blue)'};font-family:'Space Mono',monospace;margin-top:2px">Last deposit: ${lastDepLabel}</div>
      <span class="chip ${roleTagClass}" style="margin-top:2px">${isCore?'⭐ Core Member':'Member'}</span>
      ${adminBtns}
    </div>`;
  }

  let html = '';
  if(coreMembers.length) {
    html += `<div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <div style="font-size:13px;font-weight:800;color:var(--accent-purple);text-transform:uppercase;letter-spacing:1px">⭐ Core Committee</div>
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <span class="chip core-chip">${coreMembers.length} members</span>
    </div>`;
    html += coreMembers.map(m => memberCard(m)).join('');
  }
  if(otherMembers.length) {
    html += `<div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;margin-top:${coreMembers.length?'12px':'0'};margin-bottom:4px">
      <div style="font-size:13px;font-weight:800;color:var(--blue);text-transform:uppercase;letter-spacing:1px">👥 General Members</div>
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <span class="chip member-chip">${otherMembers.length} members</span>
    </div>`;
    html += otherMembers.map(m => memberCard(m)).join('');
  }
  grid.innerHTML = html;
}

function openMemberModal(editId) {
  document.getElementById('mem-edit-id').value = '';
  document.getElementById('mem-name').value = '';
  document.getElementById('mem-email').value = '';
  document.getElementById('mem-phone').value = '';
  document.getElementById('mem-join').value = new Date().toISOString().substr(0,7);
  document.getElementById('mem-position').value = '';
  document.getElementById('mem-role').value = 'member';
  document.getElementById('member-modal-title').textContent = 'Add Member';
  if(editId) {
    const m = state.members.find(x=>x.id===editId);
    if(m) {
      document.getElementById('mem-edit-id').value = m.id;
      document.getElementById('mem-name').value = m.name;
      document.getElementById('mem-email').value = m.email;
      document.getElementById('mem-phone').value = m.phone||'';
      document.getElementById('mem-join').value = m.joinDate||'';
      document.getElementById('mem-position').value = m.position||'';
      document.getElementById('mem-role').value = m.role;
      document.getElementById('member-modal-title').textContent = 'Edit Member';
    }
  }
  document.getElementById('member-modal').classList.add('open');
}

function editMember(id) { requireAdmin(()=>openMemberModal(id)); }

function saveMember() {
  const name = document.getElementById('mem-name').value;
  const email = document.getElementById('mem-email').value;
  if(!name||!email) return alert('Name and email required');
  const editId = document.getElementById('mem-edit-id').value;
  const entry = {
    id: editId || 'M'+uid(),
    name, email,
    role: document.getElementById('mem-role').value,
    phone: document.getElementById('mem-phone').value,
    joinDate: document.getElementById('mem-join').value,
    position: document.getElementById('mem-position').value,
    active: true
  };
  if(editId) { const idx = state.members.findIndex(m=>m.id===editId); state.members[idx]=entry; }
  else state.members.push(entry);
  saveState(); closeModal('member-modal'); renderMembers();
  if(state.settings.syncMode==='auto') syncNow();
}

function deleteMember(id) {
  if(!confirm('Delete this member? This does NOT delete their payment records.')) return;
  state.members = state.members.filter(m=>m.id!==id);
  saveState(); renderMembers();
}

// ============================================================
//  SETTINGS
// ============================================================
function renderSettings() {
  document.getElementById('sheets-url').value = state.settings.sheetsUrl||'';
  document.getElementById('sync-mode').value = state.settings.syncMode||'manual';
  document.getElementById('fund-name').value = state.settings.fundName||'Future Fund Savings';
  document.getElementById('monthly-rate').value = state.settings.monthlyRate||500;
  document.getElementById('currency-sym').value = state.settings.currency||'৳';
  document.getElementById('founded-date').value = state.settings.foundedDate||'2024-01';
  document.getElementById('notice-expiry-days').value = state.settings.noticeDaysBeforeExpiry||30;
  // All inputs/buttons in settings are admin-only
  const settingsInputs = document.querySelectorAll('#page-settings input, #page-settings select, #page-settings textarea, #page-settings button');
  settingsInputs.forEach(el => { el.disabled = !state.isAdmin; });
}

function saveSettings() {
  state.settings.sheetsUrl = document.getElementById('sheets-url').value;
  state.settings.syncMode = document.getElementById('sync-mode').value;
  saveState();
  updateSyncStatus('Settings saved!', false);
}

function saveFundSettings() {
  state.settings.fundName = document.getElementById('fund-name').value;
  state.settings.monthlyRate = parseFloat(document.getElementById('monthly-rate').value)||500;
  state.settings.currency = document.getElementById('currency-sym').value||'৳';
  state.settings.foundedDate = document.getElementById('founded-date').value;
  state.settings.noticeDaysBeforeExpiry = parseInt(document.getElementById('notice-expiry-days').value)||30;
  saveState();
  alert('Fund settings saved!');
}

function changePassword() {
  const old = document.getElementById('old-pwd').value;
  const nw = document.getElementById('new-pwd').value;
  const conf = document.getElementById('confirm-pwd').value;
  const msg = document.getElementById('pwd-msg');
  if(old !== state.adminPassword) { msg.textContent='❌ Current password incorrect'; msg.style.color='var(--red)'; return; }
  if(nw !== conf) { msg.textContent='❌ Passwords do not match'; msg.style.color='var(--red)'; return; }
  if(nw.length < 6) { msg.textContent='❌ Min 6 characters'; msg.style.color='var(--red)'; return; }
  state.adminPassword = nw;
  saveState();
  msg.textContent='✅ Password updated!'; msg.style.color='var(--green)';
  document.getElementById('old-pwd').value='';
  document.getElementById('new-pwd').value='';
  document.getElementById('confirm-pwd').value='';
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'future-fund-backup-'+now()+'.json'; a.click();
}

function importJSON(e) {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const d = JSON.parse(ev.target.result);
      if(d.members && d.payments) {
        Object.assign(state, d);
        saveState();
        alert('✅ Data imported successfully!');
        renderPage(state.currentPage);
      } else alert('❌ Invalid backup file');
    } catch { alert('❌ Could not parse file'); }
  };
  reader.readAsText(file);
}

function clearData() {
  if(!confirm('Clear ALL local data? This cannot be undone!')) return;
  if(!confirm('Are you SURE? This deletes all members, payments, and expenses.')) return;
  localStorage.removeItem('ffs_state');
  location.reload();
}

// ============================================================
//  NOTICE AUTO-EXPIRY
// ============================================================
// Notices in the 'notice' section are automatically moved to 'previous'
// after noticeDaysBeforeExpiry days (default 30).
// Each section (notice / previous) is capped at 2 entries —
// the oldest is removed when a third would be added.

function autoExpireNotices() {
  if (!state.notices) state.notices = [];
  const days = Number(state.settings.noticeDaysBeforeExpiry) || 30;
  const now = new Date();
  let changed = false;

  state.notices.forEach(n => {
    if (n.section !== 'notice') return;
    const created = new Date(n.createdAt || n.date || now);
    const diffDays = (now - created) / (1000 * 60 * 60 * 24);
    if (diffDays >= days) {
      n.section = 'previous';
      changed = true;
    }
  });

  // Cap each section at 2 — trim oldest beyond cap
  ['notice', 'previous', 'payment'].forEach(sec => {
    const inSec = state.notices.filter(n => n.section === sec)
      .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    if (inSec.length > 2) {
      const toRemove = new Set(inSec.slice(2).map(n => n.id));
      state.notices = state.notices.filter(n => !toRemove.has(n.id));
      changed = true;
    }
  });

  if (changed) saveState();
}

// ============================================================
//  GOOGLE SHEETS SYNC
// ============================================================
function updateSyncStatus(msg, syncing) {
  document.getElementById('sync-dot').className = 'sync-dot' + (syncing?' syncing':'');
  document.getElementById('sync-label').textContent = syncing ? 'Syncing...' : (msg||'Local');
  if(document.getElementById('sync-msg')) {
    document.getElementById('sync-msg').textContent = msg||'';
  }
}

async function syncNow() {
  const url = getEffectiveSheetsUrl();
  if(!url) {
    updateSyncStatus('https://script.google.com/macros/s/AKfycby2nbZhNEDRXAI_bxqI2wsEEncqa0bcw65Tq3yveumL-MCkeuKoAOF19a2u8FOMOivd/exec');
    if(state.currentPage==='settings') document.getElementById('sync-msg').textContent = '⚠️ Set your Google Sheets URL first';
    return;
  }
  updateSyncStatus('Syncing...', true);
  try {
    const payload = { action:'sync', members:state.members, payments:state.payments, expenses:state.expenses, notices:state.notices };
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    // no-cors returns opaque response; treat as success
    updateSyncStatus('Synced ✅', false);
    if(state.currentPage==='settings') document.getElementById('sync-msg').textContent = '✅ Synced at '+new Date().toLocaleTimeString();
  } catch(e) {
    updateSyncStatus('Sync failed ❌', false);
    if(state.currentPage==='settings') document.getElementById('sync-msg').textContent = '❌ Sync failed: '+e.message;
  }
}

function adminLogin() {
  const pwd = document.getElementById('admin-login-pwd').value;
  const errEl = document.getElementById('admin-login-error');
  if (pwd === state.adminPassword) {
    errEl.style.display = 'none';
    state.isAdmin = true;
    state.loggedInMember = null;
    hideLoginScreen();
    updateSessionUI();
    navigate('home');
    // Always pull fresh data from Sheets on login
    fetchFromSheets().catch(() => {});
  } else {
    errEl.style.display = 'block';
    document.getElementById('admin-login-pwd').value = '';
  }
}

async function fetchFromSheets() {
  const url = getEffectiveSheetsUrl();
  const syncMsgEl = document.getElementById('sync-msg');
  if(!url) { if(syncMsgEl) syncMsgEl.textContent='⚠️ Set your Google Sheets URL first'; return; }
  updateSyncStatus('Pulling...', true);
  try {
    const res = await fetch(url+'?action=fetch');
    const d = await res.json();
    if(d.members) state.members = d.members;
    if(d.payments) state.payments = d.payments;
    if(d.expenses) state.expenses = d.expenses;
    if(d.notices) state.notices = d.notices;
    autoExpireNotices();
    saveState();
    updateSyncStatus('Pulled ✅', false);
    if(syncMsgEl) syncMsgEl.textContent = '✅ Data pulled from Sheets at '+new Date().toLocaleTimeString();
    renderPage(state.currentPage);
  } catch(e) {
    updateSyncStatus('Pull failed ❌', false);
    if(syncMsgEl) syncMsgEl.textContent = '❌ Pull failed: '+e.message;
  }
}

// ============================================================
//  LOGIN SCREEN
// ============================================================
function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
}

function hideLoginScreen() {
  document.getElementById('login-screen').style.display = 'none';
}

function switchLoginTab(tab) {
  document.getElementById('tab-member').classList.toggle('active', tab === 'member');
  document.getElementById('tab-admin').classList.toggle('active', tab === 'admin');
  document.getElementById('panel-member').classList.toggle('active', tab === 'member');
  document.getElementById('panel-admin').classList.toggle('active', tab === 'admin');
}

function populateMemberLoginSelect() {
  const sel = document.getElementById('member-login-select');
  if (!sel) return;
  const sorted = [...state.members].sort((a,b) => {
    if(a.role === 'core' && b.role !== 'core') return -1;
    if(a.role !== 'core' && b.role === 'core') return 1;
    return a.name.localeCompare(b.name);
  });
  sel.innerHTML = '<option value="">— Choose your name —</option>' +
    sorted.map(m => `<option value="${m.id}">[${m.role==='core'?'Core':'Member'}] ${m.name}</option>`).join('');
}

function memberLogin() {
  const sel = document.getElementById('member-login-select');
  const errEl = document.getElementById('member-login-error');
  const memberId = sel.value;
  if (!memberId) { errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  const member = state.members.find(m => m.id === memberId);
  if (!member) return;
  state.isAdmin = false;
  state.loggedInMember = { id: member.id, name: member.name, role: member.role };
  hideLoginScreen();
  updateSessionUI();
  navigate('home');
  // Always pull fresh data from Sheets on login so members see real-time data
  fetchFromSheets().catch(() => {});
}

// ================= AUTO SYNC =================
setInterval(() => {

  if(state.settings.syncMode === 'auto') {
    syncNow();
  }

}, 120000);

function updateSessionUI() {
  const indicator = document.getElementById('admin-indicator');
  const label = document.getElementById('admin-label');
  const banner = document.getElementById('view-only-banner');
  const main = document.getElementById('main');
  const roleBadge = document.getElementById('topbar-role-badge');
  const adminBtn = document.getElementById('admin-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const navSettings = document.getElementById('nav-settings');
  const navSectionAdmin = document.getElementById('nav-section-admin');

  if (state.isAdmin) {
    indicator.style.background = 'var(--gold)';
    label.textContent = '🔑 Admin';
    banner.style.display = 'none';
    main.classList.remove('with-banner');
    roleBadge.innerHTML = '<span class="role-badge role-admin">⚡ Admin</span>';
    roleBadge.style.display = '';
    adminBtn.style.display = 'none';
    logoutBtn.style.display = 'none';
    // Admin: show Settings nav
    navSettings.style.display = '';
    navSectionAdmin.style.display = '';
    const navMyDetailsA = document.getElementById('nav-my-details');
    if(navMyDetailsA) navMyDetailsA.style.display = 'none';
  } else if (state.loggedInMember) {
    const m = state.loggedInMember;
    const isCore = m.role === 'core';
    indicator.style.background = isCore ? 'var(--teal)' : 'var(--blue)';
    label.textContent = m.name + (isCore ? ' · Core' : ' · Member');
    banner.style.display = 'flex';
    document.getElementById('banner-name').textContent = m.name + (isCore ? ' (Core Committee)' : ' (General Member)');
    main.classList.add('with-banner');
    roleBadge.innerHTML = `<span class="role-badge ${isCore?'role-core':'role-member'}">${isCore?'⭐ Core':'👤 Member'}</span>`;
    roleBadge.style.display = '';
    adminBtn.style.display = 'none';
    logoutBtn.style.display = 'none';
    // Members: hide Settings nav completely
    navSettings.style.display = 'none';
    navSectionAdmin.style.display = 'none';
    const navMyDetails = document.getElementById('nav-my-details');
    if(navMyDetails) navMyDetails.style.display = '';
  } else {
    indicator.style.background = 'var(--green)';
    label.textContent = 'Not logged in';
    banner.style.display = 'none';
    main.classList.remove('with-banner');
    roleBadge.style.display = 'none';
    navSettings.style.display = 'none';
    navSectionAdmin.style.display = 'none';
    const navMyDetailsG = document.getElementById('nav-my-details');
    if(navMyDetailsG) navMyDetailsG.style.display = 'none';
  }

  // Persist session so page refresh doesn't log out
  saveSession();
  // Refresh notice board admin controls
  if(typeof renderNoticeBoard === 'function') renderNoticeBoard();
}

function logoutToLogin() {
  state.isAdmin = false;
  state.loggedInMember = null;
  sessionStorage.removeItem('ffs_session');
  updateSessionUI();
  populateMemberLoginSelect();
  document.getElementById('member-login-select').value = '';
  document.getElementById('admin-login-pwd').value = '';
  document.getElementById('member-login-error').style.display = 'none';
  document.getElementById('admin-login-error').style.display = 'none';
  switchLoginTab('member');
  showLoginScreen();
}


// ============================================================
//  MY DETAILS
// ============================================================
function renderMyDetails() {
  const container = document.getElementById('my-details-content');
  if (!state.loggedInMember) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--muted)">Please log in as a member to view your details.</div>';
    return;
  }
  const m = state.members.find(x => x.id === state.loggedInMember.id);
  if (!m) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--muted)">Member data not found.</div>';
    return;
  }
  const t = getMemberTotals(m.id);
  // Last deposit
  const myPays = state.payments.filter(p => p.memberId === m.id && p.type === 'deposit').sort((a,b) => new Date(b.date) - new Date(a.date));
  const lastPay = myPays[0];
  const lastDepositAmount = lastPay ? C(Number(lastPay.amount)) : '—';
  const lastDepositDate = lastPay && lastPay.date
  ? new Date(lastPay.date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  : '—';

  container.innerHTML = `
    <div style="max-width:560px;margin:0 auto">
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:20px;margin-bottom:24px">
          <div class="avatar" style="width:64px;height:64px;font-size:22px;font-weight:700;flex-shrink:0">${getAvatar(m.name)}</div>
          <div>
            <div style="font-family:'DM Serif Display',serif;font-size:22px;color:var(--gold)">${m.name}</div>
            <div style="margin-top:4px">${m.role === 'core' ? '<span class="core-chip chip">⭐ Core Committee</span>' : '<span class="member-chip chip">👤 Member</span>'}</div>
            ${m.position ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">${m.position}</div>` : ''}
          </div>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin-bottom:20px">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
            <span style="color:var(--muted);display:flex;align-items:center;gap:8px">📛 Full Name</span>
            <span style="font-weight:600">${m.name}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
            <span style="color:var(--muted);display:flex;align-items:center;gap:8px">📧 Gmail</span>
            <span class="mono" style="font-size:13px">${m.email || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
            <span style="color:var(--muted);display:flex;align-items:center;gap:8px">📞 Phone</span>
            <span class="mono" style="font-size:13px">${m.phone || '—'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
            <span style="color:var(--muted);display:flex;align-items:center;gap:8px">📅 Joined</span>
            <span>${m.joinDate || '—'}</span>
          </div>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        <div class="card" style="text-align:center">
          <div class="card-title">💵 Total Deposit</div>
          <div class="stat-val" style="color:var(--gold)">${C(t.totalPaid)}</div>
          <div class="stat-sub">All time contributions</div>
        </div>
        <div class="card" style="text-align:center">
          <div class="card-title">🔢 Payment Count</div>
          <div class="stat-val" style="color:var(--teal)">${t.paidMonths}</div>
          <div class="stat-sub">Months paid</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:16px">📊 Payment Summary</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
            <span style="color:var(--muted)">✅ Months Paid</span>
            <span class="tag tag-green">${t.paidMonths}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
            <span style="color:var(--muted)">❌ Months Unpaid</span>
            <span class="${t.unpaidMonths > 0 ? 'tag tag-red' : 'tag tag-teal'}">${t.unpaidMonths}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
            <span style="color:var(--muted)">💸 Last Deposit Amount</span>
            <span class="mono">${lastDepositAmount}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
            <span style="color:var(--muted)">📆 Last Deposit Date</span>
            <span class="mono">${lastDepositDate}</span>
          </div>
        </div>
        <div style="margin-top:16px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Payment Progress</div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${Math.min(100,Math.round(t.paidMonths/Math.max(1,t.totalMonths)*100))}%"></div>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${Math.min(100,Math.round(t.paidMonths/Math.max(1,t.totalMonths)*100))}% of expected payments made</div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
//  AUTH (mid-session admin elevation)
// ============================================================
let pendingAdminAction = null;

function requireAdmin(fn) {
  if(state.isAdmin) { fn(); return; }
  pendingAdminAction = fn;
  openAuth();
}

function openAuth() {
  document.getElementById('auth-overlay').classList.add('open');
  document.getElementById('auth-input').value = '';
  document.getElementById('auth-error').style.display = 'none';
  setTimeout(()=>document.getElementById('auth-input').focus(),100);
}

function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('open');
  pendingAdminAction = null;
}

function checkAuth() {
  const val = document.getElementById('auth-input').value;
  if(val === state.adminPassword) {
    state.isAdmin = true;
    state.loggedInMember = null;
    document.getElementById('auth-overlay').classList.remove('open');
    updateSessionUI();
    renderPage(state.currentPage);
    if(pendingAdminAction) { pendingAdminAction(); pendingAdminAction = null; }
  } else {
    document.getElementById('auth-error').style.display = 'block';
    document.getElementById('auth-input').value = '';
  }
}

function logout() {
  // kept for compatibility but redirects to login
  logoutToLogin();
}

// ============================================================
//  SIDEBAR MOBILE
// ============================================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay-bg').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay-bg').classList.remove('open');
}

// ============================================================
//  MODAL
// ============================================================
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if(e.target === o) o.classList.remove('open'); });
});

// ============================================================
//  INIT
// ============================================================
loadState();
