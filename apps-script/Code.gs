/** Pinjam Backend v1.0.1 — bound/unbound Apps Script Web App */
var PINJAM_SPREADSHEET_ID = '1KVQlCh59R4hhjf4jEads3X1i_7-HikwM0bGHK7KpIAM';
var PINJAM_TZ = 'Asia/Makassar';
var PINJAM_FIXED_SHEETS = ['SPinjam','GopayPinjam'];
var PINJAM_DYNAMIC_SHEETS = ['Shopee Paylater','Gopaylater','Tiktok Paylater'];
var PINJAM_ALLOWED_SHEETS = PINJAM_FIXED_SHEETS.concat(PINJAM_DYNAMIC_SHEETS);

function doGet() {
  return json_({ok:true, data:{service:'Pinjam API', version:'1.0.1', status:'online'}});
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var user = verifyFirebaseUser_(req.idToken || '');
    var action = String(req.action || 'bootstrap');
    var payload = req.payload || {};
    var data;
    if (action === 'bootstrap') data = bootstrap_(user, payload);
    else if (action === 'setStatus') data = setStatus_(user, payload);
    else if (action === 'updatePaylater') data = updatePaylater_(user, payload);
    else if (action === 'createLoan') data = createLoan_(user, payload);
    else if (action === 'registerDevice') data = registerDevice_(user, payload);
    else if (action === 'updateSettings') data = updateSettings_(user, payload);
    else if (action === 'addVarioPayment') data = addVarioPayment_(user, payload);
    else throw new Error('Action tidak dikenal: ' + action);
    return json_({ok:true, data:data});
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ok:false, error:String(err && err.message ? err.message : err)});
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() { return SpreadsheetApp.openById(PINJAM_SPREADSHEET_ID); }
function sheet_(name) { var s=ss_().getSheetByName(name); if(!s) throw new Error('Sheet tidak ditemukan: '+name); return s; }
function assertSource_(name) { if (PINJAM_ALLOWED_SHEETS.indexOf(name) < 0) throw new Error('Sumber tidak diizinkan: '+name); return name; }
function fmtDate_(d) { return Utilities.formatDate(d, PINJAM_TZ, 'yyyy-MM-dd'); }
function today_() { return Utilities.formatDate(new Date(), PINJAM_TZ, 'yyyy-MM-dd'); }
function parseDate_(s) { var p=String(s).split('-'); if(p.length!==3) throw new Error('Tanggal tidak valid: '+s); return new Date(Number(p[0]),Number(p[1])-1,Number(p[2]),12,0,0); }
function monthKey_(s) { return String(s).slice(0,7); }
function daysDiff_(from,to) { var a=String(from).split('-').map(Number),b=String(to).split('-').map(Number); return Math.round((Date.UTC(b[0],b[1]-1,b[2])-Date.UTC(a[0],a[1]-1,a[2]))/86400000); }
function isDate_(v){ return Object.prototype.toString.call(v)==='[object Date]' && !isNaN(v.getTime()); }
function asNumber_(v){ if(typeof v==='number') return v; var n=Number(String(v||'').replace(/[^0-9.-]/g,'')); return isFinite(n)?n:0; }
function cleanStatus_(v){ return String(v||'').toLowerCase()==='lunas'?'Lunas':'Belum Lunas'; }
function sha_(s){ var b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s),Utilities.Charset.UTF_8); return Utilities.base64EncodeWebSafe(b).replace(/=+$/,'').slice(0,18); }
function itemId_(sheetName,name,dateStr){ return sha_(sheetName+'|'+String(name).trim()+'|'+dateStr); }
function groupKey_(sheetName,name,kind){ return kind==='dynamic'?sha_('dynamic|'+sheetName):sha_('fixed|'+sheetName+'|'+String(name).trim()); }

function bootstrap_(user) {
  var items=readAllItems_();
  var analytics=analytics_(items);
  return {
    generatedAt:new Date().toISOString(),
    user:{email:user.email,displayName:user.displayName||''},
    items:items,
    groups:groups_(items),
    analytics:analytics,
    vario:readVario_(),
    settings:getSettings_(),
    devices:listDevices_(user.email)
  };
}

