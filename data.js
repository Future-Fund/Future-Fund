// ============================================================
//  FIREBASE CONFIGURATION
// ============================================================
// Paste your Firebase Config keys below to bake them into the deployment.
// If left empty, the site will prompt you to enter them through the UI on first load.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCI3eYl7RqvSWbJHH4pkNyqlufBcTxMs5Y",
  authDomain: "future-fund-savings.firebaseapp.com",
  projectId: "future-fund-savings",
  storageBucket: "future-fund-savings.firebasestorage.app",
  messagingSenderId: "182032990038",
  appId: "1:182032990038:web:0d319b305045b0806d60f7"
};

let db = null;
let auth = null;
let firebaseUnsubscribes = [];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let state = {
  members: [],
  payments: [],
  expenses: [],
  notices: [],
  settings: {
    syncMode: 'auto',
    monthlyRate: 2000,
    currency: '৳',
    fundName: 'Future Fund Savings',
    foundedDate: '2026-05',
    noticeDaysBeforeExpiry: 15
  },
  isAdmin: false,
  loggedInMember: null, // { id, name, role } when a member is logged in
  currentPage: 'home'
};

function getFirebaseConfig() {
  // Try to load from localStorage first
  try {
    const local = localStorage.getItem('ffs_firebase_config');
    if (local) {
      const parsed = JSON.parse(local);
      if (parsed && parsed.apiKey) return parsed;
    }
  } catch(e) {}
  
  // Return the default if configured
  if (DEFAULT_FIREBASE_CONFIG.apiKey) {
    return DEFAULT_FIREBASE_CONFIG;
  }
  
  return null;
}

function initializeFirebase() {
  const config = getFirebaseConfig();
  if (!config) {
    showFirebaseSetupUI();
    return false;
  }
  
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
      firebase.firestore().enablePersistence().catch(err => {
        console.warn("Firestore offline persistence failed to enable:", err.code);
      });
    }
    db = firebase.firestore();
    auth = firebase.auth();
    return true;
  } catch(e) {
    console.error("Firebase init error:", e);
    alert("Failed to initialize Firebase. Please check your configuration: " + e.message);
    showFirebaseSetupUI();
    return false;
  }
}

function showFirebaseSetupUI() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-tabs-container').style.display = 'none';
  document.querySelectorAll('.login-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-firebase-setup').classList.add('active');
  
  const config = getFirebaseConfig() || DEFAULT_FIREBASE_CONFIG;
  document.getElementById('fb-api-key').value = config.apiKey || '';
  document.getElementById('fb-auth-domain').value = config.authDomain || '';
  document.getElementById('fb-project-id').value = config.projectId || '';
  document.getElementById('fb-storage-bucket').value = config.storageBucket || '';
  document.getElementById('fb-messaging-sender-id').value = config.messagingSenderId || '';
  document.getElementById('fb-app-id').value = config.appId || '';
}

function saveFirebaseConfigUI() {
  const config = {
    apiKey: document.getElementById('fb-api-key').value.trim(),
    authDomain: document.getElementById('fb-auth-domain').value.trim(),
    projectId: document.getElementById('fb-project-id').value.trim(),
    storageBucket: document.getElementById('fb-storage-bucket').value.trim(),
    messagingSenderId: document.getElementById('fb-messaging-sender-id').value.trim(),
    appId: document.getElementById('fb-app-id').value.trim()
  };
  
  if (!config.apiKey || !config.projectId) {
    alert("API Key and Project ID are required!");
    return;
  }
  
  localStorage.setItem('ffs_firebase_config', JSON.stringify(config));
  alert("Firebase configuration saved! Reloading...");
  location.reload();
}

function saveFirebaseConfigFromSettings() {
  const config = {
    apiKey: document.getElementById('settings-fb-api-key').value.trim(),
    authDomain: document.getElementById('settings-fb-auth-domain').value.trim(),
    projectId: document.getElementById('settings-fb-project-id').value.trim(),
    storageBucket: document.getElementById('settings-fb-storage-bucket').value.trim(),
    messagingSenderId: document.getElementById('settings-fb-messaging-sender-id').value.trim(),
    appId: document.getElementById('settings-fb-app-id').value.trim()
  };
  
  if (!config.apiKey || !config.projectId) {
    alert("API Key and Project ID are required!");
    return;
  }
  
  localStorage.setItem('ffs_firebase_config', JSON.stringify(config));
  alert("Firebase configuration saved in settings! Reloading page to apply...");
  location.reload();
}

