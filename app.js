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

const state = { user:null, data:null, view:'home', filter:{month:'',provider:'ALL',status:'ALL'}, online:navigator.onLine, lastSyncAt:null, theme:localStorage.getItem('pinjam.theme')||'light' };
let firebaseApp, auth, messaging, api;

function toast(msg){ const t=qs('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),2800); }
function setSync(ok,text){
  const dot=qs('#syncDot'), sync=qs('#syncText'), badge=qs('#connectionBadge');
  if(dot) dot.className='dot '+(ok?'ok':'bad'); if(sync) sync.textContent=text;
  if(badge){
    if(!state.online){ badge.className='connection-badge offline'; badge.textContent='Offline · hanya baca'; }
    else if(!ok){ badge.className='connection-badge warning'; badge.textContent='Sinkronisasi bermasalah'; }
    else { badge.className='connection-badge hidden'; }
  }
}
function openModal(title, eyebrow, html){ qs('#modalTitle').textContent=title; qs('#modalEyebrow').textContent=eyebrow||''; qs('#modalBody').innerHTML=html; qs('#modal').showModal(); }
function closeModal(){ qs('#modal').close(); }
function saveCache(data){ try{localStorage.setItem('pinjam.bootstrap',JSON.stringify({at:Date.now(),data}));}catch{} }
function loadCache(){ try{return JSON.parse(localStorage.getItem('pinjam.bootstrap')||'null');}catch{return null;} }
function statusInfo(item){ if(item.status==='Lunas') return ['Lunas','paid']; if(item.paymentStatus==='Sebagian') return ['Sebagian','partial']; if(item.overdue) return ['Terlambat','overdue']; if(item.daysUntil<=7) return [item.daysUntil===0?'Hari ini':`${Math.max(item.daysUntil,0)} hari lagi`,'soon']; return ['Belum Lunas','upcoming']; }
function itemOriginal(x){ return Number(x?.originalAmount ?? x?.amount ?? 0); }
function itemPaid(x){ return x?.status==='Lunas' ? itemOriginal(x) : Number(x?.partialPaid||0); }
function itemRemaining(x){ return x?.status==='Lunas' ? 0 : Number(x?.remainingAmount ?? x?.amount ?? 0); }
function itemSupportsPartial(x){ return !!x?.partialPaymentAllowed; }
function todayISO(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function applyTheme(theme=state.theme){
  state.theme=theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=state.theme;
  localStorage.setItem('pinjam.theme',state.theme);
}
function formatSyncTime(){ return state.lastSyncAt ? new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit'}).format(state.lastSyncAt) : '-'; }
function emptyState(title='Belum ada data',desc='Tidak ada item yang perlu ditampilkan.',action=''){
  return `<div class="empty-state"><div class="empty-illustration">✓</div><strong>${esc(title)}</strong><span>${esc(desc)}</span>${action||''}</div>`;
}
function renderSkeleton(){
  const el=qs('#viewContainer'); if(!el)return;
  el.innerHTML=`<div class="skeleton-page"><div class="skeleton hero-skeleton"></div><div class="skeleton-shortcuts">${'<i class="skeleton"></i>'.repeat(4)}</div><div class="skeleton-list">${'<i class="skeleton"></i>'.repeat(5)}</div></div>`;
}
function paylaterHistoryFor(source){ return (state.data?.paylaterHistory||[]).filter(h=>h.sourceSheet===source); }
function amountChangeText(h){ const oldN=Number(h.oldValue||0), newN=Number(h.newValue||0), diff=newN-oldN; return `${diff>=0?'+':'−'}${money(Math.abs(diff))}`; }
function themeIcon(){ return state.theme==='dark'?'☀':'☾'; }


async function boot(){
  applyTheme(state.theme);
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
    bindNav(); renderSkeleton(); await refresh(); const deepItem=new URLSearchParams(location.search).get('item'); if(deepItem&&state.data){openItem(deepItem); history.replaceState({},'',location.pathname);} setupMessaging().catch(err=>console.warn('Messaging:',err));
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
  if(!state.data)renderSkeleton();
  setSync(true,'Menyinkronkan…');
  try{ state.data=await api.call('bootstrap',{today:todayISO()}); state.lastSyncAt=new Date(); saveCache(state.data); setSync(true,'Tersinkron sekarang'); render(); if(manual)toast('Data terbaru dimuat.'); }
  catch(err){ const c=loadCache(); if(c){state.data=c.data;setSync(false,'Gagal sinkron · cache');render();} else {setSync(false,'Gagal sinkron'); qs('#viewContainer').innerHTML=emptyState('Tidak dapat memuat data','Periksa koneksi lalu coba sinkronkan lagi.','<button id="retryLoadBtn" class="btn primary">Coba lagi</button>'); qs('#retryLoadBtn')?.addEventListener('click',()=>refresh(true));} toast(err.message); }
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
    <section class="wallet-hero compact-wallet-hero">
      <div class="wallet-headline">
        <div class="wallet-brand"><span class="wallet-logo">P</span><span>Pinjam</span></div>
        <span class="wallet-secure">● Tersinkron</span>
      </div>
      <div class="wallet-balance">
        <span>Total sisa tagihan</span>
        <strong>${money(a.totalOutstanding)}</strong>
        <small>${a.unpaidCount} belum lunas · ${a.providersCount} layanan</small>
      </div>
      <div class="wallet-month-line">
        <div><span>Bulan ini</span><strong>${money(a.monthTotal)}</strong></div>
        <div><span>Sudah dibayar</span><strong>${money(a.monthPaid)}</strong></div>
        <div class="wallet-progress"><span>${monthPct}%</span><i><b style="width:${monthPct}%"></b></i></div>
      </div>
      ${nearest?`<div class="wallet-next compact-next"><div><span>Tagihan berikutnya</span><strong>${esc(nearest.provider)}</strong></div><div><span>${dateFmt(nearest.dueDate,{day:'numeric',month:'short'})}</span><strong>${money(nearest.amount)}</strong></div></div>`:''}
    </section>

    <section class="fintech-surface daily-surface">
      <div class="section-head quick-title"><div><h2>Aksi cepat</h2><p>Tindakan yang paling sering dipakai.</p></div></div>
      <div class="finance-shortcuts daily-shortcuts">
        <button id="quickPaidBtn" ${nearest?'':'disabled'}><span class="shortcut-icon">✓</span><b>Tandai Lunas</b><small>${nearest?'Tagihan terdekat':'Tidak ada tagihan'}</small></button>
        <button id="quickSpayBtn"><span class="shortcut-icon">↻</span><b>Update SPayLater</b><small>Nominal terbaru</small></button>
        <button id="homeAddBtn"><span class="shortcut-icon">＋</span><b>Tambah Pinjaman</b><small>Cicilan baru</small></button>
        <button data-go="reminders"><span class="shortcut-icon">◉</span><b>Reminder</b><small>Atur pengingat</small></button>
      </div>

      ${d.vario?.remaining>0?`<button type="button" class="vario-strip vario-action" id="varioPaymentBtn"><span class="vario-icon">V</span><div><strong>Vario 160</strong><small>Sisa ${money(d.vario.remaining)}${d.vario.latestPayment?` · terakhir bayar ${dateFmt(d.vario.latestPayment,{day:'numeric',month:'short'})}`:''}</small></div><span class="chev">›</span></button>`:''}

      <div class="section fintech-section">
        <div class="section-head"><div><h2>Tagihan terdekat</h2><p>Prioritas pembayaran berikutnya.</p></div><button class="link-btn" data-go="bills">Lihat semua</button></div>
        <div class="transaction-panel compact-transactions">${next.length?next.map(fintechBillRow).join(''):emptyState('Bulan terasa ringan 🎉','Tidak ada tagihan belum lunas yang perlu diperhatikan.')}</div>
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
  return `<div class="txn-row" data-item="${esc(x.id)}"><div class="txn-date"><b>${dt.getDate()}</b><span>${new Intl.DateTimeFormat('id-ID',{month:'short'}).format(dt).toUpperCase()}</span></div><div class="txn-copy"><strong>${esc(x.provider)}</strong><span>${esc(x.name)} · ${dueText}${x.paymentStatus==='Sebagian'?` · awal ${money(itemOriginal(x))}`:''}</span></div><div class="txn-value"><strong>${money(x.amount)}</strong><span class="status ${cls}">${label}</span></div><span class="txn-chevron">›</span></div>`;
}

function billRow(x){ const [label,cls]=statusInfo(x), dt=new Date(`${x.dueDate}T00:00:00+08:00`); return `<div class="bill-row" data-item="${esc(x.id)}"><div class="date-chip">${dt.getDate()}<small>${new Intl.DateTimeFormat('id-ID',{month:'short'}).format(dt).toUpperCase()}</small></div><div class="bill-main"><strong>${esc(x.provider)}</strong><span>${esc(x.name)}</span></div><div class="bill-money">${money(x.amount)}<small>${x.daysUntil===0?'Hari ini':x.daysUntil<0?`${Math.abs(x.daysUntil)} hari lewat`:dateFmt(x.dueDate,{day:'numeric',month:'short'})}</small></div><span class="status ${cls}">${label}</span></div>`; }
function providerRows(obj){ const entries=Object.entries(obj||{}).sort((a,b)=>b[1]-a[1]); const max=Math.max(...entries.map(x=>x[1]),1); return entries.length?entries.map(([k,v])=>`<div class="provider-row"><strong>${esc(k)}</strong><span>${money(v)}</span><div class="bar"><i style="width:${Math.max(4,v/max*100)}%"></i></div></div>`).join(''):'<div class="empty">Belum ada data.</div>'; }

function renderBills(){
  const items=state.data.items||[]; const months=[...new Set(items.map(x=>monthKey(x.dueDate)))].sort(); if(!state.filter.month) state.filter.month=monthKey(todayISO());
  const providers=[...new Set(items.map(x=>x.provider))].sort();
  const filtered=items.filter(x=>{
    const statusMatch=state.filter.status==='ALL'||
      (state.filter.status==='PAID'&&x.status==='Lunas')||
      (state.filter.status==='PARTIAL'&&x.paymentStatus==='Sebagian')||
      (state.filter.status==='UNPAID'&&x.status!=='Lunas');
    return (state.filter.month==='ALL'||monthKey(x.dueDate)===state.filter.month)&&(state.filter.provider==='ALL'||x.provider===state.filter.provider)&&statusMatch;
  }).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const total=filtered.reduce((n,x)=>n+Number(x.amount||0),0), paid=filtered.filter(x=>x.status==='Lunas').length, partial=filtered.filter(x=>x.paymentStatus==='Sebagian').length, unpaid=filtered.length-paid;
  return `<div class="fintech-page bills-page-v15">
    <section class="page-blue-summary compact-page-summary">
      <p class="eyebrow">Tagihan</p>
      <div class="blue-summary-main"><div><span>Total pada filter</span><strong>${money(total)}</strong></div><div class="summary-count"><b>${filtered.length}</b><span>tagihan</span></div></div>
      <div class="summary-inline"><span><b>${paid}</b> lunas</span><span><b>${unpaid}</b> belum lunas</span>${partial?`<span><b>${partial}</b> sebagian</span>`:''}</div>
    </section>
    <section class="page-white-surface dense-bill-surface">
      <div class="filter-chips compact-filter-chips">
        <label><span>Bulan</span><select id="monthFilter"><option value="ALL">Semua</option>${months.map(m=>`<option value="${m}" ${m===state.filter.month?'selected':''}>${monthLabel(m)}</option>`).join('')}</select></label>
        <label><span>Sumber</span><select id="providerFilter"><option value="ALL">Semua</option>${providers.map(p=>`<option ${p===state.filter.provider?'selected':''}>${esc(p)}</option>`).join('')}</select></label>
        <label><span>Status</span><select id="statusFilter"><option value="ALL">Semua</option><option value="UNPAID" ${state.filter.status==='UNPAID'?'selected':''}>Belum lunas</option><option value="PARTIAL" ${state.filter.status==='PARTIAL'?'selected':''}>Sebagian</option><option value="PAID" ${state.filter.status==='PAID'?'selected':''}>Lunas</option></select></label>
      </div>
      <div class="transaction-panel bills-transactions compact-transactions">${filtered.length?filtered.map(fintechBillRow).join(''):emptyState('Tidak ada tagihan 🎉','Tidak ada tagihan yang cocok dengan filter ini.')}</div>
    </section>
  </div>`;
}

function monthLabel(m){const [y,mo]=m.split('-');return new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric'}).format(new Date(+y,+mo-1,1));}

function renderLoans(){
  const groups=state.data.groups||[], all=state.data.items||[];
  const totalOutstanding=groups.reduce((n,g)=>n+Number(g.outstanding||0),0), active=groups.filter(g=>Number(g.outstanding||0)>0).length;
  return `<div class="fintech-page loans-v15">
    <section class="page-blue-summary loans-summary-blue compact-page-summary"><p class="eyebrow">Pinjaman</p><div class="blue-summary-main"><div><span>Total kewajiban aktif</span><strong>${money(totalOutstanding)}</strong></div><div class="summary-count"><b>${active}</b><span>aktif</span></div></div><button id="addLoanBtn" class="blue-inline-action">＋ Tambah pinjaman</button></section>
    <section class="page-white-surface loan-surface">
      <div class="section-head"><div><h2>Semua pinjaman</h2><p>Progress, pembayaran, dan jadwal berikutnya.</p></div></div>
      <div class="finance-loan-list rich-loan-list">${groups.map(g=>{
        const rows=all.filter(x=>x.groupKey===g.key).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
        const scheduled=Number(g.scheduledAmount||rows.reduce((n,x)=>n+itemOriginal(x),0)), paidAmount=Number(g.paidAmount||rows.reduce((n,x)=>n+itemPaid(x),0)), pct=scheduled?Math.min(100,Math.round(paidAmount/scheduled*100)):0;
        const installment=g.partial?`${g.paid} lunas · ${g.partial} sebagian`:(g.kind==='fixed'&&g.paid<g.total?`Angsuran ${g.paid+1} dari ${g.total}`:`${g.paid}/${g.total} lunas`);
        return `<div class="finance-loan-row rich-loan-row" data-group="${esc(g.key)}"><div class="loan-provider-icon">${esc((g.provider||'P').charAt(0).toUpperCase())}</div><div class="loan-row-copy"><div><strong>${esc(g.name)}</strong><span>${esc(g.provider)} · ${g.kind==='dynamic'?'PayLater dinamis':'Cicilan tetap'}</span></div><div class="loan-row-progress"><i style="width:${pct}%"></i></div><small>${installment}${g.nextDue?` · berikutnya ${dateFmt(g.nextDue,{day:'numeric',month:'short'})}`:''}</small><em>Sudah dibayar ${money(paidAmount)} dari ${money(scheduled)}</em></div><div class="loan-row-value"><strong>${money(g.outstanding)}</strong><span>${pct}%</span></div><span class="txn-chevron">›</span></div>`;
      }).join('')||emptyState('Belum ada pinjaman','Pinjaman baru yang ditambahkan akan muncul di sini.')}</div>
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

function renderReminders(){
  const s=state.data.settings||{}, devices=state.data.devices||[], days=new Set(String(s.REMINDER_DAYS||'7,3,1,0').split(',').map(x=>x.trim()));
  const toggle=(id,label,desc,val)=>`<label class="reminder-toggle"><span><b>${label}</b><small>${desc}</small></span><input id="${id}" type="checkbox" ${days.has(String(val))?'checked':''}><i></i></label>`;
  return `<div class="reminder-layout"><div class="panel reminder-panel"><div class="section-head"><div><h2>Pengingat tagihan</h2><p>Pilih waktu pengingat yang Anda inginkan.</p></div></div>
    <label class="master-toggle"><span><b>Reminder aktif</b><small>Matikan sementara tanpa menghapus pengaturan.</small></span><input id="reminderEnabledToggle" type="checkbox" ${s.REMINDER_ENABLED==='TRUE'?'checked':''}><i></i></label>
    <div class="reminder-toggle-list">${toggle('reminderH7','H-7','Seminggu sebelum jatuh tempo',7)}${toggle('reminderH3','H-3','Tiga hari sebelum jatuh tempo',3)}${toggle('reminderH1','H-1','Sehari sebelum jatuh tempo',1)}${toggle('reminderH0','Hari H','Saat jatuh tempo',0)}</div>
    <div class="field reminder-time"><label>Waktu pengingat</label><input id="reminderHour" type="time" value="${esc(s.REMINDER_HOUR||'08:00')}"></div>
    <div class="form-actions"><button id="saveReminderBtn" class="btn primary">Simpan pengaturan</button></div>
  </div><div class="panel device-panel"><div class="section-head"><div><h2>Perangkat</h2><p>${devices.length} perangkat menerima notifikasi.</p></div></div>${devices.length?devices.map(d=>`<div class="device-row"><span class="device-icon">${/android/i.test(d.platform||'')?'▯':'▣'}</span><div><strong>${esc(d.platform||'Perangkat')}</strong><small>Terakhir aktif ${esc(d.lastSeen||'-')}</small></div><span class="device-ok">Aktif</span></div>`).join(''):emptyState('Belum ada perangkat','Tekan ikon lonceng untuk mengaktifkan notifikasi di perangkat ini.')}</div></div>`;
}

function renderSettings(){
  return `<div class="settings-grid">
    <div class="settings-card"><span class="settings-icon">◫</span><div><h3>Pinjaman</h3><p>Lihat semua pinjaman, progres cicilan, dan jadwal berikutnya.</p><small>${(state.data.groups||[]).length} kelompok pinjaman</small></div><button id="openLoansBtn" class="btn secondary">Buka</button></div>
    <div class="settings-card"><span class="settings-icon">↻</span><div><h3>Sinkronisasi</h3><p>Spreadsheet lama tetap menjadi sumber data utama.</p><small>Terakhir sinkron ${formatSyncTime()}</small></div><button id="syncNowBtn" class="btn secondary">Sinkronkan</button></div>
    <div class="settings-card"><span class="settings-icon">S</span><div><h3>SPayLater</h3><p>Perbarui nominal akumulasi tanpa kehilangan histori perubahan.</p><small>Mode dinamis</small></div><button id="updateSpayBtn" class="btn secondary">Perbarui</button></div>
    <div class="settings-card"><span class="settings-icon">${themeIcon()}</span><div><h3>Tampilan</h3><p>Gunakan mode terang atau gelap sesuai kenyamanan.</p><small>${state.theme==='dark'?'Mode gelap aktif':'Mode terang aktif'}</small></div><button id="themeToggle" class="btn secondary">${state.theme==='dark'?'Gunakan terang':'Gunakan gelap'}</button></div>
    <div class="settings-card"><span class="settings-icon">M</span><div><h3>Akun</h3><p>${esc(state.user?.email||'')}</p><small>${esc(state.user?.displayName||'Pengguna')}</small></div><button id="accountDetailBtn" class="btn secondary">Detail akun</button></div>
  </div>`;
}

function attachViewEvents(){
  qsa('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));
  qsa('[data-item]').forEach(r=>r.onclick=()=>openItem(r.dataset.item));
  qs('#monthFilter')?.addEventListener('change',e=>{state.filter.month=e.target.value;render()});
  qs('#providerFilter')?.addEventListener('change',e=>{state.filter.provider=e.target.value;render()});
  qs('#statusFilter')?.addEventListener('change',e=>{state.filter.status=e.target.value;render()});
  qs('#addLoanBtn')?.addEventListener('click',openAddLoan); qs('#homeAddBtn')?.addEventListener('click',openAddLoan); qs('#varioPaymentBtn')?.addEventListener('click',openVarioPayment);
  qs('#quickPaidBtn')?.addEventListener('click',()=>{const x=(state.data.items||[]).filter(x=>x.status!=='Lunas').sort((a,b)=>a.dueDate.localeCompare(b.dueDate))[0]; if(x)openItem(x.id)});
  qs('#quickSpayBtn')?.addEventListener('click',()=>openPaylaterUpdate('Shopee Paylater'));
  qs('#syncNowBtn')?.addEventListener('click',()=>refresh(true)); qs('#updateSpayBtn')?.addEventListener('click',()=>openPaylaterUpdate('Shopee Paylater')); qs('#saveReminderBtn')?.addEventListener('click',saveReminderSettings);
  qs('#themeToggle')?.addEventListener('click',()=>{applyTheme(state.theme==='dark'?'light':'dark');render();toast(state.theme==='dark'?'Mode gelap aktif.':'Mode terang aktif.');});
  qs('#accountDetailBtn')?.addEventListener('click',openAccount); qs('#openLoansBtn')?.addEventListener('click',()=>navigate('loans'));
  qsa('[data-group]').forEach(x=>x.onclick=()=>openGroup(x.dataset.group));
}

function openItem(id){
  const x=(state.data.items||[]).find(i=>i.id===id); if(!x)return; const [label,cls]=statusInfo(x);
  const g=(state.data.groups||[]).find(g=>g.key===x.groupKey), rows=(state.data.items||[]).filter(i=>i.groupKey===x.groupKey).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)), idx=Math.max(0,rows.findIndex(i=>i.id===x.id));
  const original=itemOriginal(x), paidThis=itemPaid(x), remaining=itemRemaining(x), scheduled=Number(g?.scheduledAmount||rows.reduce((n,i)=>n+itemOriginal(i),0)), paidAmount=Number(g?.paidAmount||rows.reduce((n,i)=>n+itemPaid(i),0));
  const pct=scheduled?Math.min(100,Math.round(paidAmount/scheduled*100)):0, paymentHistory=(x.paymentHistory||[]).slice(0,8);
  const amountLabel=x.status==='Lunas'?'Tagihan':(x.paymentStatus==='Sebagian'?'Sisa tagihan':'Tagihan');
  const paymentSummary=itemSupportsPartial(x)?`<div class="detail-kpis partial-kpis"><div><span>Tagihan awal</span><b>${money(original)}</b></div><div><span>Sudah dibayar</span><b>${money(paidThis)}</b></div><div><span>Sisa</span><b>${money(remaining)}</b></div></div>`:`<div class="detail-kpis"><div><span>Posisi</span><b>${x.kind==='fixed'?`${idx+1} / ${rows.length}`:'Dinamis'}</b></div><div><span>Sudah dibayar</span><b>${money(paidAmount)}</b></div><div><span>Total jadwal</span><b>${money(scheduled)}</b></div></div>`;
  const historyHtml=paymentHistory.length?`<div class="history-block"><h3>Riwayat pembayaran tagihan ini</h3>${paymentHistory.map(h=>`<div class="history-row"><div><b>${esc(h.note||'Bayar sebagian')}</b><small>${h.date?dateFmt(h.date):esc(h.timestamp||'')}</small></div><span>${money(h.amount)}</span></div>`).join('')}</div>`:'';
  let actionHtml='';
  if(itemSupportsPartial(x)&&x.status!=='Lunas') actionHtml=`<button type="button" id="partialPayBtn" class="btn secondary">Bayar sebagian</button><button type="button" id="payoffBtn" class="btn primary">Lunasi</button>`;
  else if(x.status!=='Lunas') actionHtml=`<button type="button" id="markPaidBtn" class="btn primary">✓ Tandai Lunas</button>`;
  else if(!(itemSupportsPartial(x)&&Number(x.partialPaid||0)>=original)) actionHtml=`<button type="button" id="markUnpaidBtn" class="btn ghost">Batalkan Lunas</button>`;
  else actionHtml=`<span class="payment-locked-note">Pelunasan tercatat melalui riwayat pembayaran.</span>`;
  openModal(x.name,x.provider,`<div class="detail-amount ${cls}"><span>${amountLabel} · ${dateFmt(x.dueDate)}</span><strong>${money(x.status==='Lunas'?original:remaining)}</strong><span class="status ${cls}">${label}</span></div>${paymentSummary}<div class="detail-progress"><i style="width:${pct}%"></i></div>${historyHtml}<div class="form-actions">${x.kind==='dynamic'?`<button type="button" id="editDynamicBtn" class="btn ghost">Perbarui tagihan</button>`:''}${actionHtml}</div>`);
  qs('#markPaidBtn')?.addEventListener('click',()=>changePaid(x,true));
  qs('#markUnpaidBtn')?.addEventListener('click',()=>changePaid(x,false));
  qs('#editDynamicBtn')?.addEventListener('click',()=>{closeModal();openPaylaterUpdate(x.sourceSheet)});
  qs('#partialPayBtn')?.addEventListener('click',()=>{closeModal();openPartialPayment(x,false)});
  qs('#payoffBtn')?.addEventListener('click',()=>{closeModal();openPartialPayment(x,true)});
}

function openPartialPayment(x,payoff=false){
  const original=itemOriginal(x), paid=itemPaid(x), remaining=itemRemaining(x);
  if(!itemSupportsPartial(x))return toast('Bayar sebagian tidak tersedia untuk tagihan ini.');
  if(remaining<=0)return toast('Tagihan ini sudah tidak memiliki sisa.');
  openModal(payoff?'Lunasi Tagihan':'Bayar Sebagian',x.provider,`<div class="partial-payment-card"><span>${esc(x.name)} · ${dateFmt(x.dueDate,{day:'numeric',month:'short',year:'numeric'})}</span><div><small>Tagihan awal</small><b>${money(original)}</b></div><div><small>Sudah dibayar</small><b>${money(paid)}</b></div><div class="remaining"><small>Sisa sekarang</small><b>${money(remaining)}</b></div></div><div class="form-grid partial-payment-form"><div class="field"><label>Tanggal pembayaran</label><input id="partialDate" type="date" value="${todayISO()}"></div><div class="field"><label>Jumlah pembayaran</label><input id="partialAmount" inputmode="numeric" value="${payoff?remaining:''}" ${payoff?'readonly':''} placeholder="Contoh: 20000"></div><div class="field full"><label>Keterangan</label><input id="partialNote" value="${payoff?'Pelunasan':'Bayar sebagian'}" placeholder="Contoh: Bayar sebagian"></div></div><div class="notice partial-note" style="margin-top:12px">Nominal asli <strong>${money(original)}</strong> tetap tersimpan. Aplikasi hanya mengurangi sisa berdasarkan pembayaran yang Anda catat.</div><div class="form-actions"><button type="button" id="savePartialPayment" class="btn primary">${payoff?'Simpan Pelunasan':'Simpan Pembayaran'}</button></div>`);
  qs('#savePartialPayment').onclick=()=>savePartialPayment(x,payoff);
}

async function savePartialPayment(x,payoff=false){
  const remaining=itemRemaining(x), amount=payoff?remaining:Number(String(qs('#partialAmount')?.value||'').replace(/\D/g,''));
  const payload={sourceSheet:x.sourceSheet,sourceRow:x.sourceRow,expectedName:x.name,expectedDueDate:x.dueDate,date:qs('#partialDate')?.value||todayISO(),amount,note:qs('#partialNote')?.value.trim()||(payoff?'Pelunasan':'Bayar sebagian')};
  if(!payload.date||!amount)return toast('Isi tanggal dan jumlah pembayaran.');
  if(amount>remaining)return toast(`Pembayaran maksimal ${money(remaining)}.`);
  try{
    qs('#savePartialPayment').disabled=true;
    const r=await api.call('addPartialPayment',payload);
    closeModal();
    toast(r.status==='Lunas'?`Tagihan lunas. Pembayaran ${money(amount)} disimpan.`:`Pembayaran disimpan. Sisa ${money(r.remaining)}.`);
    await refresh();
  }catch(e){toast(e.message);qs('#savePartialPayment')&&(qs('#savePartialPayment').disabled=false);}
}

async function changePaid(x,paid){ try{qs('#markPaidBtn')&&(qs('#markPaidBtn').disabled=true); await api.call('setStatus',{id:x.id,sourceSheet:x.sourceSheet,sourceRow:x.sourceRow,expectedName:x.name,expectedDueDate:x.dueDate,status:paid?'Lunas':'Belum Lunas'}); closeModal();toast(paid?'Tagihan ditandai lunas.':'Status dikembalikan belum lunas.');await refresh();}catch(e){toast(e.message);} }

function openGroup(key){
  const g=(state.data.groups||[]).find(x=>x.key===key); if(!g)return; const rows=(state.data.items||[]).filter(x=>x.groupKey===key).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const scheduled=Number(g.scheduledAmount||rows.reduce((n,x)=>n+itemOriginal(x),0)), paidAmount=Number(g.paidAmount||rows.reduce((n,x)=>n+itemPaid(x),0)), pct=scheduled?Math.min(100,Math.round(paidAmount/scheduled*100)):0;
  const history=paylaterHistoryFor(g.sourceSheet).slice(0,5);
  const scheduleRows=rows.filter(r=>r.status!=='Lunas'&&itemRemaining(r)>0).slice(0,6);
  const scheduleTitle=g.kind==='dynamic'?'6 tagihan belum lunas terdekat':'Jadwal berikutnya';
  const scheduleHtml=scheduleRows.length?`<div class="mini-history-head">${scheduleTitle}</div><div class="mini-history-list">${scheduleRows.map(r=>`<div class="mini-history-row" data-item="${esc(r.id)}"><span>${dateFmt(r.dueDate,{day:'numeric',month:'short',year:'numeric'})}</span><div><b>${money(itemRemaining(r))}</b><small>${statusInfo(r)[0]}${r.paymentStatus==='Sebagian'?` · awal ${money(itemOriginal(r))}`:''}</small></div></div>`).join('')}</div>`:`<div class="mini-history-head">Tidak ada tagihan belum lunas</div>`;
  openModal(g.name,g.provider,`<div class="group-summary"><div><span>Sisa</span><strong>${money(g.outstanding)}</strong><small>${g.paid} lunas${g.partial?` · ${g.partial} sebagian`:''} dari ${g.total} ${g.kind==='dynamic'?'tagihan':'cicilan'}</small></div><div class="group-ring" style="--p:${pct}"><b>${pct}%</b></div></div><div class="detail-progress"><i style="width:${pct}%"></i></div><div class="detail-kpis"><div><span>Sudah dibayar</span><b>${money(paidAmount)}</b></div><div><span>Total jadwal</span><b>${money(scheduled)}</b></div><div><span>Berikutnya</span><b>${g.nextDue?dateFmt(g.nextDue,{day:'numeric',month:'short',year:'numeric'}):'-'}</b></div></div>${scheduleHtml}${g.kind==='dynamic'&&history.length?`<div class="history-block"><h3>Perubahan terbaru</h3>${history.map(h=>`<div class="history-row"><div><b>${h.field==='amount'?'Nominal diperbarui':'Jadwal diperbarui'}</b><small>${h.timestamp}</small></div><span>${h.field==='amount'?amountChangeText(h):esc(h.newValue)}</span></div>`).join('')}</div>`:''}${g.kind==='dynamic'?'<div class="form-actions"><button type="button" id="groupUpdateBtn" class="btn primary">Perbarui tagihan</button></div>':''}`);
  qsa('#modalBody [data-item]').forEach(r=>r.onclick=()=>{closeModal();openItem(r.dataset.item)}); qs('#groupUpdateBtn')?.addEventListener('click',()=>openPaylaterUpdate(g.sourceSheet));
}

function openPaylaterUpdate(sheet='Shopee Paylater'){
  const rows=(state.data.items||[]).filter(x=>x.sourceSheet===sheet).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const history=paylaterHistoryFor(sheet).slice(0,8), last=history[0];
  openModal('Perbarui Tagihan',sheet,`<div class="notice">Masukkan angka terbaru dari aplikasi ${esc(sheet)}. Nilai lama tetap tersimpan dalam histori.${last?`<br><strong>Terakhir diperbarui: ${esc(last.timestamp)}</strong>`:''}</div><div id="paylaterRows" style="margin-top:12px">${rows.map(x=>`<div class="month-edit" data-existing="${esc(x.id)}"><input class="field-inline upd-date" type="date" value="${x.dueDate}"><input class="field-inline upd-amount" inputmode="numeric" value="${itemOriginal(x)}"><span></span></div>`).join('')}</div><button type="button" id="addMonthRow" class="btn secondary">＋ Tambah bulan</button>${history.length?`<div class="history-block"><h3>Riwayat perubahan</h3>${history.map(h=>`<div class="history-row"><div><b>${h.field==='amount'?'Nominal':'Tanggal'}</b><small>${h.timestamp}</small></div><span>${h.field==='amount'?`${money(h.oldValue)} → ${money(h.newValue)} (${amountChangeText(h)})`:esc(h.oldValue)+' → '+esc(h.newValue)}</span></div>`).join('')}</div>`:''}<div class="form-actions"><button type="button" id="savePaylater" class="btn primary">Simpan perubahan</button></div>`);
  qs('#addMonthRow').onclick=()=>{qs('#paylaterRows').insertAdjacentHTML('beforeend',`<div class="month-edit"><input class="field-inline upd-date" type="date"><input class="field-inline upd-amount" inputmode="numeric" placeholder="Nominal"><button type="button" class="btn ghost remove-row">×</button></div>`); bindRemoveRows();}; bindRemoveRows(); qs('#savePaylater').onclick=()=>savePaylater(sheet);
}
function bindRemoveRows(){qsa('.remove-row').forEach(b=>b.onclick=()=>b.closest('.month-edit').remove())}
async function savePaylater(sheet){ const entries=qsa('#paylaterRows .month-edit').map(r=>({id:r.dataset.existing||'',dueDate:r.querySelector('.upd-date').value,amount:Number(String(r.querySelector('.upd-amount').value).replace(/\D/g,''))})).filter(x=>x.dueDate&&x.amount>=0); if(!entries.length)return toast('Isi minimal satu tagihan.'); try{qs('#savePaylater').disabled=true;await api.call('updatePaylater',{sourceSheet:sheet,entries});closeModal();toast('Tagihan diperbarui dan histori disimpan.');await refresh();}catch(e){toast(e.message);qs('#savePaylater').disabled=false;} }


function openVarioPayment(){
  const v=state.data?.vario||{}, history=v.history||[];
  openModal('Vario 160','Pembayaran & riwayat',`<div class="vario-balance"><span>Sisa pokok</span><strong>${money(v.remaining||0)}</strong><small>Terbayar ${money(v.totalPaid||0)} dari ${money(v.original||0)}</small></div>${history.length?`<div class="history-block vario-history"><h3>Riwayat pembayaran</h3>${history.slice().reverse().slice(0,8).map(h=>`<div class="history-row"><div><b>${esc(h.note||'Bayar')}</b><small>${h.date?dateFmt(h.date):'-'}</small></div><span>${money(h.amount)}</span></div>`).join('')}</div>`:''}<div class="section-divider"></div><h3 class="modal-subtitle">Catat pembayaran baru</h3><div class="form-grid"><div class="field"><label>Tanggal pembayaran</label><input id="varioDate" type="date" value="${todayISO()}"></div><div class="field"><label>Jumlah pembayaran</label><input id="varioAmount" inputmode="numeric" placeholder="2000000"></div><div class="field full"><label>Keterangan</label><input id="varioNote" value="Bayar" placeholder="Contoh: Bayar"></div></div><div class="form-actions"><button type="button" id="saveVarioPayment" class="btn primary">Simpan Pembayaran</button></div>`);
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

async function saveReminderSettings(){
  const selected=[]; if(qs('#reminderH7')?.checked)selected.push(7); if(qs('#reminderH3')?.checked)selected.push(3); if(qs('#reminderH1')?.checked)selected.push(1); if(qs('#reminderH0')?.checked)selected.push(0);
  if(!selected.length && qs('#reminderEnabledToggle')?.checked)return toast('Pilih minimal satu waktu pengingat.');
  const payload={REMINDER_DAYS:selected.join(','),REMINDER_HOUR:qs('#reminderHour').value,REMINDER_ENABLED:qs('#reminderEnabledToggle')?.checked?'TRUE':'FALSE'};
  try{await api.call('updateSettings',payload);toast('Pengaturan reminder disimpan.');await refresh();}catch(e){toast(e.message);}
}
function openAccount(){
  openModal('Akun','Pinjam',`<div class="account-profile"><div class="account-avatar">${esc((state.user?.displayName||state.user?.email||'M').charAt(0).toUpperCase())}</div><div><strong>${esc(state.user?.displayName||'Pengguna')}</strong><span>${esc(state.user?.email||'')}</span></div></div><div class="account-meta"><div><span>Sinkron terakhir</span><b>${formatSyncTime()}</b></div><div><span>Notifikasi</span><b>${Notification.permission==='granted'?'Aktif':'Belum aktif'}</b></div><div><span>Tampilan</span><b>${state.theme==='dark'?'Gelap':'Terang'}</b></div></div><div class="form-actions"><button type="button" id="accountLogout" class="btn ghost">Keluar</button></div>`); qs('#accountLogout').onclick=()=>{closeModal();signOut(auth)};
}

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
async function registerFid(fid){ if(!fid)return; await api.call('registerDevice',{fid,platform:navigator.userAgentData?.platform||navigator.platform||'Web',userAgent:navigator.userAgent,permission:Notification.permission,appVersion:'1.6.0'}); }

boot();