function readAllItems_() {
  var out=[];
  PINJAM_ALLOWED_SHEETS.forEach(function(name){
    var sh=sheet_(name), last=Math.max(sh.getLastRow(),3), vals=sh.getRange(3,1,last-2,Math.min(5,sh.getMaxColumns())).getValues();
    var kind=PINJAM_DYNAMIC_SHEETS.indexOf(name)>=0?'dynamic':'fixed';
    vals.forEach(function(r,i){
      var nm=r[0], due=r[1], amount=r[2], status=r[3], period=r[4];
      if(!nm || !isDate_(due) || !isFinite(Number(amount))) return;
      var ds=fmtDate_(due), id=itemId_(name,nm,ds), days=daysDiff_(today_(),ds);
      out.push({
        id:id, groupKey:groupKey_(name,nm,kind), sourceSheet:name, sourceRow:i+3,
        provider:name, name:String(nm), dueDate:ds, amount:Number(amount), status:cleanStatus_(status),
        kind:kind, period:period?String(period):'', daysUntil:days, overdue:cleanStatus_(status)!=='Lunas'&&days<0
      });
    });
  });
  out.sort(function(a,b){return a.dueDate.localeCompare(b.dueDate)||a.provider.localeCompare(b.provider);});
  return out;
}

function groups_(items){
  var map={};
  items.forEach(function(x){
    var key=x.groupKey;
    if(!map[key]) map[key]={key:key,name:x.kind==='dynamic'?x.provider:x.name,provider:x.provider,sourceSheet:x.sourceSheet,kind:x.kind,total:0,paid:0,outstanding:0,nextDue:''};
    var g=map[key]; g.total++; if(x.status==='Lunas') g.paid++; else {g.outstanding+=x.amount;if(!g.nextDue||x.dueDate<g.nextDue)g.nextDue=x.dueDate;}
  });
  return Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return b.outstanding-a.outstanding;});
}

function analytics_(items){
  var now=today_(), current=monthKey_(now), total=0, unpaidCount=0, monthTotal=0, monthPaid=0, monthUnpaid=0, monthCount=0, provider={}, monthly={};
  items.forEach(function(x){
    if(x.status!=='Lunas'){ total+=x.amount; unpaidCount++; provider[x.provider]=(provider[x.provider]||0)+x.amount; monthly[monthKey_(x.dueDate)]=(monthly[monthKey_(x.dueDate)]||0)+x.amount; }
    if(monthKey_(x.dueDate)===current){ monthTotal+=x.amount; monthCount++; if(x.status==='Lunas')monthPaid+=x.amount; else monthUnpaid+=x.amount; }
  });
  var months=Object.keys(monthly).filter(function(m){return m>=current;}).sort().slice(0,12).map(function(m){return {month:m,amount:monthly[m]};});
  var heaviest=null; months.forEach(function(m){if(!heaviest||m.amount>heaviest.amount)heaviest=m;});
  var baseline=monthUnpaid||((months[0]&&months[0].amount)||0), lighter=null;
  if(baseline>0){ for(var i=0;i<months.length;i++){if(months[i].month>current&&months[i].amount<=baseline*.8){lighter=months[i];break;}} }
  return {totalOutstanding:total,unpaidCount:unpaidCount,providersCount:Object.keys(provider).length,monthTotal:monthTotal,monthPaid:monthPaid,monthUnpaid:monthUnpaid,monthCount:monthCount,providerOutstanding:provider,monthlyProjection:months,heaviestMonth:heaviest,lighterMonth:lighter};
}

function readVario_(){
  var sh=sheet_('VARIO160'), last=Math.max(sh.getLastRow(),2), vals=sh.getRange(1,1,last,8).getValues();
  var original=asNumber_(vals[0][7]), remaining=original, totalPaid=0, latest='';
  for(var i=1;i<vals.length;i++){ if(vals[i][4]!==''&&isFinite(Number(vals[i][4]))) totalPaid=Number(vals[i][4]); if(vals[i][5]!==''&&isFinite(Number(vals[i][5]))) remaining=Number(vals[i][5]); if(isDate_(vals[i][1])) latest=fmtDate_(vals[i][1]); }
  if(!original && remaining) original=remaining+totalPaid;
  return {original:original,totalPaid:totalPaid,remaining:remaining,latestPayment:latest};
}