function clearFirebaseConfig() {
  if (!confirm("Are you sure you want to clear your Firebase config? This will disconnect the app.")) return;
  localStorage.removeItem('ffs_firebase_config');
  alert("Config cleared! Reloading...");
  location.reload();
}

// ============================================================
//  STATE STORAGE & AUTO-SYNC HANDLERS
// ============================================================
function loadState() {
  if (!initializeFirebase()) return;
  
  // Set up Firebase Auth state observer
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      updateSyncStatus('Authenticating...', true);
      const email = user.email.toLowerCase();
      
      try {
        let memberDocRef = db.collection('members').doc(email);
        let doc = await memberDocRef.get();
        
        if (!doc.exists) {
          // Chicken-and-egg problem: if no members exist yet, automatically make the first user Admin
          const membersSnap = await db.collection('members').limit(1).get();
          if (membersSnap.empty) {
            const newAdmin = {
              id: 'M-ADMIN',
              uid: user.uid,
              name: user.displayName || 'Admin User',
              email: email,
              role: 'admin',
              position: 'Administrator',
              phone: '',
              joinDate: now().substring(0, 7),
              active: true
            };
            await memberDocRef.set(newAdmin);
            doc = await memberDocRef.get();
          } else {
            // Register them as a regular member automatically
            const newMember = {
              id: 'M-' + uid(),
              uid: user.uid,
              name: user.displayName || email.split('@')[0],
              email: email,
              role: 'member',
              position: 'General Member',
              phone: '',
              joinDate: now().substring(0, 7),
              active: true
            };
            await memberDocRef.set(newMember);
            doc = await memberDocRef.get();
          }
        }
        
        const memberData = doc.data();
        
        // Link auth UID if not set or mismatched
        if (memberData.uid !== user.uid) {
          await memberDocRef.update({ uid: user.uid });
          memberData.uid = user.uid;
        }
        
        state.loggedInMember = {
          id: memberData.id,
          name: memberData.name,
          role: memberData.role
        };
        
        state.isAdmin = (memberData.role === 'admin');
        
        hideLoginScreen();
        setupFirestoreSync();
        updateSessionUI();
        navigate(state.currentPage || 'home');
      } catch (err) {
        console.error("Error setting up session:", err);
        alert("Error loading user profile: " + err.message);
        auth.signOut();
      }
    } else {
      state.isAdmin = false;
      state.loggedInMember = null;
      unsubscribeFirestoreSync();
      updateSessionUI();
      showLoginScreen();
    }
  });
}

function setupFirestoreSync() {
  unsubscribeFirestoreSync();
  updateSyncStatus('Live Sync ✅', false);
  
  // Real-time listener for Settings Document
  const settingsUnsub = db.collection('settings').doc('config').onSnapshot((doc) => {
    if (doc.exists) {
      state.settings = { ...state.settings, ...doc.data() };
    } else {
      db.collection('settings').doc('config').set(state.settings);
    }
    renderPage(state.currentPage);
  }, (err) => {
    console.error("Settings sync error:", err);
  });
  firebaseUnsubscribes.push(settingsUnsub);
  
  // Real-time listener for Members Collection
  const membersUnsub = db.collection('members').onSnapshot((snap) => {
    state.members = [];
    snap.forEach((doc) => {
      state.members.push(doc.data());
    });
    populateMemberLoginSelect();
    renderPage(state.currentPage);
  }, (err) => {
    console.error("Members sync error:", err);
  });
  firebaseUnsubscribes.push(membersUnsub);
  
  // Real-time listener for Payments Collection
  const paymentsUnsub = db.collection('payments').onSnapshot((snap) => {
    state.payments = [];
    snap.forEach((doc) => {
      state.payments.push(doc.data());
    });
    renderPage(state.currentPage);
  }, (err) => {
    console.error("Payments sync error:", err);
  });
  firebaseUnsubscribes.push(paymentsUnsub);
  
  // Real-time listener for Expenses Collection
  const expensesUnsub = db.collection('expenses').onSnapshot((snap) => {
    state.expenses = [];
    snap.forEach((doc) => {
      state.expenses.push(doc.data());
    });
    renderPage(state.currentPage);
  }, (err) => {
    console.error("Expenses sync error:", err);
  });
  firebaseUnsubscribes.push(expensesUnsub);
  
  // Real-time listener for Notices Collection
  const noticesUnsub = db.collection('notices').onSnapshot((snap) => {
    state.notices = [];
    snap.forEach((doc) => {
      state.notices.push(doc.data());
    });
    autoExpireNotices();
    renderPage(state.currentPage);
  }, (err) => {
    console.error("Notices sync error:", err);
  });
  firebaseUnsubscribes.push(noticesUnsub);
}

