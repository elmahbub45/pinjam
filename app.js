import { PinjamApi } from './api.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getMessaging, isSupported as messagingSupported, onMessage, onRegistered, register as registerMessaging } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging.js';

const cfg = window.PINJAM_CONFIG || {};
const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n||0));
const dateFmt = (s, opt={day:'numeric',month:'short',year:'numeric'}) => s ? new Intl.DateTimeFormat('id-ID',opt).format(new Date(`${s}T00:00:00+08:00`)) : '-';
const esc = s => String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
const monthKey = s => String(s||'').slice(0,7);

const state = { user:null, data:null, view:'home', filter:{month:'',provider:'ALL',status:'ALL'}, online:navigator.onLine };
let firebaseApp, auth, messaging, api;

function toast(msg){ const t=qs('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),2800); }
function setSync(ok,text){ qs('#syncDot').className='dot '+(ok?'ok':'bad'); qs('#syncText').textContent=text; }
function openModal(title, eyebrow, html){ qs('#modalTitle').textContent=title; qs('#modalEyebrow').textContent=eyebrow||''; qs('#modalBody').innerHTML=html; qs('#modal').showModal(); }
function closeModal(){ qs('#modal').close(); }
function saveCache(data){ try{localStorage.setItem('pinjam.bootstrap',JSON.stringify({at:Date.now(),data}));}catch{} }
function loadCache(){ try{return JSON.parse(localStorage.getItem('pinjam.bootstrap')||'null');}catch{return null;} }
function statusInfo(item){ if(item.status==='Lunas') return ['Lunas','paid']; if(item.overdue) return ['Terlambat','overdue']; if(item.daysUntil<=3) return [`${Math.max(item.daysUntil,0)} hari lagi`,'soon']; return ['Belum Lunas','upcoming']; }
function todayISO(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }

async function boot(){
  qs('#dateLabel').textContent = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
  if(!cfg.FIREBASE?.apiKey){ showSetupScreen('Firebase belum dikonfigurasi di config.js.'); return; }
  firebaseApp=initializeApp(cfg.FIREBASE); auth=getAuth(firebaseApp); api=new PinjamApi(()=>state.user?.getIdToken(true));
  getRedirectResult(auth).catch(()=>{});
  onAuthStateChanged(auth, async user=>{
    state.user=user;
    if(!user){ qs('#appShell').classList.add('hidden'); qs('#loginView').classList.remove('hidden'); return; }
    qs('#loginView').classList.add('hidden'); qs('#appShell').classList.remove('hidden');
    qs('#accountBtn').textContent=(user.displayName||user.email||'A').trim().charAt(0).toUpperCase();
    bindNav(); await refresh(); setupMessaging().catch(err=>console.warn('Messaging:',err));
  });
}

function showSetupScreen(message){
  qs('#loginView').classList.remove('hidden'); qs('#googleLoginBtn').disabled=true; qs('#loginHint').textContent=message+' Baca README_DEPLOY.md.';
}

qs('#googleLoginBtn').addEventListener('click',async()=>{
  const provider=new GoogleAuthProvider(); provider.setCustomParameters({prompt:'select_account'});
  try{ await signInWithPopup(auth,provider); }catch(err){ if(/popup|blocked|unsupported/i.test(err.code||err.message)) await signInWithRedirect(auth,provider); else toast(err.message); }
});
qs('#refreshBtn').addEventListener('click',()=>refresh(true));
qs('#accountBtn').addEventListener('click',()=>openAccount());
qs('#notificationBtn').addEventListener('click',()=>enableNotifications(true));
window.addEventListener('online',()=>{state.online=true;refresh();});
window.addEventListener('offline',()=>{state.online=false;setSync(false,'Offline · data tersimpan'); render();});

function bindNav(){
  qsa('[data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));
}
function navigate(view){ state.view=view; qsa('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); const titles={home:'Beranda',bills:'Tagihan',loans:'Pinjaman',stats:'Statistik',reminders:'Reminder',settings:'Pengaturan'}; qs('#viewTitle').textContent=titles[view]||'Pinjam'; render(); }

async function refresh(manual=false){
  if(!state.online){ const c=loadCache(); if(c){state.data=c.data;setSync(false,'Offline · cache');render();} return; }
  setSync(true,'Menyinkronkan…');
  try{ state.data=await api.call('bootstrap',{today:todayISO()}); saveCache(state.data); setSync(true,'Tersinkron sekarang'); render(); if(manual)toast('Data terbaru dimuat.'); }
  catch(err){ const c=loadCache(); if(c){state.data=c.data;setSync(false,'Gagal sinkron · cache');render();} else setSync(false,'Gagal sinkron'); toast(err.message); }
}

function render(){
  const el=qs('#viewContainer');
  if(!state.data){el.innerHTML='<div class="panel empty">Memuat data…</div>';return;}
  const map={home:renderHome,bills:renderBills,loans:renderLoans,stats:renderStats,reminders:renderReminders,settings:renderSettings}; el.innerHTML=(map[state.view]||renderHome)(); attachViewEvents();
}

function renderHome(){
  const d=state.data, a=d.analytics;
  const pending=(d.items||[]).filter(x=>x.status!=='Lunas').sort((x,y)=>x.dueDate.localeCompare(y.dueDate));
  const next=pending.slice(0,5), nearest=pending[0];
  const monthPct=a.monthTotal?Math.min(100,Math.round((a.monthPaid/a.monthTotal)*100)):0;
  return `
  <div class="fintech-home">
    <section class="wallet-hero">
      <div class="wallet-headline">
        <div class="wallet-brand"><span class="wallet-logo">P</span><span>Pinjam</span></div>
        <span class="wallet-secure">● Tersinkron</span>
      </div>
      <div class="wallet-balance">
        <span>Total sisa tagihan</span>
        <strong>${money(a.totalOutstanding)}</strong>
        <small>${a.unpaidCount} tagihan belum lunas · ${a.providersCount} layanan aktif</small>
      </div>
      <div class="wallet-mini-grid">
        <div><span>Bulan ini</span><strong>${money(a.monthTotal)}</strong></div>
        <div><span>Sudah dibayar</span><strong>${money(a.monthPaid)}</strong></div>
        <div><span>Progress</span><strong>${monthPct}%</strong></div>
      </div>
      ${nearest?`<div class="wallet-next"><div><span>Tagihan berikutnya</span><strong>${esc(nearest.provider)}</strong></div><div><span>${dateFmt(nearest.dueDate,{day:'numeric',month:'short'})}</span><strong>${money(nearest.amount)}</strong></div></div>`:''}
    </section>

    <section class="fintech-surface">
      <div class="finance-shortcuts">
        <button data-go="bills"><span class="shortcut-icon">▤</span><b>Tagihan</b><small>Lihat semua</small></button>
        <button id="homeAddBtn"><span class="shortcut-icon">＋</span><b>Tambah</b><small>Pinjaman baru</small></button>
        <button data-go="stats"><span class="shortcut-icon">⌁</span><b>Statistik</b><small>Proyeksi</small></button>
        <button data-go="settings"><span class="shortcut-icon">⚙</span><b>Lainnya</b><small>Pengaturan</small></button>
      </div>

      ${d.vario?.remaining>0?`<button type="button" class="vario-strip vario-action" id="varioPaymentBtn"><span class="vario-icon">V</span><div><strong>Vario 160</strong><small>Sisa pokok ${money(d.vario.remaining)} · Catat pembayaran</small></div><span class="chev">›</span></button>`:''}

      <div class="section fintech-section">
        <div class="section-head"><div><h2>Tagihan terdekat</h2><p>Prioritas pembayaran berikutnya.</p></div><button class="link-btn" data-go="bills">Lihat semua</button></div>
        <div class="transaction-panel">${next.length?next.map(fintechBillRow).join(''):'<div class="empty">Tidak ada tagihan belum lunas.</div>'}</div>
      </div>

      <div class="section fintech-section">
        <div class="section-head"><div><h2>Sisa per layanan</h2><p>Komposisi kewajiban aktif.</p></div></div>
        <div class="provider-fintech-card">${providerRows(a.providerOutstanding)}</div>
      </div>
    </section>
  </div>`;
}

function fintechBillRow(x){
  const [label,cls]=statusInfo(x), dt=new Date(`${x.dueDate}T00:00:00+08:00`);
  const dueText=x.daysUntil===0?'Hari ini':x.daysUntil<0?`${Math.abs(x.daysUntil)} hari lewat`:dateFmt(x.dueDate,{day:'numeric',month:'short'});
  return `<div class="txn-row" data-item="${esc(x.id)}"><div class="txn-date"><b>${dt.getDate()}</b><span>${new Intl.DateTimeFormat('id-ID',{month:'short'}).format(dt).toUpperCase()}</span></div><div class="txn-copy"><strong>${esc(x.provider)}</strong><span>${esc(x.name)} · ${dueText}</span></div><div class="txn-value"><strong>${money(x.amount)}</strong><span class="status ${cls}">${label}</span></div><span class="txn-chevron">›</span></div>`;
}

function billRow(x){ const [label,cls]=statusInfo(x), dt=new Date(`${x.dueDate}T00:00:00+08:00`); return `<div class="bill-row" data-item="${esc(x.id)}"><div class="date-chip">${dt.getDate()}<small>${new Intl.DateTimeFormat('id-ID',{month:'short'}).format(dt).toUpperCase()}</small></div><div class="bill-main"><strong>${esc(x.provider)}</strong><span>${esc(x.name)}</span></div><div class="bill-money">${money(x.amount)}<small>${x.daysUntil===0?'Hari ini':x.daysUntil<0?`${Math.abs(x.daysUntil)} hari lewat`:dateFmt(x.dueDate,{day:'numeric',month:'short'})}</small></div><span class="status ${cls}">${label}</span></div>`; }
function providerRows(obj){ const entries=Object.entries(obj||{}).sort((a,b)=>b[1]-a[1]); const max=Math.max(...entries.map(x=>x[1]),1); return entries.length?entries.map(([k,v])=>`<div class="provider-row"><strong>${esc(k)}</strong><span>${money(v)}</span><div class="bar"><i style="width:${Math.max(4,v/max*100)}%"></i></div></div>`).join(''):'<div class="empty">Belum ada data.</div>'; }

function renderBills(){
  const items=state.data.items||[]; const months=[...new Set(items.map(x=>monthKey(x.dueDate)))].sort(); if(!state.filter.month) state.filter.month=monthKey(todayISO());
  const providers=[...new Set(items.map(x=>x.provider))].sort();
  const filtered=items.filter(x=>(state.filter.month==='ALL'||monthKey(x.dueDate)===state.filter.month)&&(state.filter.provider==='ALL'||x.provider===state.filter.provider)&&(state.filter.status==='ALL'||(state.filter.status==='PAID'?x.status==='Lunas':x.status!=='Lunas'))).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const total=filtered.reduce((n,x)=>n+Number(x.amount||0),0), paid=filtered.filter(x=>x.status==='Lunas').length, unpaid=filtered.length-paid;
  return `<div class="fintech-page bills-page-v14">
    <section class="page-blue-summary">
      <p class="eyebrow">Ringkasan tagihan</p>
      <div class="blue-summary-main"><div><span>Total nominal</span><strong>${money(total)}</strong></div><div class="summary-count"><b>${filtered.length}</b><span>tagihan tampil</span></div></div>
      <div class="summary-inline"><span><b>${paid}</b> lunas</span><span><b>${unpaid}</b> belum lunas</span></div>
    </section>

    <section class="page-white-surface">
      <div class="filter-chips">
        <label><span>Bulan</span><select id="monthFilter"><option value="ALL">Semua</option>${months.map(m=>`<option value="${m}" ${m===state.filter.month?'selected':''}>${monthLabel(m)}</option>`).join('')}</select></label>
        <label><span>Sumber</span><select id="providerFilter"><option value="ALL">Semua</option>${providers.map(p=>`<option ${p===state.filter.provider?'selected':''}>${esc(p)}</option>`).join('')}</select></label>
        <label><span>Status</span><select id="statusFilter"><option value="ALL">Semua</option><option value="UNPAID" ${state.filter.status==='UNPAID'?'selected':''}>Belum lunas</option><option value="PAID" ${state.filter.status==='PAID'?'selected':''}>Lunas</option></select></label>
      </div>
      <div class="transaction-panel bills-transactions">${filtered.length?filtered.map(fintechBillRow).join(''):'<div class="empty">Tidak ada tagihan pada filter ini.</div>'}</div>
    </section>
  </div>`;
}

function monthLabel(m){const [y,mo]=m.split('-');return new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric'}).format(new Date(+y,+mo-1,1));}

function renderLoans(){
  const groups=state.data.groups||[];
  const totalOutstanding=groups.reduce((n,g)=>n+Number(g.outstanding||0),0);
  const active=groups.filter(g=>Number(g.outstanding||0)>0).length;
  return `<div class="fintech-page loans-v14">
    <section class="page-blue-summary loans-summary-blue"><p class="eyebrow">Portofolio pinjaman</p><div class="blue-summary-main"><div><span>Total kewajiban aktif</span><strong>${money(totalOutstanding)}</strong></div><div class="summary-count"><b>${active}</b><span>aktif</span></div></div><button id="addLoanBtn" class="blue-inline-action">＋ Tambah pinjaman</button></section>
    <section class="page-white-surface loan-surface">
      <div class="section-head"><div><h2>Semua pinjaman</h2><p>Ketuk item untuk melihat detail cicilan.</p></div></div>
      <div class="finance-loan-list">${groups.map(g=>{const pct=g.total?Math.min(100,Math.round(g.paid/g.total*100)):0;return `<div class="finance-loan-row" data-group="${esc(g.key)}"><div class="loan-provider-icon">${esc((g.provider||'P').charAt(0).toUpperCase())}</div><div class="loan-row-copy"><div><strong>${esc(g.name)}</strong><span>${esc(g.provider)} · ${g.kind==='dynamic'?'Dinamis':'Cicilan tetap'}</span></div><div class="loan-row-progress"><i style="width:${pct}%"></i></div><small>${g.paid}/${g.total} lunas${g.nextDue?` · berikutnya ${dateFmt(g.nextDue,{day:'numeric',month:'short'})}`:''}</small></div><div class="loan-row-value"><strong>${money(g.outstanding)}</strong><span>${pct}%</span></div><span class="txn-chevron">›</span></div>`}).join('')||'<div class="empty">Belum ada pinjaman.</div>'}</div>
    </section>
  </div>`;
}

function renderStats(){
  const a=state.data.analytics; const monthly=a.monthlyProjection||[]; const max=Math.max(...monthly.map(x=>x.amount),1);
  const providers=Object.entries(a.providerOutstanding||{}).sort((x,y)=>y[1]-x[1]), biggest=providers[0];
  return `<div class="fintech-page stats-v14">
    <section class="page-blue-summary stats-blue">
      <p class="eyebrow">Ringkasan finansial</p>
      <div class="blue-summary-main"><div><span>Total sisa tagihan</span><strong>${money(a.totalOutstanding)}</strong><small>Di luar Vario 160</small></div><div class="summary-orb">↗</div></div>
      <div class="stats-mini-strip"><div><span>Bulan terberat</span><b>${a.heaviestMonth?monthLabel(a.heaviestMonth.month):'-'}</b><small>${a.heaviestMonth?money(a.heaviestMonth.amount):''}</small></div><div><span>Mulai lebih ringan</span><b>${a.lighterMonth?monthLabel(a.lighterMonth.month):'-'}</b><small>${a.lighterMonth?money(a.lighterMonth.amount):'Belum terdeteksi'}</small></div><div><span>Layanan terbesar</span><b>${biggest?esc(biggest[0]):'-'}</b><small>${biggest?money(biggest[1]):''}</small></div></div>
    </section>

    <section class="page-white-surface stats-surface">
      <div class="section fintech-section"><div class="section-head"><div><h2>Proyeksi cicilan</h2><p>Tagihan belum lunas per bulan.</p></div></div><div class="projection-card">${monthly.map(x=>`<div class="projection-row"><span>${monthLabel(x.month).replace(/ \d{4}$/,'')}</span><div class="projection-track"><i style="width:${x.amount/max*100}%"></i></div><strong>${money(x.amount)}</strong></div>`).join('')||'<div class="empty">Tidak ada proyeksi.</div>'}</div></div>
      <div class="section fintech-section"><div class="section-head"><div><h2>Komposisi layanan</h2><p>Sisa kewajiban per layanan.</p></div></div><div class="provider-fintech-card">${providerRows(a.providerOutstanding)}</div></div>
    </section>
  </div>`;
}

function renderReminders(){ const s=state.data.settings||{}; const devices=state.data.devices||[]; return `<div class="content-grid"><div class="panel"><div class="section-head"><div><h2>Jadwal pengingat</h2><p>Server memeriksa tagihan, bukan browser yang harus tetap terbuka.</p></div></div><div class="form-grid"><div class="field full"><label>Hari pengingat</label><input id="reminderDays" value="${esc(s.REMINDER_DAYS||'7,3,1,0')}" placeholder="7,3,1,0"></div><div class="field"><label>Jam lokal</label><input id="reminderHour" type="time" value="${esc(s.REMINDER_HOUR||'08:00')}"></div><div class="field"><label>Status</label><select id="reminderEnabled"><option value="TRUE" ${s.REMINDER_ENABLED==='TRUE'?'selected':''}>Aktif</option><option value="FALSE" ${s.REMINDER_ENABLED!=='TRUE'?'selected':''}>Nonaktif</option></select></div></div><div class="form-actions"><button id="saveReminderBtn" class="btn primary">Simpan pengaturan</button></div></div><div class="panel"><h2 style="margin-top:0">Perangkat</h2><p class="muted tiny">${devices.length} perangkat terdaftar.</p>${devices.length?devices.map(d=>`<div class="notice" style="margin-top:9px"><strong>${esc(d.platform||'Perangkat')}</strong><br><span class="tiny">Terakhir aktif ${esc(d.lastSeen||'-')}</span></div>`).join(''):'<div class="notice warn">Aktifkan notifikasi dari tombol 🔔 pada perangkat yang ingin menerima reminder.</div>'}</div></div>`; }

function renderSettings(){ return `<div class="cards"><div class="loan-card"><h3>Sinkronisasi</h3><p>Sheet lama tetap sumber kebenaran.</p><div class="amount" style="font-size:16px">LEGACY_DIRECT</div><button id="syncNowBtn" class="btn secondary">Sinkronkan sekarang</button></div><div class="loan-card"><h3>SPayLater</h3><p>Perbarui nominal hasil akumulasi dari Shopee tanpa menghapus histori.</p><div class="amount" style="font-size:16px">Mode Dinamis</div><button id="updateSpayBtn" class="btn secondary">Perbarui SPayLater</button></div><div class="loan-card"><h3>Akun</h3><p>${esc(state.user?.email||'')}</p><div class="amount" style="font-size:16px">${esc(state.user?.displayName||'Pengguna')}</div><button id="logoutBtn" class="btn ghost">Keluar</button></div></div>`; }

function attachViewEvents(){
  qsa('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));
  qsa('[data-item]').forEach(r=>r.onclick=()=>openItem(r.dataset.item));
  qs('#monthFilter')?.addEventListener('change',e=>{state.filter.month=e.target.value;render()});
  qs('#providerFilter')?.addEventListener('change',e=>{state.filter.provider=e.target.value;render()});
  qs('#statusFilter')?.addEventListener('change',e=>{state.filter.status=e.target.value;render()});
  qs('#addLoanBtn')?.addEventListener('click',openAddLoan); qs('#homeAddBtn')?.addEventListener('click',openAddLoan); qs('#varioPaymentBtn')?.addEventListener('click',openVarioPayment); qs('#syncNowBtn')?.addEventListener('click',()=>refresh(true)); qs('#updateSpayBtn')?.addEventListener('click',()=>openPaylaterUpdate('Shopee Paylater')); qs('#logoutBtn')?.addEventListener('click',()=>signOut(auth)); qs('#saveReminderBtn')?.addEventListener('click',saveReminderSettings);
  qsa('[data-group]').forEach(x=>x.onclick=()=>openGroup(x.dataset.group));
}

function openItem(id){ const x=(state.data.items||[]).find(i=>i.id===id); if(!x)return; const [label,cls]=statusInfo(x); openModal(x.name,x.provider,`<div class="notice ${cls==='overdue'?'danger':cls==='soon'?'warn':''}"><strong>${money(x.amount)}</strong><br>${dateFmt(x.dueDate)} · <span class="status ${cls}" style="margin-top:8px">${label}</span></div><div style="margin-top:15px" class="form-grid"><div class="field"><label>Sumber</label><input value="${esc(x.provider)}" disabled></div><div class="field"><label>Jenis</label><input value="${x.kind==='dynamic'?'PayLater dinamis':'Cicilan tetap'}" disabled></div></div><div class="form-actions">${x.kind==='dynamic'?`<button type="button" id="editDynamicBtn" class="btn secondary">Perbarui</button>`:''}${x.status!=='Lunas'?`<button type="button" id="markPaidBtn" class="btn primary">✓ Tandai Lunas</button>`:`<button type="button" id="markUnpaidBtn" class="btn ghost">Batalkan Lunas</button>`}</div>`);
  qs('#markPaidBtn')?.addEventListener('click',()=>changePaid(x,true)); qs('#markUnpaidBtn')?.addEventListener('click',()=>changePaid(x,false)); qs('#editDynamicBtn')?.addEventListener('click',()=>openPaylaterUpdate(x.sourceSheet));
}
async function changePaid(x,paid){ try{qs('#markPaidBtn')&&(qs('#markPaidBtn').disabled=true); await api.call('setStatus',{id:x.id,sourceSheet:x.sourceSheet,sourceRow:x.sourceRow,expectedName:x.name,expectedDueDate:x.dueDate,status:paid?'Lunas':'Belum Lunas'}); closeModal();toast(paid?'Tagihan ditandai lunas.':'Status dikembalikan belum lunas.');await refresh();}catch(e){toast(e.message);} }

function openGroup(key){ const g=(state.data.groups||[]).find(x=>x.key===key); if(!g)return; const rows=(state.data.items||[]).filter(x=>x.groupKey===key).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)); openModal(g.name,g.provider,`<div class="notice"><strong>Sisa ${money(g.outstanding)}</strong><br>${g.paid} dari ${g.total} cicilan sudah lunas.</div><div class="bill-list" style="margin-top:14px">${rows.map(billRow).join('')}</div>${g.kind==='dynamic'?'<div class="form-actions"><button type="button" id="groupUpdateBtn" class="btn primary">Perbarui tagihan</button></div>':''}`); qsa('#modalBody [data-item]').forEach(r=>r.onclick=()=>{closeModal();openItem(r.dataset.item)}); qs('#groupUpdateBtn')?.addEventListener('click',()=>openPaylaterUpdate(g.sourceSheet)); }

function openPaylaterUpdate(sheet='Shopee Paylater'){
  const rows=(state.data.items||[]).filter(x=>x.sourceSheet===sheet).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  openModal('Perbarui Tagihan',sheet,`<div class="notice">Masukkan angka terbaru dari aplikasi ${esc(sheet)}. Nilai lama akan dicatat di histori sebelum diubah.</div><div id="paylaterRows" style="margin-top:12px">${rows.map(x=>`<div class="month-edit" data-existing="${esc(x.id)}"><input class="field-inline upd-date" type="date" value="${x.dueDate}"><input class="field-inline upd-amount" inputmode="numeric" value="${Number(x.amount)}"><span></span></div>`).join('')}</div><button type="button" id="addMonthRow" class="btn secondary">＋ Tambah bulan</button><div class="form-actions"><button type="button" id="savePaylater" class="btn primary">Simpan perubahan</button></div>`);
  qs('#addMonthRow').onclick=()=>{qs('#paylaterRows').insertAdjacentHTML('beforeend',`<div class="month-edit"><input class="field-inline upd-date" type="date"><input class="field-inline upd-amount" inputmode="numeric" placeholder="Nominal"><button type="button" class="btn ghost remove-row">×</button></div>`); bindRemoveRows();}; bindRemoveRows(); qs('#savePaylater').onclick=()=>savePaylater(sheet);
}
function bindRemoveRows(){qsa('.remove-row').forEach(b=>b.onclick=()=>b.closest('.month-edit').remove())}
async function savePaylater(sheet){ const entries=qsa('#paylaterRows .month-edit').map(r=>({id:r.dataset.existing||'',dueDate:r.querySelector('.upd-date').value,amount:Number(String(r.querySelector('.upd-amount').value).replace(/\D/g,''))})).filter(x=>x.dueDate&&x.amount>=0); if(!entries.length)return toast('Isi minimal satu tagihan.'); try{qs('#savePaylater').disabled=true;await api.call('updatePaylater',{sourceSheet:sheet,entries});closeModal();toast('Tagihan diperbarui dan histori disimpan.');await refresh();}catch(e){toast(e.message);qs('#savePaylater').disabled=false;} }


function openVarioPayment(){
  const v=state.data?.vario||{};
  openModal('Catat Pembayaran','Vario 160',`<div class="notice"><strong>Sisa pokok saat ini ${money(v.remaining||0)}</strong><br>Pembayaran baru akan ditambahkan ke sheet VARIO160 dan sisa pokok dihitung ulang otomatis.</div><div class="form-grid" style="margin-top:14px"><div class="field"><label>Tanggal pembayaran</label><input id="varioDate" type="date" value="${todayISO()}"></div><div class="field"><label>Jumlah pembayaran</label><input id="varioAmount" inputmode="numeric" placeholder="2000000"></div><div class="field full"><label>Keterangan</label><input id="varioNote" value="Bayar" placeholder="Contoh: Bayar"></div></div><div class="form-actions"><button type="button" id="saveVarioPayment" class="btn primary">Simpan Pembayaran</button></div>`);
  qs('#saveVarioPayment').onclick=saveVarioPayment;
}

async function saveVarioPayment(){
  const payload={date:qs('#varioDate').value,amount:Number(String(qs('#varioAmount').value).replace(/\D/g,'')),note:qs('#varioNote').value.trim()||'Bayar'};
  if(!payload.date||!payload.amount)return toast('Isi tanggal dan jumlah pembayaran Vario.');
  try{
    qs('#saveVarioPayment').disabled=true;
    const r=await api.call('addVarioPayment',payload);
    closeModal();
    toast(`Pembayaran Vario disimpan. Sisa ${money(r.remaining||0)}.`);
    await refresh();
  }catch(e){toast(e.message);qs('#saveVarioPayment')&&(qs('#saveVarioPayment').disabled=false);}
}

function openAddLoan(){
  openModal('Tambah Pinjaman','Cicilan baru',`<div class="form-grid"><div class="field"><label>Sumber</label><select id="newSource"><option>SPinjam</option><option>GopayPinjam</option><option>Shopee Paylater</option><option>Gopaylater</option><option>Tiktok Paylater</option></select></div><div class="field"><label>Nama</label><input id="newName" placeholder="Contoh: SPinjam #13"></div><div class="field"><label>Cicilan pertama</label><input id="newDate" type="date"></div><div class="field"><label>Tenor</label><input id="newTenor" type="number" min="1" max="60" value="6"></div><div class="field"><label>Angsuran per bulan</label><input id="newAmount" inputmode="numeric" placeholder="550000"></div><div class="field"><label>Status awal</label><select id="newStatus"><option>Belum Lunas</option><option>Lunas</option></select></div></div><div class="notice" style="margin-top:14px">Untuk PayLater yang nominalnya berubah-ubah, Anda tetap bisa membuat data awal lalu memakai menu <strong>Perbarui Tagihan</strong>.</div><div class="form-actions"><button type="button" id="saveNewLoan" class="btn primary">Simpan Pinjaman</button></div>`);
  qs('#saveNewLoan').onclick=saveNewLoan;
}
async function saveNewLoan(){ const p={sourceSheet:qs('#newSource').value,name:qs('#newName').value.trim(),firstDueDate:qs('#newDate').value,tenor:Number(qs('#newTenor').value),amount:Number(String(qs('#newAmount').value).replace(/\D/g,'')),status:qs('#newStatus').value}; if(!p.name||!p.firstDueDate||!p.tenor||!p.amount)return toast('Lengkapi nama, tanggal, tenor, dan nominal.'); try{qs('#saveNewLoan').disabled=true;await api.call('createLoan',p);closeModal();toast('Pinjaman baru ditambahkan.');await refresh();navigate('loans');}catch(e){toast(e.message);qs('#saveNewLoan').disabled=false;} }

async function saveReminderSettings(){ const payload={REMINDER_DAYS:qs('#reminderDays').value.trim(),REMINDER_HOUR:qs('#reminderHour').value,REMINDER_ENABLED:qs('#reminderEnabled').value}; try{await api.call('updateSettings',payload);toast('Pengaturan reminder disimpan.');await refresh();}catch(e){toast(e.message);} }
function openAccount(){openModal('Akun','Pinjam',`<p><strong>${esc(state.user?.displayName||'')}</strong><br><span class="muted">${esc(state.user?.email||'')}</span></p><div class="form-actions"><button type="button" id="accountLogout" class="btn ghost">Keluar</button></div>`);qs('#accountLogout').onclick=()=>{closeModal();signOut(auth)}}

async function setupMessaging(){
  if(!cfg.VAPID_KEY||!await messagingSupported()) return;
  messaging=getMessaging(firebaseApp);
  onMessage(messaging,p=>{ const n=p.notification||{}, d=p.data||{}; toast((n.title||d.title?`${n.title||d.title}: `:'')+(n.body||d.body||'Notifikasi baru')); });
  onRegistered(messaging, fid=>registerFid(fid).catch(console.warn));
  if(Notification.permission==='granted') await enableNotifications(false);
}
async function enableNotifications(showFeedback){
  try{
    if(!messaging && await messagingSupported()) messaging=getMessaging(firebaseApp);
    if(!messaging) throw new Error('Browser ini tidak mendukung Web Push.');
    const permission=await Notification.requestPermission(); if(permission!=='granted') throw new Error('Izin notifikasi belum diberikan.');
    const sw=await navigator.serviceWorker.register('./sw.js');
    await registerMessaging(messaging,{vapidKey:cfg.VAPID_KEY,serviceWorkerRegistration:sw});
    if(showFeedback)toast('Notifikasi aktif. Registrasi perangkat disinkronkan.');
  }catch(e){if(showFeedback)toast(e.message);}
}
async function registerFid(fid){ if(!fid)return; await api.call('registerDevice',{fid,platform:navigator.userAgentData?.platform||navigator.platform||'Web',userAgent:navigator.userAgent,permission:Notification.permission,appVersion:cfg.APP_VERSION||'1.0.0'}); }

boot();
