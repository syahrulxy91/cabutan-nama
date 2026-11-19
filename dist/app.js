'use strict';
const appPerfStart = typeof performance === 'undefined' ? null : performance.now();
let authPerfMeasured = false;
if (appPerfStart !== null) performance.mark('cabut-app-start');
const firebase = window.cabutFirebase;
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const switchAccount = document.querySelector('#switch-account');
const switchMode = document.querySelector('#switch-mode');
const brandLink = document.querySelector('.brand');
const participantLink = document.querySelector('#participant-link');
const adminLink = document.querySelector('#admin-link');
const path = {
gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8C5 9 5 3 8 3c2 0 4 5 4 5Z M12 8c7 1 7-5 4-5-2 0-4 5-4 5Z"/>',
user:'<circle cx="12" cy="8" r="3.25"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
dashboard:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',
spark:'<path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',
shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
check:'<path d="m4 12 5 5L20 6"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
back:'<path d="M20 12H5m6 6-6-6 6-6"/>',
close:'<path d="m6 6 12 12M18 6 6 18"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
link:'<path d="M10 13a4 4 0 0 0 6 .5l4-4A4 4 0 0 0 14 4l-2 2m2 5a4 4 0 0 0-6-.5l-4 4A4 4 0 0 0 10 20l2-2"/>',
file:'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6m-6 4h6"/>',
download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
google:'<path fill="#4285F4" stroke="none" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.7 4.7 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4Z"/><path fill="#34A853" stroke="none" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5a6 6 0 0 1-9-3.2H3v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" stroke="none" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.4-2.6Z"/><path fill="#EA4335" stroke="none" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.6A6 6 0 0 1 12 6Z"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path[name]+'</svg>';
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML=icon(el.dataset.icon));
const esc = value => String(value??'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clean = value => String(value).normalize('NFKC').trim().replace(/\s+/g,' ');
const norm = value => clean(value).toLocaleLowerCase('ms-MY');
const confirmed = p => p.confirmed;
const selected = p => p.own;
const confirmationDuration = 10000;
const drawDuration = 2000;
const serverNow = p => Date.now()+p.clockOffset;
const programIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const entrySessionKey = 'cabut-nama-entry';
let account;
let mode;
let participantId;
let loginInProgress = false;
let authenticated = false;
let authProblem = '';
let loading = false;
let loadProblem = '';
let requestVersion = 0;
let catalog = [];
let catalogLoaded = false;
let program;
let adminId = '';
let adminHintTrusted = false;
let nameChoice;
let editedName;
let claimProblem = '';
let focusNewView = false;
let qrScript;
let query = '';
let messageTimer;
let revealTimer;
let countdownTimer;
let retentionTimer;
let drawNeedsCheck = false;
let drawReadRetries = 0;
const drawRetryDelays = [750, 1500, 3000];
const temporaryFailure = error => ['functions/unavailable','functions/deadline-exceeded','functions/internal'].includes(error.code);
const retentionNotice='Nama, e-mel dan keputusan cabutan disimpan selama 30 hari dari tarikh program dicipta. Akses tamat selepas tempoh ini dan data dijadualkan untuk dipadam.';
const retentionDate=new Intl.DateTimeFormat('ms-MY',{dateStyle:'long',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'});

function request(action,p,extra={}){
  return firebase.call(action,{id:p.id,revision:p.revision,responseVersion:2,...extra});
}
function adopt(data){
  const previous=program?.id===data.id&&program.revision===data.revision?program:null;
  program={...previous,...data,clockOffset:data.now-Date.now()};
}
async function refresh({reloadCatalog=false}={}){
  const version=++requestVersion;
  const metricStart='cabut-names-start-'+version;
  if(typeof performance!=='undefined') performance.mark(metricStart);
  const {isAdmin=false,id,invalid}=route();
  const previous=(!isAdmin&&program?.id===id)?program:undefined;
  if(!isAdmin&&!previous){
    drawNeedsCheck=false;
    drawReadRetries=0;
    program=undefined;
  }
  loadProblem='';
  loading=Boolean(account&&mode&&!invalid&&(isAdmin?mode==='coordinator':id));
  render();
  if(!loading){
    focusView();
    if(typeof performance!=='undefined') performance.clearMarks(metricStart);
    return;
  }
  let namesReady=false;
  try {
    let target=id;
    let owned=catalog;
    let data=null;
    if(isAdmin){
      if(reloadCatalog||!catalogLoaded){
        const entry=await firebase.call('coordinator-entry',adminHintTrusted&&adminId?{id:adminId}:{preferredId:adminId||undefined});
        if(version!==requestVersion) return;
        owned=entry.catalog;
        data=entry.program;
        if(data) target=data.id;
      }
      if(version!==requestVersion) return;
      if(!data) target=owned.some(p=>p.id===adminId)?adminId:owned[0]?.id;
    }
    if(!data&&target) data=await firebase.call('get',{id:target,ownerView:isAdmin});
    if(version!==requestVersion||isAdmin!==Boolean(route().isAdmin)||id!==route().id) return;
    if(isAdmin){
      catalog=owned;
      catalogLoaded=true;
      adminId=target??'';
      adminHintTrusted=Boolean(target);
      saveEntrySession();
    }
    if(data){
      if(program?.id!==data.id||program.revision!==data.revision){nameChoice=editedName=undefined;}
      else if(data.taken?.includes(nameChoice)){nameChoice=editedName=undefined;}
      adopt(data);
      drawNeedsCheck=false;
      drawReadRetries=0;
      namesReady=Boolean(Array.isArray(data.names)&&data.names.length&&
        (isAdmin||!data.restricted||(Number.isInteger(data.eligibleRow)&&Boolean(data.names[data.eligibleRow]))));
    }else program=undefined;
  }catch(error){
    if(version!==requestVersion) return;
    if(previous?.own&&(drawNeedsCheck||previous.own.revealAt)&&temporaryFailure(error)){
      program=previous;
      drawNeedsCheck=true;
      loadProblem='Sambungan terganggu. Cuba semak keputusan semula.';
    }else{
      program=undefined;
      drawNeedsCheck=false;
      loadProblem=error.message||'Program tidak dapat dimuatkan.';
    }
  }finally{
    if(version!==requestVersion&&typeof performance!=='undefined') performance.clearMarks(metricStart);
    if(version===requestVersion){
      loading=false;
      render();
      focusView();
      if(typeof performance!=='undefined'){
        if(namesReady){
          const endMark=metricStart+'-ready';
          performance.mark(endMark);
          performance.measure('timeToNamesReady',metricStart,endMark);
          performance.clearMarks(metricStart);
          performance.clearMarks(endMark);
        }else performance.clearMarks(metricStart);
      }
    }
  }
}
function statusPanel(title,detail,actions=''){
  return '<section class="card"><h2>'+esc(title)+'</h2><p>'+esc(detail)+'</p>'+actions+'</section>';
}
function loginPanel(detail,action=''){
  return '<section class="card login-card"><div class="login-mark">'+icon('gift')+'</div>'+
    '<h1>Cabut <span>Nama</span></h1><p>'+esc(detail)+'</p>'+action+'</section>';
}
const refreshButton=()=>'<div class="actions">'+button('Muat semula','refresh',{symbol:'clock'})+'</div>';

function toast(text){
  document.querySelector('#toast').textContent=text;
  clearTimeout(messageTimer);
  messageTimer=setTimeout(()=>document.querySelector('#toast').textContent='',4300);
}
function openDialog(title,body){
  const wasOpen=dialog.open;
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+esc(title)+'</h2><button class="icon-button" data-act="close" aria-label="Tutup">'+icon('close')+'</button></div>'+body;
  dialog.setAttribute('aria-labelledby','dialog-title');
  if(!wasOpen) dialog.showModal();
  else dialog.querySelector('form input:not([type=hidden]), form textarea, form select, form button')?.focus?.();
}
function login(){
  if(loginInProgress) return;
  openDialog('Pilih cara masuk','<div class="demo-options">'+
    button('Pengguna','login-user',{symbol:'user'})+
    button('Penyelaras','login-coordinator',{symbol:'dashboard',cls:'secondary'})+
    '</div><p class="form-error" role="alert"></p>');
}
function saveEntrySession(){
  try {
    if(account&&mode){
      sessionStorage.setItem(entrySessionKey,JSON.stringify({uid:account.uid,mode,participantId,adminId}));
    }else sessionStorage.removeItem(entrySessionKey);
  } catch { /* Log masuk masih boleh digunakan jika storan sesi disekat. */ }
}
function restoreEntrySession(user){
  try {
    const saved=JSON.parse(sessionStorage.getItem(entrySessionKey));
    if(saved?.uid===user?.uid&&(saved?.mode==='user'||saved?.mode==='coordinator')) return saved;
  } catch { /* Pilih semula mod apabila sesi tidak tersedia. */ }
  return {};
}
function setAccount(user){
  if(user&&appPerfStart!==null&&!authPerfMeasured){
    performance.mark('cabut-auth-ready');
    performance.measure('timeToAuthenticated','cabut-app-start','cabut-auth-ready');
    performance.clearMarks('cabut-app-start');
    performance.clearMarks('cabut-auth-ready');
    authPerfMeasured=true;
  }
  const saved=restoreEntrySession(user);
  account=user;
  mode=saved.mode;
  participantId=programIdPattern.test(saved.participantId??'')?saved.participantId:undefined;
  authenticated=true;
  program=undefined;
  adminId=programIdPattern.test(saved.adminId??'')?saved.adminId:'';
  adminHintTrusted=Boolean(adminId);
  catalog=[];
  catalogLoaded=false;
  nameChoice=editedName=undefined;
  claimProblem='';
  query='';
  if(!mode) saveEntrySession();
}
async function enterMode(nextMode,entryButton){
  if(loginInProgress) return;
  const from=route();
  loginInProgress=true;
  const entrySurface=entryButton?app:dialog;
  const choices=entryButton?'.entry-actions button':'.demo-options button';
  const feedbackSelector=entryButton?'.entry-error':'.form-error';
  const feedback=entrySurface.querySelector(feedbackSelector);
  entrySurface.querySelectorAll(choices).forEach(btn=>btn.disabled=true);
  if(feedback) feedback.textContent='';
  try {
    const user=account??(await firebase.signIn()).user;
    if(user.uid!==account?.uid) setAccount(user);
    mode=nextMode;
    if(from.id) participantId=from.id;
    if(nextMode==='coordinator'&&from.id){adminId=from.id;adminHintTrusted=false;}
    saveEntrySession();
    let destination='#/urus';
    if(nextMode==='user') destination=from.invalid?location.hash:participantHash(from.id??participantId,from.step);
    if(dialog.open) dialog.close();
    requestVersion++;
    program=undefined;
    nameChoice=editedName=undefined;
    claimProblem=query='';
    drawNeedsCheck=false;
    drawReadRetries=0;
    focusNewView=true;
    if(location.hash!==destination) location.hash=destination;
    else refresh();
  } catch(error){
    const message=error.code==='auth/popup-closed-by-user'?'Tetingkap log masuk ditutup. Cuba lagi.':
      error.code==='auth/popup-blocked'?'Benarkan tetingkap timbul untuk log masuk dengan Google.':
        (error.message||'Log masuk gagal. Cuba lagi.');
    const activeFeedback=entryButton?app.querySelector(feedbackSelector):
      (dialog.open&&feedback?.isConnected!==false?feedback:null);
    if(activeFeedback) activeFeedback.textContent=message;
    else toast(message);
  } finally {
    loginInProgress=false;
    entrySurface.querySelectorAll(choices).forEach(btn=>btn.disabled=false);
  }
}
async function logout(){
  if(!firebase) return;
  try{await firebase.signOut();}
  catch(error){toast(error.message);}
}

function tag(text,tone='',symbol=''){
  return '<span class="tag '+tone+'">'+(symbol?icon(symbol):'')+text+'</span>';
}
function button(text,action,options={}){
  return '<button type="'+(options.type||'button')+'" class="btn '+(options.cls||'')+'"'+(action?' data-act="'+action+'"':'')+(options.disabled?' disabled':'')+'>'+(options.symbol?icon(options.symbol):'')+esc(text)+'</button>';
}
function note(text,tone='',symbol='shield'){
  return '<div class="note '+tone+'">'+icon(symbol)+'<span>'+esc(text)+'</span></div>';
}
function retentionInfo(p){
  if(!p.expiresAt) return 'Polisi simpanan ialah 30 hari. Tarikh tamat simpanan bagi program terdahulu akan dipaparkan selepas peralihan polisi.';
  const policy=p.retentionMigrated?'Nama, e-mel dan keputusan cabutan disimpan selama 30 hari dari tarikh polisi berkuat kuasa untuk program ini. Akses tamat selepas tempoh ini dan data dijadualkan untuk dipadam.':retentionNotice;
  return policy+' Akses tamat pada '+retentionDate.format(p.expiresAt)+' (waktu Malaysia).';
}
function nameField(label,value='',help=''){
  return '<label class="field">'+label+'<input name="name" type="text" autocomplete="name" placeholder="Contoh: Aina Sofea Binti Azman" required maxlength="130" value="'+esc(value)+'">'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}

const art='<div class="hero-art" aria-hidden="true"><div class="orbit"></div><span class="star s1">✦</span><span class="star s2">✧</span><span class="star s3">✦</span><div class="gift-art"><span class="ribbon"></span><span class="bow"></span></div></div>';
const programsOptions = id => catalog.map(p=>'<option value="'+p.id+'"'+(p.id===id?' selected':'')+'>'+esc(p.title)+'</option>').join('');
function statusFor(p){
  if(!p.names.length) return tag('Menunggu senarai nama','gray','clock');
  if(confirmed(p)===p.names.length) return tag('Sesi selesai','gray','check');
  return tag('Cabutan dibuka','','spark');
}
function participantProgress(p){
  return '<aside class="card session-card"><div class="progress"><div class="progress-head"><h2>Kemajuan sesi</h2><strong>'+confirmed(p)+' / '+p.names.length+' disahkan</strong></div><progress aria-label="Cabutan disahkan" value="'+confirmed(p)+'" max="'+p.names.length+'"></progress></div><details class="instructions"><summary>Cara cabutan</summary><ol class="steps">'+[['user','Log masuk dengan Google'],['gift','Cabut satu nama'],['check','Sahkan nama penerima']].map(([i,t])=>'<li><span class="step-icon" data-icon>'+icon(i)+'</span>'+t+'</li>').join('')+'</ol></details></aside>';
}
function nameDraft(p){
  const e=selected(p);
  if(e) return {name:e.name,row:e.row};
  const row=p.eligibleRow??nameChoice;
  return {name:editedName??p.names[row],row};
}
function reviewName(p){
  const e=selected(p);
  const draft=nameDraft(p);
  if(confirmed(p)===p.names.length&&!e) return '<h2>Sesi telah selesai</h2><p>Semua nama telah dicabut dan disahkan.</p>';
  const options=e
    ? '<option value="'+e.row+'">'+esc(e.name)+'</option>'
    : (p.restricted?'':'<option value="">Pilih daripada senarai</option>')+p.names.map((name,row)=>
      !name||p.taken.includes(row)?'':'<option value="'+row+'"'+(row===draft.row?' selected':'')+'>'+esc(row===draft.row?draft.name:name)+'</option>').join('');
  if(e&&e.status!=='named'){
    return '<h2>Keputusan anda</h2><p>Undian untuk '+esc(e.name)+' telah direkodkan.</p>'+
      '<div class="actions"><a class="btn" href="'+drawLink(p)+'">'+icon('arrow')+'Lihat keputusan</a>'+button('Betulkan nama dalam senarai','edit-name',{cls:'secondary'})+'</div>';
  }
  return '<h2>Semak nama anda</h2><p>Pilih nama anda yang didaftarkan oleh urusetia.</p>'+
    '<label class="field">Pilih nama anda<select id="participant-name" aria-describedby="claim-problem">'+options+'</select></label>'+
    '<p id="claim-problem" class="form-error" role="alert">'+esc(claimProblem)+'</p>'+
    '<div class="actions">'+button('Sahkan nama anda betul','accept-name',{symbol:'check',disabled:!draft.name})+'</div>'+
    (draft.row===undefined?'':'<div class="name-correction"><p>Anda yakin nama anda salah?</p>'+button('EDIT','edit-name',{cls:'secondary'})+'</div>');
}

const participantHash=(id,step)=>'#/peserta'+(id?'/'+encodeURIComponent(id)+(step==='undian'?'/undian':''):'');
const reviewLink=p=>participantHash(p.id);
const drawLink=p=>participantHash(p.id,'undian');
function showResult(p,e){
  const isFinal=e.status==='confirmed';
  const seconds=confirmationSeconds(p,e);
  const download=button('Muat turun keputusan','download',{symbol:'download',cls:'secondary'});
  const confirmButton='<button type="button" class="btn" data-act="confirm">'+icon('check')+'Sahkan nama'+
    ' <span class="confirm-countdown" aria-hidden="true">('+seconds+'s)</span>'+'</button>';
  return '<div class="result draw-result" role="status"><small>Nama penerima hadiah</small><strong>'+esc(e.recipientName??p.names[e.recipient])+'</strong><span>'+esc(e.giverName??e.name)+'</span></div>'+
    (isFinal
      ? '<div class="actions">'+download+'</div>'
      : '<div class="actions">'+confirmButton+download+'</div>'+
        '<p>Nama ini akan disahkan secara automatik selepas 10 saat.</p>');
}
function confirmationSeconds(p,e){
  return Math.max(0,Math.ceil((e.confirmBy-serverNow(p))/1000));
}
function drawAnimation(remaining){
  return '<div class="draw-reveal" role="status" style="--elapsed:'+Math.max(0,drawDuration-remaining)+'ms">'+
    '<div class="draw-prop" aria-hidden="true"><div class="draw-jar"><span></span><span></span></div>'+
    '<div class="draw-slip"><span></span><span></span><span></span></div><div class="draw-rim"></div></div>'+
    '<h2>Sedang mencabut nama…</h2></div>';
}
function drawBody(p){
  const e=selected(p);
  if(drawNeedsCheck){
    if(loading) return '<div class="draw-reveal" role="status"><h2>Memuatkan keputusan…</h2></div>';
    const retryDelay=drawRetryDelays[drawReadRetries];
    if(retryDelay!==undefined){
      revealTimer=setTimeout(()=>{
        drawReadRetries++;
        return refresh();
      },retryDelay);
    }
    return '<h2>Semak keputusan</h2><p role="status">'+esc(loadProblem)+'</p>'+
      '<div class="actions">'+button('Cuba lagi','refresh',{symbol:'clock'})+'</div>';
  }
  if(e.revealAt&&e.recipient===null){
    const remaining=e.revealAt-serverNow(p);
    if(!loading) revealTimer=setTimeout(refresh,remaining>0?remaining+50:500);
    if(remaining>0) return drawAnimation(remaining);
    return '<div class="draw-reveal" role="status"><h2>Memuatkan keputusan…</h2></div>';
  }
  if(e.recipient!==undefined&&e.recipient!==null){
    return '<h2>'+(e.status==='confirmed'?'Cabutan disahkan':'Keputusan cabutan')+'</h2>'+showResult(p,e);
  }
  return '<h2>Syarat undian</h2><ol class="draw-rules">'+
    '<li>Setiap peserta hanya boleh mencabut sekali.</li>'+
    '<li>Padanan dijana secara rawak. Nama sendiri dikecualikan.</li>'+
    '<li>Setiap nama dalam senarai menerima satu hadiah.</li></ol>'+
    note(retentionInfo(p))+
    '<label class="draw-consent"><input id="draw-consent" type="checkbox"><span>Saya bersetuju dengan syarat undian.</span></label>'+
    '<label class="draw-consent"><input id="draw-name-confirmed" type="checkbox"><span>Saya sahkan nama saya <strong>“'+esc(e.name)+'”</strong> adalah betul.</span></label>'+
    '<div class="actions">'+button('Cabut Nama','draw',{symbol:'gift',disabled:true})+'</div>';
}

function programLinkForm(){
  return '<form class="program-join" data-form="join-program">'+
    '<label class="field">Pautan program<input name="link" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>'+
    '<div class="actions">'+button('Buka program','',{type:'submit',symbol:'arrow'})+'</div>'+
    '<p class="form-error" role="alert"></p></form>';
}
function participant(p,showDraw){
  if(!p) return statusPanel('Cabut Nama','Tampal pautan program daripada urusetia atau imbas kod QR.',programLinkForm());
  if(!p.names.length) return '<section class="card"><h2>'+esc(p.title)+'</h2><p>Urusetia belum memuat naik senarai nama. Semak semula melalui pautan ini apabila senarai tersedia.</p></section>';
  if(showDraw) return '<section class="card participant-card draw-card"><div class="draw-top"><p class="draw-program">'+esc(p.title)+'</p>'+button('Tukar akaun','logout',{cls:'secondary switch-account'})+'</div>'+drawBody(p)+
    '<a class="btn quiet draw-back" href="'+reviewLink(p)+'">'+icon('back')+'Kembali</a></section>';
  const own=selected(p);
  const hasVoted=own&&own.status!=='named';
  return '<section class="hero"><div class="hero-copy"><div class="kicker">'+icon('spark')+'Cabutan hadiah</div><h1>'+esc(p.title)+'</h1><p>'+(hasVoted?'Undian anda telah direkodkan.':'Cabut satu nama untuk mengetahui siapa penerima hadiah anda.')+'</p></div>'+art+'</section>'+
    '<div class="grid participant-grid"><section class="card participant-card"><div class="card-head"><div class="main-icon" data-icon>'+icon('gift')+'</div>'+(hasVoted?tag('Sudah mengundi','','check'):statusFor(p))+'</div>'+
    '<div class="acct"><span>'+esc(account.email||account.displayName||'Akaun Google')+'</span></div>'+
    reviewName(p)+'</section>'+participantProgress(p)+'</div>';
}
const importFormats='.pdf,.csv,.docx,.xlsx';
const programField=p=>'<input type="hidden" name="program" value="'+esc(p.id)+'"><input type="hidden" name="revision" value="'+esc(p.revision)+'">';
const titleField=(title='')=>'<label class="field">Nama program<input name="title" maxlength="90" required placeholder="Contoh: Majlis Akhir Tahun" value="'+esc(title)+'"></label>';
function importModal(p){
  openDialog(p?'Muat naik senarai nama':'Cipta program','<form data-form="read-list">'+(p?programField(p):titleField())+
    '<fieldset class="import-method"><legend>Cara masukkan nama</legend>'+
    '<label><input type="radio" name="source" value="file" checked>Muat naik fail</label>'+
    '<label><input type="radio" name="source" value="paste">Tampal manual</label></fieldset>'+
    '<div data-import-file><label class="field">Fail senarai nama<input name="file" type="file" accept="'+importFormats+'" required>'+
    '<small>PDF bertulis atau Word (.docx): satu nama setiap baris atau jadual dengan lajur Nama. CSV atau Excel (.xlsx): letakkan tajuk Nama pada baris pertama. Had 4 MB.</small></label></div>'+
    '<div data-import-paste hidden><label class="field">Tampal senarai nama<textarea name="names" rows="6" placeholder="Aina Sofea&#10;Farid Hakim" required disabled></textarea><small>Masukkan satu nama setiap baris.</small></label></div>'+
    button('Semak senarai','',{type:'submit',cls:'wide',symbol:'arrow'})+'<p class="form-error" role="alert"></p></form>');
}
function importPreview(p,title,names,previousEmails=new Map()){
  openDialog('Semak senarai nama','<p>'+names.length+' baris dikesan. Betulkan ejaan atau padam baris yang tidak diperlukan.</p>'+
    '<form data-form="review-list">'+(p?programField(p):'<input type="hidden" name="title" value="'+esc(title)+'">')+
    '<label class="field">Satu nama setiap baris<textarea name="names" rows="7" required>'+esc(names.join('\n'))+'</textarea></label>'+
    button('Teruskan ke akses peserta','',{type:'submit',cls:'wide',symbol:'arrow'})+'<p class="form-error" role="alert"></p></form>');
  dialog.querySelector('form').rosterEmails=previousEmails;
}
function accessPreview(p,title,names,previousEmails){
  openDialog('Akses peserta','<form data-form="save-list">'+(p?programField(p):'<input type="hidden" name="title" value="'+esc(title)+'">')+
    (p?.names.length?'<p class="list-warning">Senarai baharu membuka pusingan baharu. Rekod cabutan terdahulu akan diarkibkan.</p>':'')+
    '<label class="field">Akses peserta<select name="access"><option value="restricted" selected>Terhad kepada e-mel berdaftar</option>'+
    (p?.restricted?'':'<option value="open">Pautan atau QR umum</option>')+'</select></label>'+
    '<div data-open-warning hidden><p class="list-warning">Sesiapa yang mempunyai pautan dan akaun Google yang disahkan boleh melihat senarai dan memilih nama yang belum diambil.</p>'+
    '<label class="draw-consent"><input type="checkbox" name="openAcknowledged" required disabled> Saya faham cara akses umum berfungsi.</label></div>'+
    '<div data-restricted-emails><p>Semak e-mel Google pada setiap baris sebelum menyimpan. Akaun Gmail peribadi boleh digunakan.</p>'+
    '<details><summary>Tampal e-mel secara pukal</summary><label class="field">Satu e-mel setiap baris<textarea data-email-list rows="4"></textarea></label>'+button('Isikan pada baris nama','fill-roster-emails',{cls:'secondary'})+'</details><ol class="access-roster">'+
    names.map((name,index)=>'<li><input type="hidden" name="rosterName" value="'+esc(name)+'"><label class="field"><span>'+esc(name)+'</span><input name="rosterEmail" type="email" inputmode="email" maxlength="254" required aria-label="E-mel Google untuk '+esc(name)+'" value="'+esc(previousEmails?.get(name))+'"><small id="email-error-'+index+'" class="form-error"></small></label></li>').join('')+'</ol></div>'+
    '<div class="actions">'+button('Kembali ke senarai','review-roster',{cls:'secondary'})+button(p?'Simpan senarai':'Cipta program','',{type:'submit',symbol:'check'})+'</div><p class="form-error" role="alert"></p></form>');
}

function rosterEmails(form,data,names){
  const inputs=Array.from(form.querySelectorAll('[name=rosterEmail]'));
  const emails=data.getAll('rosterEmail').map(value=>value.trim().toLowerCase());
  const counts=new Map();
  for(const email of emails) counts.set(email,(counts.get(email)??0)+1);
  let firstError;
  inputs.forEach((input,index)=>{
    const email=emails[index]??'';
    const message=!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)?'Masukkan e-mel Google yang sah.':
      counts.get(email)>1?'E-mel ini digunakan pada lebih daripada satu baris.':'';
    form.querySelector('#email-error-'+index).textContent=message;
    input.setAttribute('aria-describedby','email-error-'+index);
    if(message){input.setAttribute('aria-invalid','true');firstError??=input;}
    else input.removeAttribute('aria-invalid');
  });
  if(firstError||emails.length!==names.length){
    firstError?.focus();
    throw new Error('Semak e-mel pada baris yang ditandakan.');
  }
  return emails;
}
function renameModal(p){
  openDialog('Edit nama program','<form data-form="rename">'+programField(p)+titleField(p.title)+
    button('Simpan nama program','',{type:'submit',cls:'wide',symbol:'check'})+'<p class="form-error" role="alert"></p></form>');
}
function records(p,search){
  const rows=p.records.filter(e=>norm([e.giverName??e.name,e.email,e.recipient===null?'':e.recipientName??p.names[e.recipient]].join(' ')).includes(norm(search)));
  if(!rows.length) return '<div class="empty">'+(search?'Tiada rekod sepadan dengan carian.':'Rekod akan dipaparkan apabila peserta membuat cabutan.')+'</div>';
  return '<div class="table-wrap" tabindex="0" aria-label="Jadual rekod cabutan"><table role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader">Peserta</th><th role="columnheader">Penerima</th><th role="columnheader">Status</th></tr></thead><tbody role="rowgroup">'+
    rows.map(e=>'<tr role="row"><td role="cell" class="record-person"><div>'+esc(e.giverName??e.name)+'</div><small>'+esc(e.email)+'</small></td><td role="cell" class="record-recipient"><span class="record-label" aria-hidden="true">Penerima hadiah</span><div>'+(e.recipient===null?'—':esc(e.recipientName??p.names[e.recipient]))+'</div></td><td role="cell" class="record-status">'+
      (e.status==='confirmed'?tag('Disahkan','','check'):tag(e.status==='waiting'?'Padanan akhir':'Belum disahkan','gold','clock'))+'</td></tr>').join('')+
    '</tbody></table></div>';
}
function programLink(p){
  const url=new URL(reviewLink(p),location.origin+location.pathname);
  url.searchParams.set('program',p.id);
  return url.href;
}
function qrGraphic(url){
  if(!window.drawQrModules) return '<span>Memuatkan kod QR…</span>';
  try {
    const modules=window.drawQrModules(url);
    const d=modules.flatMap((row,y)=>row.map((on,x)=>on?'M'+(x+4)+' '+(y+4)+'h1v1h-1z':'')).join('');
    const size=modules.length+8;
    return '<svg viewBox="0 0 '+size+' '+size+'" aria-label="Kod QR program" role="img" shape-rendering="crispEdges"><path fill="currentColor" d="'+d+'"/></svg>';
  } catch {return '<span>QR tidak tersedia</span>';}
}
function mountQr(p){
  if(!p||window.drawQrModules) return;
  const target=app.querySelector('.share-card .qr');
  if(!target) return;
  qrScript??=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='qr.js';
    script.onload=resolve;
    script.onerror=()=>{script.remove();reject(new Error('Kod QR tidak dapat dimuatkan.'));};
    document.head.append(script);
  }).catch(error=>{qrScript=undefined;throw error;});
  qrScript.then(()=>{if(target.isConnected)target.innerHTML=qrGraphic(programLink(p));},()=>{
    if(target.isConnected)target.textContent='Kod QR tidak tersedia. Gunakan pautan program.';
  });
}
function admin(p){
  const header='<div class="admin-title"><h1>Panel urusetia</h1><p>Urus program, kongsi pautan penyertaan dan semak rekod cabutan.</p></div>';
  if(!p) return header+statusPanel('Program anda','Cipta program pertama dan masukkan senarai nama.','<div class="actions">'+button('Cipta program','create',{symbol:'plus'})+button('Muat semula program','refresh-programs',{cls:'secondary',symbol:'clock'})+'</div>');
  const count=confirmed(p), url=programLink(p);
  return header+'<div class="program-choice"><label class="field">Program<select id="admin-program">'+programsOptions(p.id)+'</select></label><div class="program-actions">'+button('Cipta program','create',{symbol:'plus'})+button('Edit nama program','rename',{cls:'secondary'})+button('Reset undian','reset',{cls:'danger-outline',disabled:!p.names.length})+'</div></div>'+
    '<div class="stats"><div class="stat"><strong>'+p.names.length+'</strong><span>Jumlah penerima</span></div><div class="stat"><strong>'+count+'</strong><span>Disahkan</span></div><div class="stat"><strong>'+(p.names.length-count)+'</strong><span>Belum selesai</span></div></div>'+
    note(retentionInfo(p))+
    '<div class="grid admin-grid"><div class="admin-tools"><section class="card share-card"><h2>Kongsi penyertaan</h2><p>'+(p.restricted?'Penyertaan terhad kepada e-mel yang didaftarkan.':'Pemegang pautan dengan akaun Google yang disahkan boleh melihat senarai dan memilih nama.')+'</p><div class="qr">'+qrGraphic(url)+'</div><label class="field">Pautan program<input type="url" value="'+esc(url)+'" readonly></label><div class="actions">'+button('Salin pautan','copy',{symbol:'link',cls:'secondary'})+'<a class="btn quiet" href="'+esc(url)+'">Buka paparan peserta</a></div></section>'+
    '<section class="card"><details class="advanced-tools"><summary>Pengurusan lanjutan</summary><div class="actions">'+button('Reset senarai nama','reset-list',{cls:'danger-outline',disabled:!p.names.length})+'</div><div class="actions">'+button('Ujian padanan','acceptance-test',{cls:'secondary',symbol:'check',disabled:p.names.length<2})+'</div></details></section></div>'+
    '<div class="admin-records"><section class="card"><h2>Senarai penerima</h2><div class="actions">'+button('Muat naik senarai nama','import-list',{symbol:'file'})+'</div>'+
    (p.names.length?'<details class="admin-name-list"><summary>Lihat '+p.names.length+' nama</summary><ul>'+p.names.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul></details>':'<p>Belum ada nama. Muat naik fail untuk membuka cabutan.</p>')+'</section>'+
    '<section class="card"><div class="card-head"><h2>Rekod cabutan</h2>'+statusFor(p)+'</div><label class="field">Cari rekod<input id="record-search" type="search" placeholder="Nama peserta, e-mel atau penerima" value="'+esc(query)+'"></label><div id="records">'+records(p,query)+'</div><div class="actions">'+button('Muat semula rekod','refresh',{cls:'secondary',symbol:'clock'})+'</div></section></div></div>';
}
function resetModal(p,resetList=false){
  const detail=resetList
    ? 'Semua nama dan rekod cabutan untuk <strong>'+esc(p.title)+'</strong> akan dikosongkan. Muat naik senarai baharu untuk membuka semula cabutan.'
    : 'Semua cabutan untuk <strong>'+esc(p.title)+'</strong>, termasuk yang belum disahkan, akan dikosongkan. Peserta boleh mencabut semula menggunakan pautan yang sama.';
  openDialog(resetList?'Reset senarai nama?':'Reset undian?','<p>'+detail+'</p><p>Pusingan lama akan diarkibkan sehingga tamat tempoh simpanan program.</p><form data-form="'+(resetList?'reset-list':'reset')+'">'+programField(p)+'<div class="actions reset-actions">'+button('Batal','close',{cls:'secondary'})+button(resetList?'Ya, reset senarai nama':'Ya, reset undian','',{type:'submit',cls:'danger'})+'</div><p class="form-error" role="alert"></p></form>');
  dialog.querySelector('form [data-act="close"]').focus();
}
function route(url=location){
  const hash=url.hash;
  if(hash==='#/urus'||hash==='#/urus/') return {isAdmin:true};
  const match=/^#\/?peserta(?:\/([^/]+)(?:\/(undian))?)?\/?$/.exec(hash);
  if(hash&&!match) return {invalid:true};
  const id=match?.[1]??new URLSearchParams(url.search).get('program')??undefined;
  if(id!==undefined&&!programIdPattern.test(id)) return {invalid:true};
  return {id,step:match?.[2]};
}
function rememberParticipantRoute(){
  const {id,step}=route();
  if(!id) return;
  participantId=id;
  const url=new URL(location.href);
  url.searchParams.set('program',id);
  url.hash=participantHash(id,step);
  if(location.href!==url.href) history.replaceState(null,'',url);
  if(account&&mode) saveEntrySession();
}
function focusView(){
  if(!focusNewView) return;
  focusNewView=false;
  const heading=app.querySelector('h1, h2');
  heading?.setAttribute('tabindex','-1');
  heading?.focus?.({preventScroll:true});
}
function render(){
  clearTimeout(revealTimer);
  clearInterval(countdownTimer);
  clearTimeout(retentionTimer);
  const {isAdmin,step,invalid}=route();
  const p=program;
  const coordinator=Boolean(account&&mode==='coordinator');
  const showDraw=Boolean(account&&mode&&!isAdmin&&!invalid&&step==='undian'&&p?.own);
  document.body.classList.toggle('login-view',!account||!mode);
  document.body.classList.toggle('draw-view',showDraw);
  document.body.classList.toggle('coordinator-mode',coordinator);
  document.body.classList.toggle('admin-view',coordinator&&isAdmin);
  switchAccount.hidden=!account;
  switchMode.hidden=!account||!mode||showDraw;
  adminLink.hidden=!coordinator;
  const participantTarget=participantHash(isAdmin&&coordinator?adminId||participantId:participantId);
  participantLink.href=brandLink.href=participantTarget;
  if(coordinator&&isAdmin) adminLink.setAttribute('aria-current','page');
  else adminLink.removeAttribute('aria-current');
  if(!isAdmin) participantLink.setAttribute('aria-current','page');
  else participantLink.removeAttribute('aria-current');
  if(authProblem){
    app.innerHTML=loginPanel(authProblem);
    return;
  }
  if(!authenticated||loading&&!p){
    app.innerHTML=!account||!mode?loginPanel('Sedang memuatkan…'):statusPanel('Cabut Nama','Sedang memuatkan…');
    return;
  }
  const entryButton='<div class="actions">'+button(account?'Pilih cara masuk':'Log masuk','login',{symbol:'google'})+'</div>';
  if(!account||!mode){
    const direct=Boolean(!isAdmin&&!invalid&&route().id);
    const action=direct?'<div class="actions entry-actions">'+
      button(account?'Teruskan ke program':'Log masuk dengan Google','login-participant',{symbol:'google',disabled:loginInProgress})+
      button('Masuk sebagai Penyelaras','login-coordinator',{cls:'secondary',disabled:loginInProgress})+
      '</div><p class="entry-error form-error" role="alert"></p>':entryButton;
    app.innerHTML=loginPanel(isAdmin?'Pilih Penyelaras untuk membuka panel urusetia.':'Gunakan akaun Google untuk menyertai cabutan hadiah.',action);
    return;
  }
  if(isAdmin&&!coordinator){
    app.innerHTML=statusPanel('Panel urusetia','Anda sedang menggunakan mod Pengguna. Pilih Penyelaras untuk membuka panel urusetia.',
      entryButton+'<a class="btn quiet" href="'+esc(participantTarget)+'">Kembali ke Peserta</a>');
    return;
  }
  if(invalid||(loadProblem&&(!showDraw||!drawNeedsCheck))){
    app.innerHTML=statusPanel('Cabut Nama',invalid?'Pautan program tidak sah. Semak pautan atau minta QR baharu daripada urusetia.':loadProblem,
      (invalid?'':refreshButton())+(isAdmin?'':programLinkForm()));
    return;
  }
  const active=document.activeElement;
  const recoverFocus=!focusNewView&&app.contains?.(active)&&active.id;
  app.innerHTML=isAdmin?admin(p):participant(p,showDraw);
  if(p?.expiresAt) retentionTimer=setTimeout(()=>{
    if(program!==p) return;
    if(p.expiresAt>serverNow(p)) return render();
    if(dialog.open) dialog.close();
    requestVersion++;
    loading=false;
    program=undefined;
    catalog=catalog.filter(entry=>entry.id!==p.id);
    if(isAdmin) refresh({reloadCatalog:true});
    else{
      loadProblem='Tempoh simpanan 30 hari untuk program ini telah tamat.';
      render();
    }
  },Math.max(0,Math.min(p.expiresAt-serverNow(p),2_147_483_647)));
  if(recoverFocus) document.getElementById(recoverFocus)?.focus({preventScroll:true});
  if(isAdmin) mountQr(p);
  const seconds=app.querySelector('.confirm-countdown');
  if(seconds&&p?.own&&!loading){
    countdownTimer=setInterval(()=>{
      const remaining=confirmationSeconds(p,p.own);
      seconds.textContent='('+remaining+'s)';
      if(!remaining){
        clearInterval(countdownTimer);
        refresh();
      }
    },150);
  }
}

function downloadResult(p,e){
  if(!e||!['pending','confirmed'].includes(e.status)) return;
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d');
  const width=880, pad=62;
  function lines(text,weight,size){
    context.font=weight+' '+size+'px system-ui, sans-serif';
    const result=[''];
    for(const word of text.split(' ')){
      const last=result.length-1;
      const joined=result[last]?result[last]+' '+word:word;
      if(context.measureText(joined).width<=width-pad*2){result[last]=joined;continue;}
      if(result[last]) result.push('');
      for(const char of word){
        const j=result.length-1;
        if(context.measureText(result[j]+char).width>width-pad*2) result.push(char);
        else result[j]+=char;
      }
    }
    return result;
  }
  const fields=[
    ['CABUT NAMA','700',24,'#30644e',34,10],
    [p.title,'650',40,'#17382e',51,48],
    ['PENERIMA HADIAH','700',23,'#30644e',32,9],
    [e.recipientName??p.names[e.recipient],'750',53,'#17382e',63,36],
    ['Dicabut oleh '+(e.giverName??e.name),'500',27,'#50665a',38,21],
    [e.status==='confirmed'?'Cabutan disahkan':'Cabutan belum disahkan','650',24,'#30644e',34,0]
  ].map(([value,weight,size,color,lineHeight,gap])=>({text:lines(value,weight,size),weight,size,color,lineHeight,gap}));
  canvas.width=width;
  canvas.height=pad*2+fields.reduce((sum,f)=>sum+f.text.length*f.lineHeight+f.gap,0);
  context.fillStyle='#eaf3e7';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle='#174937';
  context.fillRect(0,0,canvas.width,14);
  let y=pad;
  context.textBaseline='top';
  for(const field of fields){
    context.font=field.weight+' '+field.size+'px system-ui, sans-serif';
    context.fillStyle=field.color;
    for(const line of field.text){
      context.fillText(line,pad,y);
      y+=field.lineHeight;
    }
    y+=field.gap;
  }
  const image=canvas.toDataURL('image/png');
  openDialog('Simpan keputusan','<img class="download-preview" alt="Imej keputusan cabutan" src="'+image+'"><div class="actions"><a class="btn" href="'+image+'" download="keputusan-cabutan.png">'+icon('download')+'Simpan PNG</a></div>');
}
async function acceptanceTest(p){
  const result=await request('acceptance',p);
  openDialog('Ujian penerimaan','<div class="result acceptance-result"><strong>'+result.passed+' / 12 simulasi lulus</strong><p>'+result.count+' penerima unik. Padanan tersimpan turut disemak.</p></div>');
}
function canDraw(){
  return app.querySelector('#draw-consent')?.checked&&app.querySelector('#draw-name-confirmed')?.checked;
}
switchAccount.addEventListener('click',logout);
switchMode.addEventListener('click',login);

app.addEventListener('click',async ev=>{
  const btn=ev.target.closest('[data-act]');
  if(!btn||btn.disabled) return;
  const action=btn.dataset.act;
  const p=program;
  const version=requestVersion;
  try {
    if(action==='login') return login();
    if(action==='login-participant') return enterMode('user',btn);
    if(action==='login-coordinator') return enterMode('coordinator',btn);
    if(action==='logout') return await logout();
    if((action==='refresh'||action==='refresh-programs')&&!loading){
      drawReadRetries=0;
      return await refresh({reloadCatalog:action==='refresh-programs'});
    }
    if(route().isAdmin&&account&&mode==='coordinator'){
      if(action==='create') return importModal();
      if(!p) return;
      if(action==='import-list') return importModal(p);
      if(action==='rename') return renameModal(p);
      if(action==='acceptance-test'){
        btn.disabled=true;
        return await acceptanceTest(p);
      }
      if(action==='reset'||action==='reset-list') return resetModal(p,action==='reset-list');
      if(action==='copy'){
        try{
          await navigator.clipboard.writeText(programLink(p));
          toast('Pautan program disalin.');
        }catch{
          openDialog('Pautan program','<label class="field">Salin pautan ini<input readonly value="'+esc(programLink(p))+'"></label>');
          dialog.querySelector('input').select();
        }
        return;
      }
    }
    if(!p||!account||loading) return;
    if(action==='accept-name'){
      const draft=nameDraft(p);
      if(!draft.name) return;
      btn.disabled=true;
      if(!p.own){
        const claim={row:draft.row,expectedName:p.names[draft.row]};
        if(editedName!==undefined) claim.name=editedName;
        const data=await request('claim',p,claim);
        if(version!==requestVersion) return;
        adopt(data);
      }
      claimProblem='';
      nameChoice=editedName=undefined;
      if(location.hash===drawLink(p)) render();
      else location.hash=drawLink(p);
    }
    if(action==='edit-name'){
      const draft=nameDraft(p);
      if(draft.row===undefined) return;
      const help=p.own?.revealAt?'Nama pada rekod cabutan asal kekal. Pembetulan ini digunakan pada senarai semasa.':'';
      return openDialog('Edit nama anda','<form data-form="edit-name">'+nameField('Nama penuh',draft.name,help)+button('Simpan nama','',{type:'submit',cls:'wide',symbol:'check'})+'<p class="form-error" role="alert"></p></form>');
    }
    if(action==='download') return downloadResult(p,selected(p));
    if(action==='draw'||action==='confirm'){
      if(action==='draw'&&!canDraw()) return;
      btn.disabled=true;
      if(route().step!=='undian') return;
      const data=await request(action,p,action==='draw'?{agreed:true,confirmedName:p.own.name}:{});
      if(version===requestVersion&&program?.id===data.id&&program.revision===data.revision){
        adopt(data);
        if(action==='confirm') await refresh();
        else render();
      }
    }
  }catch(error){
    if(action==='accept-name'&&version===requestVersion&&['functions/already-exists','functions/failed-precondition'].includes(error.code)){
      claimProblem=error.code==='functions/already-exists'?'Nama sudah dipilih. Pilih semula daripada senarai terkini.':'Senarai telah berubah. Semak nama anda semula.';
      nameChoice=editedName=undefined;
      await refresh();
      app.querySelector('#participant-name')?.focus?.();
    }else if(action==='draw'&&version===requestVersion&&temporaryFailure(error)){
      drawNeedsCheck=true;
      await refresh();
    }else if(version===requestVersion) toast(error.message);
  }finally{
    if(btn.isConnected&&action!=='draw') btn.disabled=false;
    if(btn.isConnected&&action==='draw') btn.disabled=!canDraw();
  }
});
dialog.addEventListener('click',ev=>{
  const action=ev.target.closest('[data-act]')?.dataset.act;
  if(action==='close') dialog.close();
  if(action==='fill-roster-emails'){
    const form=ev.target.closest('form');
    const emails=form.querySelector('[data-email-list]').value.trim().split(/\r\n|\n|\r/).map(email=>email.trim());
    const inputs=Array.from(form.querySelectorAll('[name=rosterEmail]'));
    const feedback=form.querySelector('p.form-error');
    if(emails.length!==inputs.length||emails.some(email=>!email)){
      feedback.textContent='Tampal satu e-mel bagi setiap nama, tanpa baris kosong.';
      return;
    }
    inputs.forEach((input,index)=>{
      input.value=emails[index];
      input.removeAttribute('aria-invalid');
      form.querySelector('#email-error-'+index).textContent='';
    });
    feedback.textContent='';
    inputs[0]?.focus();
  }
  if(action==='review-roster'){
    const form=ev.target.closest('form');
    const data=new FormData(form);
    const hasTarget=data.get('program');
    if(!hasTarget||program?.id===hasTarget&&program.revision===data.get('revision')){
      const names=data.getAll('rosterName');
      const emails=Array.from(form.querySelectorAll('[name=rosterEmail]'),input=>input.value);
      importPreview(hasTarget?program:null,data.get('title'),names,new Map(names.map((name,index)=>[name,emails[index]])));
    }
  }
  if(action==='login-user'||action==='login-coordinator'){
    enterMode(action==='login-user'?'user':'coordinator');
  }
});

dialog.addEventListener('change',ev=>{
  if(ev.target.name==='access'){
    const form=ev.target.form;
    const field=form.querySelector('[data-restricted-emails]');
    const restricted=ev.target.value==='restricted';
    field.hidden=!restricted;
    for(const input of field.querySelectorAll('[name=rosterEmail]')) input.disabled=!restricted;
    const warning=form.querySelector('[data-open-warning]');
    warning.hidden=restricted;
    const acknowledgement=warning.querySelector('input');
    acknowledgement.disabled=restricted;
    acknowledgement.checked=false;
    return;
  }
  if(ev.target.name!=='source') return;
  const form=ev.target.form;
  const paste=ev.target.value==='paste';
  form.querySelector('[data-import-file]').hidden=paste;
  form.querySelector('[data-import-paste]').hidden=!paste;
  form.elements.file.disabled=paste;
  form.elements.names.disabled=!paste;
  form.querySelector('.form-error').textContent='';
});
app.addEventListener('change',ev=>{
  if(ev.target.matches('.draw-consent input')){
    app.querySelector('[data-act="draw"]').disabled=!canDraw();
    return;
  }
  if(ev.target.id==='participant-name'){
    nameChoice=ev.target.value===''?undefined:Number(ev.target.value);
    editedName=undefined;
    claimProblem='';
    render();
    document.querySelector('#participant-name')?.focus?.();
    return;
  }
  if(ev.target.id!=='admin-program') return;
  adminId=ev.target.value;
  adminHintTrusted=true;
  program=undefined;
  query='';
  refresh();
});
app.addEventListener('input',ev=>{
  if(ev.target.id!=='record-search') return;
  query=ev.target.value;
  document.querySelector('#records').innerHTML=records(program,query);
});
async function submit(ev){
  const form=ev.target.closest('[data-form]');
  if(!form) return;
  ev.preventDefault();
  const btn=form.querySelector('[type="submit"]');
  if(btn.disabled||!account) return;
  const data=new FormData(form);
  const action=form.dataset.form;
  const p=program;
  const version=requestVersion;
  const target=data.get('program');
  btn.disabled=true;
  try {
    if(target&&(p?.id!==target||p.revision!==data.get('revision'))) throw new Error('Program telah berubah. Buka dialog semula.');
    if(action==='edit-name'&&p&&!route().isAdmin){
      const name=clean(data.get('name'));
      if(!name) throw new Error('Masukkan nama penuh anda.');
      if(p.own){
        const updated=await request('edit',p,{name});
        if(version!==requestVersion) return;
        adopt(updated);
      }else editedName=name;
      dialog.close();render();return;
    }
    if(!route().isAdmin||mode!=='coordinator') return;
    if(action==='read-list'){
      const title=target?p.title:clean(data.get('title')??'');
      if(!title) throw new Error('Masukkan nama program.');
      const names=data.get('source')==='paste'?splitNames(data.get('names')):await (await import('./roster-import.mjs')).readNames(data.get('file'));
      if(names.length<2) throw new Error('Masukkan sekurang-kurangnya dua nama penerima.');
      if(dialog.open&&form.isConnected) importPreview(target?p:null,title,names);
      return;
    }
    if(action==='review-list'){
      accessPreview(target?p:null,data.get('title'),validateNames(splitNames(data.get('names'))),form.rosterEmails);
      return;
    }
    if(action==='save-list'){
      const names=validateNames(data.getAll('rosterName'));
      const restricted=data.get('access')==='restricted';
      if(!restricted&&data.get('openAcknowledged')!=='on') throw new Error('Sahkan pilihan akses umum sebelum menyimpan.');
      const emails=restricted?rosterEmails(form,data,names):undefined;
      if(target) await request(restricted?'replace-restricted':'replace',p,{names,emails});
      else{
        const details=JSON.stringify([data.get('title'),names,emails]);
        if(form.dataset.submission!==details){
          form.dataset.submission=details;
          form.dataset.operationId=crypto.randomUUID();
        }
        const created=await firebase.call(restricted?'create-restricted':'create',{title:data.get('title'),names,emails,operationId:form.dataset.operationId});
        if(version!==requestVersion) return;
        adminId=created.id;
      }
    }else if(action==='rename'&&target) await request('rename',p,{title:data.get('title')});
    else if((action==='reset'||action==='reset-list')&&target) await request(action,p);
    else return;
    if(version!==requestVersion) return;
    query='';
    dialog.close();
    await refresh({reloadCatalog:action==='rename'||action==='save-list'&&!target});
    toast('Perubahan disimpan.');
  }catch(error){
    form.querySelector('p.form-error').textContent=error.message;
  }finally{btn.disabled=false;}
}
dialog.addEventListener('submit',submit);
app.addEventListener('submit',ev=>{
  const form=ev.target.closest('[data-form="join-program"]');
  if(!form) return;
  ev.preventDefault();
  let destination;
  try {
    const url=new URL(form.elements.link.value.trim(),location.href);
    if(url.protocol==='https:'||url.protocol==='http:') destination=route(url);
  } catch { /* Paparkan mesej semakan pautan di bawah. */ }
  if(!destination?.id){
    form.querySelector('.form-error').textContent='Gunakan pautan peserta yang dikongsi oleh urusetia.';
    return;
  }
  history.replaceState(null,'',programLink({id:destination.id}));
  rememberParticipantRoute();
  program=undefined;
  nameChoice=editedName=undefined;
  claimProblem='';
  focusNewView=true;
  refresh();
});
window.addEventListener('hashchange',()=>{
  if(dialog.open) dialog.close();
  program=undefined;
  nameChoice=editedName=undefined;
  claimProblem='';
  focusNewView=true;
  rememberParticipantRoute();
  refresh({reloadCatalog:route().isAdmin});
  window.scrollTo(0,0);
});


const splitNames=text=>String(text??'').split(/\r\n|\n|\r/).map(clean).filter(Boolean);
function validateNames(lines){
  const names=lines.map(clean).filter(Boolean);
  if(names.length<2||names.length>250) throw new Error('Masukkan 2 hingga 250 nama penerima.');
  if(names.some(n=>n.length>130)) throw new Error('Pendekkan nama penerima yang melebihi 130 aksara.');
  if(new Set(names.map(norm)).size!==names.length) throw new Error('Ada nama penerima yang sama. Bezakan nama tersebut dalam fail dan muat naik semula.');
  return names;
}
if(firebase){
  firebase.observe(user=>{
    if(loginInProgress||(authenticated&&user?.uid===account?.uid)) return;
    setAccount(user);
    if(dialog.open) dialog.close();
    rememberParticipantRoute();
    refresh();
  });
}else{
  authProblem='Modul Firebase tidak dimuatkan. Bina aplikasi dahulu.';
  render();
}