function unsubscribeFirestoreSync() {
  firebaseUnsubscribes.forEach(unsub => {
    try { unsub(); } catch(e) {}
  });
  firebaseUnsubscribes = [];
}

function updateSyncStatus(msg, syncing) {
  const syncDot = document.getElementById('sync-dot');
  const syncLabel = document.getElementById('sync-label');
  const syncMsg = document.getElementById('sync-msg');
  
  if (syncDot) syncDot.className = 'sync-dot' + (syncing ? ' syncing' : '');
  if (syncLabel) syncLabel.textContent = msg || 'Local';
  if (syncMsg) syncMsg.textContent = msg || '';
}

// ============================================================
//  NAV
// ============================================================
function navigate(page) {
  if (page === 'settings' && !state.isAdmin) {
    page = 'home';
  }
  state.currentPage = page;
  
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
//  HOME PAGE RENDER
// ============================================================
function renderHome() {
  const totals = getTotals();
  document.getElementById('h-total').textContent = C(totals.deposits);
  document.getElementById('h-rate').textContent = C(state.settings.monthlyRate);
  document.getElementById('h-month').textContent = C(getThisMonthTotal());
  document.getElementById('h-expense').textContent = C(totals.expenses);
  document.getElementById('h-balance').textContent = C(totals.net);

  const fd = new Date(state.settings.foundedDate+'-01');
  const today = new Date();
  const months = (today.getFullYear()-fd.getFullYear())*12+(today.getMonth()-fd.getMonth())+1;
  document.getElementById('h-months').textContent = months;
  document.getElementById('h-members').textContent = state.members.length;

  const core = state.members.filter(m=>m.role==='core').slice(0,7);
  document.getElementById('core-list').innerHTML = core.map(m=>
    `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
      <div class="avatar" style="width:24px;height:24px;font-size:10px">${getAvatar(m.name)}</div>
      <div><div style="font-weight:600">${m.name}</div><div style="color:var(--muted);font-size:10px">${m.position||'Committee'}</div></div>
    </div>`
  ).join('');

  const recent = [...state.payments].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
  document.getElementById('recent-payments').innerHTML = recent.map(p=>{
    const fmtDate = p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    return `<tr><td><div class="member-name"><div class="avatar">${getAvatar(p.memberName)}</div>${p.memberName}</div></td>
     <td class="mono">${C(Number(p.amount))}</td>
     <td>${MONTHS_SHORT[p.forMonth-1]||p.forMonth} ${p.forYear}</td>
     <td>${fmtDate}</td>
     <td style="color:var(--muted)">${p.note||'—'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">No payments yet</td></tr>';
}

// ============================================================
//  DASHBOARD PAGE RENDER
// ============================================================
let depositChartInstance = null;
let expensePieInstance = null;

function renderDepositChart() {
  const canvas = document.getElementById('deposit-chart');
  if (!canvas) return;
  const yrSelect = document.getElementById('chart-year-select');
  if (!yrSelect || !yrSelect.value) return;
  const yr = parseInt(yrSelect.value);

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
        tooltip: { callbacks: { label: ctx => ' ' + C(ctx.raw) } }
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

  const palette = ['#0B1F3B', '#E5E7EB', '#991B1B', '#3B82F6', '#10B981', '#FFFFFF', '#BFDBFE'];

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
        tooltip: { callbacks: { label: ctx => ' ' + ctx.label + ': ' + C(ctx.raw) } }
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

  const years = [...new Set(state.payments.map(p=>p.forYear))].sort();
  if(!years.length) years.push(new Date().getFullYear());
  
  const ys = document.getElementById('year-select');
  ys.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join('');
  ys.value = years[years.length-1];

  const mf = document.getElementById('month-filter-m');
  const yf = document.getElementById('year-filter-m');
  mf.innerHTML = MONTHS.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
  mf.value = new Date().getMonth();
  yf.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join('');
  yf.value = years[years.length-1];

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
      ${(()=> {
        const paidIds = new Set(monthPays.map(p=>p.memberId));
        const unpaid = state.members.filter(m=>m.active&&!paidIds.has(m.id));
        return unpaid.map(m=>`<span class="tag tag-red" style="font-size:10px">${m.name.split(' ').slice(0,2).join(' ')}</span>`).join('')||'<span style="color:var(--muted);font-size:12px">Everyone has paid!</span>';
      })()}
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
//  PAYMENTS ACTIONS
// ============================================================
function renderPayments() {
  const search = (document.getElementById('pay-search')||{value:''}).value.toLowerCase();
  const mf = (document.getElementById('pay-month-filter')||{value:''}).value;
  const yf = (document.getElementById('pay-year-filter')||{value:''}).value;
  let pays = [...state.payments].sort((a,b)=>new Date(b.date)-new Date(a.date));
  
  if(search) pays = pays.filter(p=>p.memberName.toLowerCase().includes(search));
  if(null !== mf && "" !== mf) pays = pays.filter(p=>p.forMonth===parseInt(mf));
  if(null !== yf && "" !== yf) pays = pays.filter(p=>p.forYear===parseInt(yf));

  const totals = getTotals();
  document.getElementById('p-count').textContent = state.payments.length;
  document.getElementById('p-total').textContent = C(totals.deposits);
  document.getElementById('p-this-month').textContent = C(getThisMonthTotal());
  
  const paidIds = new Set(state.payments.filter(p=>{
    const t=new Date(); return p.forMonth===t.getMonth()+1&&p.forYear===t.getFullYear()&&p.type==='deposit';
  }).map(p=>p.memberId));
  const pendingMembers = state.members.filter(m=>!paidIds.has(m.id));
  const pendingEl = document.getElementById('p-pending');
  
  if(pendingMembers.length === 0) {
    pendingEl.innerHTML = '<span style="color:var(--green);font-size:18px;font-weight:800;font-family:\'Space Mono\',monospace">0 ✓</span><div style="font-size:11px;color:var(--green);margin-top:2px">All paid!</div>';
  } else {
    pendingEl.innerHTML = `<span style="color:var(--red);font-size:28px;font-weight:800;font-family:'Space Mono',monospace">${pendingMembers.length}</span><div style="font-size:11px;color:var(--muted);margin-top:2px">of ${state.members.length} members</div>`;
  }

  const years = [...new Set(state.payments.map(p=>p.forYear))].sort();
  const ymf = document.getElementById('pay-month-filter');
  const yyf = document.getElementById('pay-year-filter');
  if(ymf && ymf.children.length<=1) {
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
    const fmtDate = p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; 
    
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

async function savePayment() {
  const memberId = document.getElementById('pay-member').value;
  const member = state.members.find(m=>m.id===memberId);
  const amount = parseFloat(document.getElementById('pay-amount').value);
  if(!memberId||!amount) return alert('Fill required fields');
  const editId = document.getElementById('pay-edit-id').value;
  
  const id = editId || 'P'+uid();
  const entry = {
    id,
    memberId, memberName: member.name,
    amount, type: document.getElementById('pay-type').value,
    forMonth: parseInt(document.getElementById('pay-for-month').value),
    forYear: parseInt(document.getElementById('pay-for-year').value),
    date: document.getElementById('pay-date').value,
    note: document.getElementById('pay-note').value
  };
  
  try {
    await db.collection('payments').doc(id).set(entry);
    closeModal('payment-modal');
  } catch (err) {
    alert("Error saving payment: " + err.message);
  }
}

async function deletePayment(id) {
  if(!confirm('Delete this payment?')) return;
  try {
    await db.collection('payments').doc(id).delete();
  } catch (err) {
    alert("Error deleting payment: " + err.message);
  }
}

// ============================================================
//  EXPENSES ACTIONS
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
  if(catF && catF.children.length<=1) cats.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;catF.appendChild(o);});

  const actCol = document.getElementById('exp-actions-col');
  if(actCol) actCol.style.display = state.isAdmin ? '' : 'none';

  document.getElementById('expenses-table').innerHTML = exps.map((e,i)=>`<tr>
    <td style="color:var(--muted)">${i+1}</td>
    <td style="font-weight:600">${e.title}</td>
    <td><span class="chip" style="background:rgba(96,165,250,.1);color:var(--blue)">${e.category}</span></td>
    <td class="mono" style="color:var(--red)">${C(Number(e.amount))}</td>
    <td>${new Date(e.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} </td>
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

async function saveExpense() {
  const title = document.getElementById('exp-title').value;
  const amount = parseFloat(document.getElementById('exp-amount').value);
  if(!title||!amount) return alert('Fill required fields');
  const editId = document.getElementById('exp-edit-id').value;
  
  const id = editId || 'E'+uid();
  const entry = {
    id,
    title, category: document.getElementById('exp-category').value,
    amount, date: document.getElementById('exp-date').value,
    by: document.getElementById('exp-by').value,
    note: document.getElementById('exp-note').value
  };
  
  try {
    await db.collection('expenses').doc(id).set(entry);
    closeModal('expense-modal');
  } catch (err) {
    alert("Error saving expense: " + err.message);
  }
}

async function deleteExpense(id) {
  if(!confirm('Delete this expense?')) return;
  try {
    await db.collection('expenses').doc(id).delete();
  } catch (err) {
    alert("Error deleting expense: " + err.message);
  }
}

// ============================================================
//  MEMBERS ACTIONS
// ============================================================
function renderMembers() {
  const search = (document.getElementById('mem-search')||{value:''}).value.toLowerCase();
  const rf = (document.getElementById('mem-role-filter')||{value:''}).value;
  let mems = [...state.members];
  
  if(search) mems = mems.filter(m=>m.name.toLowerCase().includes(search)||m.email.toLowerCase().includes(search));
  if(rf) mems = mems.filter(m=>m.role===rf);

  const active = state.members.filter(m=>m.active).length;
  const withDues = state.members.filter(m=>getMemberTotals(m.id).unpaidMonths>0).length;
  
  const mActiveEl = document.getElementById('m-active');
  const mDuesEl = document.getElementById('m-dues');
  if (mActiveEl) mActiveEl.textContent = active;
  if (mDuesEl) mDuesEl.textContent = withDues;

  const grid = document.getElementById('members-grid');
  if(!grid) return;

  if(!mems.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px">No members found</div>';
    return;
  }

  const coreMembers = mems.filter(m=>m.role==='core');
  const otherMembers = mems.filter(m=>m.role!=='core' && m.role!=='admin');

  function memberCard(m) {
    const memberPays = state.payments.filter(p=>p.memberId===m.id && p.type==='deposit').sort((a,b)=>new Date(b.date)-new Date(a.date));
    const lastPay = memberPays[0];
    let lastDepLabel = 'No deposits yet';
    if(lastPay && lastPay.date) {
      const d = new Date(lastPay.date);
      if(!isNaN(d)) {
        lastDepLabel = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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

async function saveMember() {
  const name = document.getElementById('mem-name').value;
  const email = document.getElementById('mem-email').value.trim().toLowerCase();
  if(!name||!email) return alert('Name and email required');
  const editId = document.getElementById('mem-edit-id').value;
  
  const id = editId || 'M'+uid();
  const entry = {
    id,
    name, email,
    role: document.getElementById('mem-role').value,
    phone: document.getElementById('mem-phone').value,
    joinDate: document.getElementById('mem-join').value,
    position: document.getElementById('mem-position').value,
    active: true
  };
  
  try {
    await db.collection('members').doc(email).set(entry);
    closeModal('member-modal');
  } catch (err) {
    alert("Error saving member: " + err.message);
  }
}

async function deleteMember(id) {
  if(!confirm('Delete this member? This does NOT delete their payment records.')) return;
  const member = state.members.find(m => m.id === id);
  if (!member) return;
  
  try {
    await db.collection('members').doc(member.email.toLowerCase()).delete();
  } catch (err) {
    alert("Error deleting member: " + err.message);
  }
}

// ============================================================
//  MY DETAILS ACTIONS
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
  
  const myPays = state.payments.filter(p => p.memberId === m.id && p.type === 'deposit').sort((a,b) => new Date(b.date) - new Date(a.date));
  const lastPay = myPays[0];
  const lastDepositAmount = lastPay ? C(Number(lastPay.amount)) : '—';
  const lastDepositDate = lastPay && lastPay.date ? new Date(lastPay.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

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
//  NOTICE AUTO-EXPIRY & RENDER
// ============================================================
async function autoExpireNotices() {
  if (!state.notices) return;
  const days = Number(state.settings.noticeDaysBeforeExpiry) || 30;
  const now = new Date();
  
  for (const n of state.notices) {
    if (n.section !== 'notice') continue;
    const created = new Date(n.createdAt || n.date || now);
    const diffDays = (now - created) / (1000 * 60 * 60 * 24);
    if (diffDays >= days) {
      try {
        await db.collection('notices').doc(n.id).update({ section: 'previous' });
      } catch(e) {}
    }
  }
  
  const sections = ['notice', 'previous', 'payment'];
  for (const sec of sections) {
    const inSec = state.notices.filter(n => n.section === sec)
      .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    if (inSec.length > 2) {
      const toRemove = inSec.slice(2);
      for (const rm of toRemove) {
        try {
          await db.collection('notices').doc(rm.id).delete();
        } catch(e) {}
      }
    }
  }
}

async function saveNotice() {
  const title = document.getElementById('notice-title').value.trim();
  const message = document.getElementById('notice-message').value.trim();
  const section = document.getElementById('notice-section').value;
  const date = document.getElementById('notice-date').value;
  const by = document.getElementById('notice-by').value.trim() || 'Admin';
  if (!title) { alert('Title is required.'); return; }
  if (!message) { alert('Message is required.'); return; }

  const editId = document.getElementById('notice-edit-id').value;
  const id = editId || 'n' + Date.now();

  let entry;
  if (editId) {
    const existing = state.notices.find(x => x.id === editId);
    entry = {
      ...existing,
      title, message, section, date, by
    };
  } else {
    const inSec = state.notices.filter(n => n.section === section)
      .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    if (inSec.length >= 2) {
      const oldestId = inSec[inSec.length - 1].id;
      try {
        await db.collection('notices').doc(oldestId).delete();
      } catch(e) {}
    }
    
    const days = Number(state.settings.noticeDaysBeforeExpiry) || 30;
    const createdAt = new Date().toISOString();
    const expiresAt = section === 'notice'
      ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
      : '';
    entry = { id, title, message, section, date, by, createdAt, expiresAt };
  }

  try {
    await db.collection('notices').doc(id).set(entry);
    closeModal('notice-modal');
    window.location.hash = '#notice-board';
    navigate('notice-board');
  } catch (err) {
    alert("Error saving notice: " + err.message);
  }
}

async function deleteNotice(id) {
  if (!confirm('Delete this notice?')) return;
  try {
    await db.collection('notices').doc(id).delete();
    window.location.hash = '#notice-board';
    navigate('notice-board');
  } catch (err) {
    alert("Error deleting notice: " + err.message);
  }
}

// ============================================================
//  SETTINGS CARD ACTIONS
// ============================================================
function renderSettings() {
  const config = getFirebaseConfig() || DEFAULT_FIREBASE_CONFIG;
  document.getElementById('settings-fb-api-key').value = config.apiKey || '';
  document.getElementById('settings-fb-auth-domain').value = config.authDomain || '';
  document.getElementById('settings-fb-project-id').value = config.projectId || '';
  document.getElementById('settings-fb-storage-bucket').value = config.storageBucket || '';
  document.getElementById('settings-fb-messaging-sender-id').value = config.messagingSenderId || '';
  document.getElementById('settings-fb-app-id').value = config.appId || '';

  document.getElementById('fund-name').value = state.settings.fundName||'Future Fund';
  document.getElementById('monthly-rate').value = state.settings.monthlyRate||2000;
  document.getElementById('currency-sym').value = state.settings.currency||'৳';
  document.getElementById('founded-date').value = state.settings.foundedDate||'2026-05';
  document.getElementById('notice-expiry-days').value = state.settings.noticeDaysBeforeExpiry||15;
  
  const settingsInputs = document.querySelectorAll('#page-settings input, #page-settings select, #page-settings textarea, #page-settings button');
  settingsInputs.forEach(el => { el.disabled = !state.isAdmin; });
}

async function saveFundSettings() {
  const configDoc = {
    fundName: document.getElementById('fund-name').value,
    monthlyRate: parseFloat(document.getElementById('monthly-rate').value)||2000,
    currency: document.getElementById('currency-sym').value||'৳',
    foundedDate: document.getElementById('founded-date').value,
    noticeDaysBeforeExpiry: parseInt(document.getElementById('notice-expiry-days').value)||15
  };
  
  try {
    await db.collection('settings').doc('config').set(configDoc);
    alert('Fund settings saved!');
  } catch (err) {
    alert("Error saving fund settings: " + err.message);
  }
}

async function changePassword() {
  const old = document.getElementById('old-pwd').value;
  const nw = document.getElementById('new-pwd').value;
  const conf = document.getElementById('confirm-pwd').value;
  const msg = document.getElementById('pwd-msg');
  
  if(!nw || !conf) { msg.textContent='❌ Enter new password'; msg.style.color='var(--red)'; return; }
  if(nw !== conf) { msg.textContent='❌ Passwords do not match'; msg.style.color='var(--red)'; return; }
  if(nw.length < 6) { msg.textContent='❌ Min 6 characters'; msg.style.color='var(--red)'; return; }
  
  const user = auth.currentUser;
  if (!user) { msg.textContent='❌ Not authenticated'; msg.style.color='var(--red)'; return; }
  
  msg.textContent='Updating password...';
  msg.style.color='var(--muted)';
  
  try {
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, old);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(nw);
    
    msg.textContent='✅ Password updated!'; msg.style.color='var(--green)';
    document.getElementById('old-pwd').value='';
    document.getElementById('new-pwd').value='';
    document.getElementById('confirm-pwd').value='';
  } catch(err) {
    msg.textContent='❌ Error: ' + err.message;
    msg.style.color='var(--red)';
  }
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'future-fund-firebase-backup-'+now()+'.json'; a.click();
}

async function importJSON(e) {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const d = JSON.parse(ev.target.result);
      if(d.members && d.payments) {
        if(!confirm("This will overwrite existing database collections. Proceed?")) return;
        
        updateSyncStatus('Importing...', true);
        
        // Import members
        for (const m of d.members) {
          await db.collection('members').doc(m.email.toLowerCase()).set(m);
        }
        
        // Import payments
        for (const p of d.payments) {
          await db.collection('payments').doc(p.id).set(p);
        }
        
        // Import expenses
        if (d.expenses) {
          for (const ex of d.expenses) {
            await db.collection('expenses').doc(ex.id).set(ex);
          }
        }
        
        // Import notices
        if (d.notices) {
          for (const n of d.notices) {
            await db.collection('notices').doc(n.id).set(n);
          }
        }
        
        // Import settings
        if (d.settings) {
          await db.collection('settings').doc('config').set(d.settings);
        }
        
        alert('✅ Data imported successfully!');
        location.reload();
      } else alert('❌ Invalid backup file');
    } catch(err) { alert('❌ Could not parse/import file: ' + err.message); }
  };
  reader.readAsText(file);
}

async function clearData() {
  if(!confirm('Clear ALL database data? This cannot be undone!')) return;
  if(!confirm('Are you SURE? This deletes all members, payments, notices, and expenses from Firebase Firestore.')) return;
  
  try {
    const paymentsSnap = await db.collection('payments').get();
    for (const doc of paymentsSnap.docs) await doc.ref.delete();
    
    const expensesSnap = await db.collection('expenses').get();
    for (const doc of expensesSnap.docs) await doc.ref.delete();
    
    const noticesSnap = await db.collection('notices').get();
    for (const doc of noticesSnap.docs) await doc.ref.delete();
    
    await db.collection('settings').doc('config').delete();
    
    alert('✅ Database cleared successfully!');
    location.reload();
  } catch (err) {
    alert("Error clearing data: " + err.message);
  }
}

// ============================================================
//  AUTHENTICATION ACTIONS
// ============================================================
function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-tabs-container').style.display = 'flex';
}

// Kept for backward compatibility
function populateMemberLoginSelect() {}

function hideLoginScreen() {
  document.getElementById('login-screen').style.display = 'none';
}

function switchLoginTab(tab) {
  document.getElementById('tab-member').classList.toggle('active', tab === 'member');
  document.getElementById('tab-admin').classList.toggle('active', tab === 'admin');
  document.getElementById('panel-member').classList.toggle('active', tab === 'member');
  document.getElementById('panel-admin').classList.toggle('active', tab === 'admin');
  
  const panelReg = document.getElementById('panel-register');
  if (panelReg) {
    panelReg.classList.toggle('active', tab === 'register');
    if (tab === 'register') {
      document.getElementById('tab-member').classList.remove('active');
      document.getElementById('tab-admin').classList.remove('active');
    }
  }
}

async function memberLogin() {
  const email = document.getElementById('member-login-email').value.trim();
  const pwd = document.getElementById('member-login-pwd').value;
  const errEl = document.getElementById('member-login-error');
  
  if (!email || !pwd) {
    errEl.style.display = 'block';
    errEl.textContent = 'Please fill in all fields.';
    return;
  }
  
  errEl.style.display = 'none';
  try {
    await auth.signInWithEmailAndPassword(email, pwd);
  } catch (err) {
    errEl.style.display = 'block';
    errEl.textContent = err.message;
  }
}

async function adminLogin() {
  const email = document.getElementById('admin-login-email').value.trim();
  const pwd = document.getElementById('admin-login-pwd').value;
  const errEl = document.getElementById('admin-login-error');
  
  if (!email || !pwd) {
    errEl.style.display = 'block';
    errEl.textContent = 'Please fill in all fields.';
    return;
  }
  
  errEl.style.display = 'none';
  try {
    await auth.signInWithEmailAndPassword(email, pwd);
  } catch (err) {
    errEl.style.display = 'block';
    errEl.textContent = err.message;
  }
}

async function registerUser() {
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim().toLowerCase();
  const pwd = document.getElementById('register-pwd').value;
  const phone = document.getElementById('register-phone').value.trim();
  const errEl = document.getElementById('register-error');
  
  if (!name || !email || !pwd) {
    errEl.style.display = 'block';
    errEl.textContent = 'Name, Email, and Password are required.';
    return;
  }
  
  if (pwd.length < 6) {
    errEl.style.display = 'block';
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  
  errEl.style.display = 'none';
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pwd);
    await cred.user.updateProfile({ displayName: name });
    
    const memberDocRef = db.collection('members').doc(email);
    const doc = await memberDocRef.get();
    
    if (doc.exists) {
      const existingData = doc.data();
      await memberDocRef.update({
        uid: cred.user.uid,
        name: name,
        phone: phone || existingData.phone || '',
        active: true
      });
    } else {
      const membersSnap = await db.collection('members').limit(1).get();
      const role = membersSnap.empty ? 'admin' : 'member';
      
      const newMember = {
        id: 'M-' + uid(),
        uid: cred.user.uid,
        name,
        email,
        role,
        position: role === 'admin' ? 'Administrator' : 'General Member',
        phone: phone,
        joinDate: now().substring(0,7),
        active: true
      };
      await memberDocRef.set(newMember);
    }
  } catch (err) {
    errEl.style.display = 'block';
    errEl.textContent = err.message;
  }
}

function logout() {
  auth.signOut();
}

function logoutToLogin() {
  auth.signOut();
}

// ============================================================
//  MID-SESSION ELEVATION (RE-AUTH)
// ============================================================
let pendingAdminAction = null;

function requireAdmin(fn) {
  if (state.isAdmin) { fn(); return; }
  pendingAdminAction = fn;
  openAuth();
}

function openAuth() {
  document.getElementById('auth-overlay').classList.add('open');
  document.getElementById('auth-input').value = '';
  document.getElementById('auth-error').style.display = 'none';
  setTimeout(()=>document.getElementById('auth-input').focus(), 100);
}

function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('open');
  pendingAdminAction = null;
}

async function checkAuth() {
  const val = document.getElementById('auth-input').value;
  const user = auth.currentUser;
  if (!user) { alert("Please log in first."); return; }
  
  document.getElementById('auth-error').style.display = 'none';
  
  try {
    const adminMember = state.members.find(m => m.role === 'admin');
    const adminEmail = adminMember ? adminMember.email : 'admin@futurefund.com';
    
    await auth.signInWithEmailAndPassword(adminEmail, val);
    document.getElementById('auth-overlay').classList.remove('open');
    if (pendingAdminAction) { pendingAdminAction(); pendingAdminAction = null; }
  } catch (err) {
    document.getElementById('auth-error').style.display = 'block';
    document.getElementById('auth-input').value = '';
  }
}

// ============================================================
//  UI DETAILS & SESSION
// ============================================================
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

  if(typeof renderNoticeBoard === 'function') renderNoticeBoard();
}

// ============================================================
//  SIDEBAR MOBILE & MODAL
// ============================================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay-bg').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay-bg').classList.remove('open');
}
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