function setStatus_(user,p){
  var source=assertSource_(String(p.sourceSheet||'')), sh=sheet_(source), row=Number(p.sourceRow), wanted=cleanStatus_(p.status);
  if(row<3||row>sh.getMaxRows())throw new Error('Baris sumber tidak valid.');
  var vals=sh.getRange(row,1,1,4).getValues()[0];
  if(String(vals[0])!==String(p.expectedName||''))throw new Error('Data berubah sejak terakhir disinkronkan. Muat ulang aplikasi.');
  if(!isDate_(vals[1])||fmtDate_(vals[1])!==String(p.expectedDueDate||''))throw new Error('Tanggal sumber sudah berubah. Muat ulang aplikasi.');
  var old=cleanStatus_(vals[3]); if(old===wanted)return {changed:false,status:wanted};
  sh.getRange(row,4).setValue(wanted); logHistory_(user.email,'SET_STATUS',source,row,itemId_(source,vals[0],fmtDate_(vals[1])),'status',old,wanted,'PWA');
  return {changed:true,status:wanted};
}

function updatePaylater_(user,p){
  var source=assertSource_(String(p.sourceSheet||'')); if(PINJAM_DYNAMIC_SHEETS.indexOf(source)<0)throw new Error('Sumber ini bukan PayLater dinamis.');
  var entries=Array.isArray(p.entries)?p.entries:[]; if(!entries.length)throw new Error('Tidak ada data pembaruan.');
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var sh=sheet_(source), current=readAllItems_().filter(function(x){return x.sourceSheet===source;}), byId={}; current.forEach(function(x){byId[x.id]=x;}); var changed=0, added=0;
    entries.forEach(function(e){
      var due=String(e.dueDate||''), amount=asNumber_(e.amount); if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||amount<0)throw new Error('Tanggal/nominal PayLater tidak valid.');
      var oldItem=e.id?byId[e.id]:null;
      if(oldItem){
        var row=oldItem.sourceRow, vals=sh.getRange(row,1,1,5).getValues()[0];
        if(String(vals[0])!==oldItem.name)throw new Error('Baris PayLater berubah. Sinkronkan ulang.');
        var oldDue=fmtDate_(vals[1]), oldAmount=asNumber_(vals[2]);
        if(oldDue!==due){ sh.getRange(row,2).setValue(parseDate_(due)); logHistory_(user.email,'UPDATE_PAYLATER',source,row,oldItem.id,'due_date',oldDue,due,'PWA'); changed++; }
        if(oldAmount!==amount){ sh.getRange(row,3).setValue(amount); logHistory_(user.email,'UPDATE_PAYLATER',source,row,oldItem.id,'amount',oldAmount,amount,'PWA'); changed++; }
      } else {
        var newRow=appendScheduleRow_(sh,1);
        var label=nextPaylaterLabel_(source,sh);
        sh.getRange(newRow,1,1,4).setValues([[label,parseDate_(due),amount,'Belum Lunas']]);
        applyScheduleFormat_(sh,newRow);
        var newId=itemId_(source,label,due); logHistory_(user.email,'ADD_PAYLATER',source,newRow,newId,'row','',JSON.stringify({name:label,dueDate:due,amount:amount}),'PWA'); added++;
      }
    });
    SpreadsheetApp.flush(); return {changed:changed,added:added};
  } finally {lock.releaseLock();}
}

function createLoan_(user,p){
  var source=assertSource_(String(p.sourceSheet||'')), name=String(p.name||'').trim(), first=String(p.firstDueDate||''), tenor=Math.max(1,Math.min(60,Number(p.tenor)||0)), amount=asNumber_(p.amount), status=cleanStatus_(p.status);
  if(!name||!/^\d{4}-\d{2}-\d{2}$/.test(first)||!tenor||amount<=0)throw new Error('Data pinjaman belum lengkap.');
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    var sh=sheet_(source), start=appendScheduleRow_(sh,tenor), d=parseDate_(first), rows=[];
    for(var i=0;i<tenor;i++){ var due=new Date(d.getFullYear(),d.getMonth()+i,d.getDate(),12,0,0), label=name; rows.push([label,due,amount,status]); }
    sh.getRange(start,1,tenor,4).setValues(rows); for(var r=0;r<tenor;r++)applyScheduleFormat_(sh,start+r);
    rows.forEach(function(row,i){var ds=fmtDate_(row[1]);logHistory_(user.email,'CREATE_LOAN',source,start+i,itemId_(source,row[0],ds),'row','',JSON.stringify({name:row[0],dueDate:ds,amount:amount,status:status}),'PWA');});
    SpreadsheetApp.flush();return {rowsAdded:tenor,startRow:start};
  } finally {lock.releaseLock();}
}

