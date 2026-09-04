/** Pinjam Reminder Engine v1.0.1 — FCM HTTP v1 + FID targeting */
function installReminderTrigger(){
  ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='runReminderEngine';}).forEach(function(t){ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('runReminderEngine').timeBased().everyHours(1).create();
  return 'Trigger reminder per jam terpasang.';
}

function activeDeviceCount_(){
  var sh=sheet_('APP_Devices'), last=sh.getLastRow(); if(last<2)return 0;
  var vals=sh.getRange(2,1,last-1,10).getValues(), count=0;
  vals.forEach(function(r){if(r[6]===true && r[1])count++;});
  return count;
}

function runReminderEngine(){
  var settings=getSettings_();
  if(settings.REMINDER_ENABLED!=='TRUE')return {skipped:'disabled'};
  if(settings.FCM_CONFIGURED!=='TRUE')return {skipped:'fcm_not_configured'};
  var devices=activeDeviceCount_(); if(!devices)return {skipped:'no_active_devices'};
  var hour=String(settings.REMINDER_HOUR||'08:00'), nowHour=Utilities.formatDate(new Date(),PINJAM_TZ,'HH:mm'); if(nowHour<hour)return {skipped:'before reminder hour'};
  var days=String(settings.REMINDER_DAYS||'7,3,1,0').split(',').map(function(x){return Number(x.trim());}).filter(function(x){return isFinite(x);});
  var today=today_(), items=readAllItems_().filter(function(x){return x.status!=='Lunas';}), sent=0, failed=0;
  items.forEach(function(item){
    var d=daysDiff_(today,item.dueDate); if(days.indexOf(d)<0)return;
    var key=item.id+'|'+item.dueDate+'|H-'+d; if(notificationAlreadySent_(key))return;
    var title=d===0?'Tagihan jatuh tempo hari ini':'Tagihan '+d+' hari lagi';
    var body=item.provider+' · '+item.name+' · '+formatRupiah_(item.amount);
    try{
      reserveNotification_(key,item,d,title);
      var result=sendToActiveDevices_(item,title,body,key);
      if(!result.sent) throw new Error('Tidak ada perangkat aktif yang menerima notifikasi.');
      finishNotification_(key,'SENT',result.sent,''); sent+=result.sent;
    } catch(err){ finishNotification_(key,'ERROR',0,String(err.message||err)); failed++; }
  });
  return {sent:sent,failed:failed,devices:devices};
}

function notificationAlreadySent_(key){
  var sh=sheet_('APP_Notifications'), last=sh.getLastRow(); if(last<2)return false; var vals=sh.getRange(2,1,last-1,7).getDisplayValues();
  for(var i=vals.length-1;i>=0;i--){if(vals[i][0]===key && (vals[i][6]==='SENT'||vals[i][6]==='PENDING'))return true;} return false;
}
function reserveNotification_(key,item,day,title){
  var lock=LockService.getScriptLock();lock.waitLock(10000);try{if(notificationAlreadySent_(key))throw new Error('DUPLICATE_RESERVED');sheet_('APP_Notifications').appendRow([key,item.id,parseDate_(item.dueDate),day,new Date(),'','PENDING',0,title,'']);}finally{lock.releaseLock();}
}
function finishNotification_(key,status,count,error){
  var sh=sheet_('APP_Notifications'), last=sh.getLastRow(); if(last<2)return;
  var vals=sh.getRange(2,1,last-1,10).getValues();
  for(var i=vals.length-1;i>=0;i--){if(String(vals[i][0])===key){sh.getRange(i+2,6,1,5).setValues([[new Date(),status,count,vals[i][8]||'',error||'']]);return;}}
}
function sendToActiveDevices_(item,title,body,key){
  var sh=sheet_('APP_Devices'), last=sh.getLastRow(); if(last<2)return {sent:0}; var vals=sh.getRange(2,1,last-1,10).getValues(), sent=0;
  vals.forEach(function(r,i){
    if(r[6]!==true||!r[1])return;
    try{
      sendFcm_(String(r[1]),title,body,{notificationKey:key,itemId:item.id,url:'./?item='+encodeURIComponent(item.id)}); sent++;
    }catch(err){
      var msg=String(err.message||err);
      if(/404|UNREGISTERED|not found/i.test(msg))sh.getRange(i+2,7).setValue(false); else throw err;
    }
  });
  return {sent:sent};
}
function sendFcm_(fid,title,body,data){
  var props=PropertiesService.getScriptProperties(), project=props.getProperty('FCM_PROJECT_ID'); if(!project)throw new Error('FCM_PROJECT_ID belum diisi.'); var access=getFcmAccessToken_();
  var payload={
    title:String(title||'Pinjam'),
    body:String(body||''),
    notificationKey:String((data&&data.notificationKey)||''),
    itemId:String((data&&data.itemId)||''),
    url:String((data&&data.url)||'./')
  };
  // Data-only: service worker menampilkan satu notifikasi kustom, sehingga tidak dobel.
  var base={data:payload,webpush:{headers:{TTL:'86400'}}};
  var res=postFcm_(project,access,Object.assign({fid:fid},base));
  if(res.code>=200&&res.code<300)return res;
  // Selama masa migrasi Firebase, token field masih dapat menerima FID.
  if(/fid|unknown|invalid argument/i.test(res.text)){res=postFcm_(project,access,Object.assign({token:fid},base));if(res.code>=200&&res.code<300)return res;}
  throw new Error('FCM '+res.code+': '+res.text.slice(0,600));
}
function postFcm_(project,access,message){
  var res=UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(project)+'/messages:send',{method:'post',headers:{Authorization:'Bearer '+access},contentType:'application/json',payload:JSON.stringify({message:message}),muteHttpExceptions:true}); return {code:res.getResponseCode(),text:res.getContentText()};
}
function getFcmAccessToken_(){
  var cache=CacheService.getScriptCache(), cached=cache.get('fcm_access'); if(cached)return cached;
  var props=PropertiesService.getScriptProperties(), email=props.getProperty('FCM_CLIENT_EMAIL'), privateKey=props.getProperty('FCM_PRIVATE_KEY'); if(!email||!privateKey)throw new Error('FCM service account belum dikonfigurasi.');
  privateKey=privateKey.replace(/\\n/g,'\n'); var now=Math.floor(Date.now()/1000), header={alg:'RS256',typ:'JWT'}, claim={iss:email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
  var unsigned=b64url_(JSON.stringify(header))+'.'+b64url_(JSON.stringify(claim)), sig=Utilities.computeRsaSha256Signature(unsigned,privateKey), jwt=unsigned+'.'+Utilities.base64EncodeWebSafe(sig).replace(/=+$/,'');
  var res=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{method:'post',payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt},muteHttpExceptions:true}); if(res.getResponseCode()!==200)throw new Error('OAuth FCM gagal: '+res.getContentText()); var token=JSON.parse(res.getContentText()).access_token; cache.put('fcm_access',token,3300); return token;
}
function b64url_(s){return Utilities.base64EncodeWebSafe(s,Utilities.Charset.UTF_8).replace(/=+$/,'');}
function formatRupiah_(n){return 'Rp'+String(Math.round(Number(n||0))).replace(/\B(?=(\d{3})+(?!\d))/g,'.');}

function sendTestNotification(){
  if(!activeDeviceCount_())throw new Error('Belum ada perangkat aktif. Aktifkan notifikasi dari PWA terlebih dahulu.');
  var item=readAllItems_().filter(function(x){return x.status!=='Lunas';})[0]; if(!item)throw new Error('Tidak ada tagihan belum lunas untuk test.');
  return sendToActiveDevices_(item,'Tes Pinjam','Notifikasi Pinjam berhasil terhubung.','TEST-'+Date.now());
}