function appendScheduleRow_(sh,count){
  var last=Math.max(sh.getLastRow(),3), vals=sh.getRange(3,1,last-2,4).getValues(), lastItem=2;
  vals.forEach(function(r,i){if(r[0]&&isDate_(r[1])&&isFinite(Number(r[2])))lastItem=i+3;});
  var target=lastItem+1, needsInsert=false;
  if(target<=sh.getLastRow()){
    var probe=sh.getRange(target,1,1,4).getValues()[0];
    needsInsert=probe.some(function(v){return v!=='';});
  }
  if(needsInsert) sh.insertRowsBefore(target,count); else if(target+count-1>sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(),target+count-1-sh.getMaxRows());
  return target;
}

function applyScheduleFormat_(sh,row){
  var template=Math.max(3,row-1); if(template!==row){ sh.getRange(template,1,1,4).copyTo(sh.getRange(row,1,1,4),SpreadsheetApp.CopyPasteType.PASTE_FORMAT,false); }
  sh.getRange(row,2).setNumberFormat('d mmmm yyyy'); sh.getRange(row,3).setNumberFormat('[$Rp-421] #,##0');
  var rule=SpreadsheetApp.newDataValidation().requireValueInList(['Lunas','Belum Lunas'],true).setAllowInvalid(false).build(); sh.getRange(row,4).setDataValidation(rule);
}

function nextPaylaterLabel_(source,sh){
  var vals=sh.getRange(3,1,Math.max(sh.getLastRow()-2,1),1).getDisplayValues(), max=0, prefix=source==='Shopee Paylater'?'Spaylater':source;
  vals.forEach(function(r){var m=String(r[0]).match(/#\s*(\d+)/);if(m)max=Math.max(max,Number(m[1]));});
  return prefix+' #'+(max+1);
}

function addVarioPayment_(user,p){
  var sh=sheet_('VARIO160'), date=String(p.date||''), amount=asNumber_(p.amount), note=String(p.note||'Bayar Angsuran').trim(); if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||amount<=0)throw new Error('Data pembayaran Vario tidak valid.');
  var last=Math.max(sh.getLastRow(),2), vals=sh.getRange(2,1,last-1,6).getValues(), row=2; for(var i=0;i<vals.length;i++){if(vals[i][1]||vals[i][3])row=i+3;else{row=i+2;break;}}
  var prev=row>2?sh.getRange(row-1,5,1,2).getValues()[0]:[0,asNumber_(sh.getRange('H1').getValue())]; var total=asNumber_(prev[0])+amount, remaining=Math.max(0,asNumber_(sh.getRange('H1').getValue())-total);
  sh.getRange(row,1,1,6).setValues([[row-1,parseDate_(date),note,amount,total,remaining]]); logHistory_(user.email,'VARIO_PAYMENT','VARIO160',row,'vario-'+date,'payment','',amount,'PWA'); return {row:row,remaining:remaining};
}

function logHistory_(actor,action,source,row,itemKey,field,oldValue,newValue,note){
  sheet_('APP_History').appendRow([new Date(),action,source,row,itemKey,field,oldValue,newValue,actor||'',note||'']);
}

function getSettings_(){
  var sh=sheet_('APP_Settings'), last=sh.getLastRow(); if(last<2)return{}; var vals=sh.getRange(2,1,last-1,2).getDisplayValues(), out={}; vals.forEach(function(r){if(r[0])out[r[0]]=r[1];}); return out;
}
function updateSettings_(user,p){
  var allowed=['REMINDER_DAYS','REMINDER_HOUR','REMINDER_ENABLED'], sh=sheet_('APP_Settings'), vals=sh.getRange(2,1,Math.max(sh.getLastRow()-1,1),6).getValues();
  Object.keys(p||{}).forEach(function(k){if(allowed.indexOf(k)<0)return; var idx=-1;for(var i=0;i<vals.length;i++)if(String(vals[i][0])===k){idx=i;break;}if(idx<0)throw new Error('Setting tidak ditemukan: '+k);var old=String(vals[idx][1]), nv=String(p[k]);sh.getRange(idx+2,2).setValue(nv);sh.getRange(idx+2,4).setValue(new Date());logHistory_(user.email,'UPDATE_SETTING','APP_Settings',idx+2,k,'value',old,nv,'PWA');});
  return getSettings_();
}

function registerDevice_(user,p){
  var fid=String(p.fid||'').trim(); if(!fid)throw new Error('FID perangkat kosong.'); var sh=sheet_('APP_Devices'), last=Math.max(sh.getLastRow(),1), vals=last>1?sh.getRange(2,1,last-1,10).getValues():[], row=0;
  for(var i=0;i<vals.length;i++){if(String(vals[i][1])===fid){row=i+2;break;}}
  if(!row)row=sh.getLastRow()+1;
  var deviceId=sha_(user.email+'|'+fid), now=new Date(), created=row<=last&&vals[row-2]&&vals[row-2][4]?vals[row-2][4]:now;
  sh.getRange(row,1,1,10).setValues([[deviceId,fid,String(p.platform||'Web'),String(p.userAgent||'').slice(0,500),created,now,true,String(p.permission||''),String(p.appVersion||''),user.email]]);
  return {deviceId:deviceId,registered:true};
}
function listDevices_(email){
  var sh=sheet_('APP_Devices'), last=sh.getLastRow(); if(last<2)return[]; var vals=sh.getRange(2,1,last-1,10).getValues(); return vals.filter(function(r){return r[6]===true&&String(r[9])===String(email);}).map(function(r){return {deviceId:r[0],platform:r[2],lastSeen:isDate_(r[5])?Utilities.formatDate(r[5],PINJAM_TZ,'yyyy-MM-dd HH:mm'):String(r[5]||''),permission:r[7],appVersion:r[8]};});
}

function verifyFirebaseUser_(idToken){
  if(!idToken)throw new Error('Silakan login.');
  var cache=CacheService.getScriptCache(), key='auth_'+sha_(idToken), cached=cache.get(key); if(cached)return JSON.parse(cached);
  var props=PropertiesService.getScriptProperties(), apiKey=props.getProperty('FIREBASE_WEB_API_KEY'), allowed=String(props.getProperty('ALLOWED_EMAILS')||'').split(',').map(function(x){return x.trim().toLowerCase();}).filter(String);
  if(!apiKey)throw new Error('Backend belum dikonfigurasi: FIREBASE_WEB_API_KEY kosong.');
  var res=UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(apiKey),{method:'post',contentType:'application/json',payload:JSON.stringify({idToken:idToken}),muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw new Error('Sesi Firebase tidak valid atau kedaluwarsa.');
  var body=JSON.parse(res.getContentText()), u=body.users&&body.users[0]; if(!u||!u.email)throw new Error('Akun Firebase tidak dikenali.');
  var email=String(u.email).toLowerCase(); if(allowed.length&&allowed.indexOf(email)<0)throw new Error('Akun ini tidak diizinkan menggunakan Pinjam.');
  var user={email:email,displayName:u.displayName||''}; cache.put(key,JSON.stringify(user),3000); return user;
}

/** Jalankan sekali dari editor setelah mengisi Script Properties. */
function healthCheck(){
  var props=PropertiesService.getScriptProperties(), required=['FIREBASE_WEB_API_KEY','ALLOWED_EMAILS','FCM_PROJECT_ID','FCM_CLIENT_EMAIL','FCM_PRIVATE_KEY'];
  var missing=required.filter(function(k){return !props.getProperty(k);});
  var sheets=['APP_Settings','APP_History','APP_Notifications','APP_Devices'].filter(function(n){return !ss_().getSheetByName(n);});
  var result={spreadsheet:ss_().getName(),timezone:ss_().getSpreadsheetTimeZone(),missingProperties:missing,missingSheets:sheets,items:readAllItems_().length,vario:readVario_()};
  console.log(JSON.stringify(result,null,2)); return result;
}
