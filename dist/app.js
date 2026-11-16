'use strict';
const firebase = window.cabutFirebase;
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const switchAccount = document.querySelector('#switch-account');
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
let account;
let authenticated = false;
let authProblem = '';
let loading = false;
let loadProblem = '';
let requestVersion = 0;
let catalog = [];
let program;
let adminId = '';
let nameChoice;
let editedName;
let query = '';
let messageTimer;
let revealTimer;
let countdownTimer;

function request(action,p,extra={}){
  return firebase.call(action,{id:p.id,revision:p.revision,...extra});
}
function adopt(data){
  program={...data,clockOffset:data.now-Date.now()};
}
async function refresh(){
  const version=++requestVersion;
  const {isAdmin,id}=route();
  loadProblem='';
  loading=Boolean(account&&(isAdmin||id));
  render();
  if(!loading) return;
  try {
    let target=id;
    let owned=[];
    if(isAdmin){
      owned=await firebase.call('list');
      target=owned.some(p=>p.id===adminId)?adminId:owned[0]?.id;
    }
    const data=target?await firebase.call('get',{id:target,ownerView:isAdmin}):null;
    if(version!==requestVersion) return;
    if(isAdmin){catalog=owned;adminId=target??'';}
    if(data){
      if(program?.id!==data.id||program.revision!==data.revision) nameChoice=editedName=undefined;
      adopt(data);
    }else program=undefined;
  }catch(error){
    if(version!==requestVersion) return;
    program=undefined;
    loadProblem=error.message||'Program tidak dapat dimuatkan.';
  }finally{
    if(version===requestVersion){loading=false;render();}
  }
}
function statusPanel(title,detail,actions=''){
  return '<section class="card"><h2>'+esc(title)+'</h2><p>'+esc(detail)+'</p>'+actions+'</section>';
}
const refreshButton=()=>'<div class="actions">'+button('Muat semula','refresh',{symbol:'clock'})+'</div>';

function toast(text){
  document.querySelector('#toast').textContent=text;
  clearTimeout(messageTimer);
  messageTimer=setTimeout(()=>document.querySelector('#toast').textContent='',4300);
}
function openDialog(title,body){
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+esc(title)+'</h2><button class="icon-button" data-act="close" aria-label="Tutup">'+icon('close')+'</button></div>'+body;
  dialog.setAttribute('aria-labelledby','dialog-title');
  if(!dialog.open) dialog.showModal();
}
async function login(){
  await firebase.signIn();
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
  const row=nameChoice;
  return {name:editedName??p.names[row],row};
}
function reviewName(p){
  const e=selected(p);
  const draft=nameDraft(p);
  if(confirmed(p)===p.names.length&&!e) return '<h2>Sesi telah selesai</h2><p>Semua nama telah dicabut dan disahkan.</p>';
  const options=e
    ? '<option value="'+e.row+'">'+esc(e.name)+'</option>'
    : '<option value="">Pilih daripada senarai</option>'+p.names.map((name,row)=>
      p.taken.includes(row)?'':'<option value="'+row+'"'+(row===draft.row?' selected':'')+'>'+esc(row===draft.row?draft.name:name)+'</option>').join('');
  return '<h2>Semak nama anda</h2><p>Pilih nama anda yang didaftarkan oleh urusetia.</p>'+
    '<label class="field">Pilih nama anda<select id="participant-name">'+options+'</select></label>'+
    '<div class="actions">'+button(e?.status==='confirmed'?'Lihat keputusan':'Sahkan nama anda betul','accept-name',{symbol:'check',disabled:!draft.name})+'</div>'+
    (draft.row===undefined?'':'<div class="name-correction"><p>Anda yakin nama anda salah?</p>'+button('EDIT','edit-name',{cls:'secondary'})+'</div>');
}

const reviewLink=p=>'#/peserta/'+encodeURIComponent(p.id);
const drawLink=p=>reviewLink(p)+'/undian';
function showResult(p,e){
  const isFinal=e.status==='confirmed';
  const seconds=confirmationSeconds(p,e);
  const download=button('Muat turun keputusan','download',{symbol:'download',cls:'secondary'});
  const confirmButton='<button type="button" class="btn" data-act="confirm">'+icon('check')+'Sahkan nama'+
    ' <span class="confirm-countdown" aria-hidden="true">('+seconds+'s)</span>'+'</button>';
  return '<div class="result draw-result"><small>Nama penerima hadiah</small><strong>'+esc(p.names[e.recipient])+'</strong><span>'+esc(e.name)+'</span></div>'+
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
  if(e.revealAt&&e.recipient===null){
    const remaining=e.revealAt-serverNow(p);
    if(!loadProblem) revealTimer=setTimeout(refresh,Math.max(remaining,0)+50);
    return drawAnimation(remaining);
  }
  if(e.recipient!==undefined&&e.recipient!==null){
    return '<h2>'+(e.status==='confirmed'?'Cabutan disahkan':'Keputusan cabutan')+'</h2>'+showResult(p,e);
  }
  return '<h2>Syarat undian</h2><ol class="draw-rules">'+
    '<li>Setiap peserta hanya boleh mencabut sekali.</li>'+
    '<li>Padanan dijana secara rawak. Nama sendiri dikecualikan.</li>'+
    '<li>Setiap nama dalam senarai menerima satu hadiah.</li></ol>'+
    '<label class="draw-consent"><input id="draw-consent" type="checkbox"><span>Saya bersetuju dengan syarat undian.</span></label>'+
    '<label class="draw-consent"><input id="draw-name-confirmed" type="checkbox"><span>Saya sahkan nama saya <strong>“'+esc(e.name)+'”</strong> adalah betul.</span></label>'+
    '<div class="actions">'+button('Cabut Nama','draw',{symbol:'gift',disabled:true})+'</div>';
}

function participant(p,showDraw){
  if(!p){
    const loginAction='<div class="actions">'+button('Log masuk dengan Google','login',{symbol:'google',cls:'secondary'})+'</div>';
    return !account?statusPanel('Cabut Nama','Buka pautan atau imbas QR program anda, kemudian log masuk dengan Google.',loginAction):
      statusPanel('Cabut Nama','Buka pautan atau imbas QR yang dikongsikan oleh urusetia.');
  }
  if(!p.names.length) return '<section class="card"><h2>'+esc(p.title)+'</h2><p>Urusetia belum memuat naik senarai nama. Semak semula melalui pautan ini apabila senarai tersedia.</p></section>';
  if(showDraw) return '<section class="card participant-card draw-card"><div class="draw-top"><p class="draw-program">'+esc(p.title)+'</p>'+button('Tukar akaun','logout',{cls:'secondary switch-account'})+'</div>'+drawBody(p)+
    '<a class="btn quiet draw-back" href="'+reviewLink(p)+'">'+icon('back')+'Kembali</a></section>';
  const signIn='<h2>Cabutan anda</h2><p>Log masuk untuk menyemak nama anda dan membuat cabutan.</p><div class="actions">'+button('Log masuk dengan Google','login',{symbol:'google',cls:'secondary'})+'</div>'+note('Keputusan hanya dapat dilihat oleh anda dan urusetia.');
  return '<section class="hero"><div class="hero-copy"><div class="kicker">'+icon('spark')+'Cabutan hadiah</div><h1>'+esc(p.title)+'</h1><p>Cabut satu nama untuk mengetahui siapa penerima hadiah anda.</p></div>'+art+'</section>'+
    '<div class="grid participant-grid"><section class="card participant-card"><div class="card-head"><div class="main-icon" data-icon>'+icon('gift')+'</div>'+statusFor(p)+'</div>'+
    (account?'<div class="acct"><span>'+esc(account)+'</span></div>':'')+
    (account?reviewName(p):signIn)+'</section>'+participantProgress(p)+'</div>';
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
function importPreview(p,title,names){
  openDialog('Semak senarai nama','<p>'+names.length+' baris dikesan. Betulkan ejaan atau padam baris yang tidak diperlukan sebelum menyimpan.</p>'+
    (p?.names.length?'<p class="list-warning">Menyimpan senarai baharu akan menggantikan senarai dan mengosongkan rekod cabutan untuk <strong>'+esc(p.title)+'</strong>.</p>':'')+
    '<form data-form="save-list">'+(p?programField(p):'<input type="hidden" name="title" value="'+esc(title)+'">')+
    '<label class="field">Satu nama setiap baris<textarea name="names" rows="7" required>'+esc(names.join('\n'))+'</textarea></label>'+
    button(p?'Simpan senarai':'Cipta program','',{type:'submit',cls:'wide',symbol:'check'})+'<p class="form-error" role="alert"></p></form>');
}
function renameModal(p){
  openDialog('Edit nama program','<form data-form="rename">'+programField(p)+titleField(p.title)+
    button('Simpan nama program','',{type:'submit',cls:'wide',symbol:'check'})+'<p class="form-error" role="alert"></p></form>');
}
function records(p,search){
  const rows=p.records.filter(e=>norm([e.name,e.email,e.recipient===null?'':p.names[e.recipient]].join(' ')).includes(norm(search)));
  if(!rows.length) return '<div class="empty">'+(search?'Tiada rekod sepadan dengan carian.':'Rekod akan dipaparkan apabila peserta membuat cabutan.')+'</div>';
  return '<div class="table-wrap" tabindex="0" aria-label="Jadual rekod cabutan"><table role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader">Peserta</th><th role="columnheader">Penerima</th><th role="columnheader">Status</th></tr></thead><tbody role="rowgroup">'+
    rows.map(e=>'<tr role="row"><td role="cell" class="record-person"><div>'+esc(e.name)+'</div><small>'+esc(e.email)+'</small></td><td role="cell" class="record-recipient"><span class="record-label" aria-hidden="true">Penerima hadiah</span><div>'+(e.recipient===null?'—':esc(p.names[e.recipient]))+'</div></td><td role="cell" class="record-status">'+
      (e.status==='confirmed'?tag('Disahkan','','check'):tag(e.status==='waiting'?'Padanan akhir':'Belum disahkan','gold','clock'))+'</td></tr>').join('')+
    '</tbody></table></div>';
}
const programLink=p=>new URL(reviewLink(p),location.origin+location.pathname).href;
function qrGraphic(url){
  try {
    const modules=drawQrModules(url);
    const d=modules.flatMap((row,y)=>row.map((on,x)=>on?'M'+(x+4)+' '+(y+4)+'h1v1h-1z':'')).join('');
    const size=modules.length+8;
    return '<svg viewBox="0 0 '+size+' '+size+'" aria-label="Kod QR program" role="img" shape-rendering="crispEdges"><path fill="currentColor" d="'+d+'"/></svg>';
  } catch {return '<span>QR tidak tersedia</span>';}
}
function admin(p){
  const header='<div class="admin-title"><h1>Panel urusetia</h1><p>Urus program, kongsi pautan penyertaan dan semak rekod cabutan.</p></div>';
  if(!account) return header+'<section class="card admin-entry"><div class="main-icon" data-icon>'+icon('shield')+'</div><h2>Akses urusetia</h2><div class="actions">'+button('Log masuk dengan Google','login',{symbol:'google'})+'</div><p>'+'Mana-mana akaun Google boleh mencipta program sendiri.'+'</p></section>';
  if(!p) return header+statusPanel('Program anda','Cipta program pertama dan masukkan senarai nama.','<div class="actions">'+button('Cipta program','create',{symbol:'plus'})+'</div>');
  const count=confirmed(p), url=programLink(p);
  return header+'<div class="program-choice"><label class="field">Program<select id="admin-program">'+programsOptions(p.id)+'</select></label><div class="program-actions">'+button('Cipta program','create',{symbol:'plus'})+button('Edit nama program','rename',{cls:'secondary'})+button('Reset undian','reset',{cls:'danger-outline',disabled:!p.names.length})+'</div></div>'+
    '<div class="stats"><div class="stat"><strong>'+p.names.length+'</strong><span>Jumlah penerima</span></div><div class="stat"><strong>'+count+'</strong><span>Disahkan</span></div><div class="stat"><strong>'+(p.names.length-count)+'</strong><span>Belum selesai</span></div></div>'+
    '<div class="grid admin-grid"><div class="admin-records"><section class="card"><div class="card-head"><h2>Rekod cabutan</h2>'+statusFor(p)+'</div><label class="field">Cari rekod<input id="record-search" type="search" placeholder="Nama peserta, emel atau penerima" value="'+esc(query)+'"></label><div id="records">'+records(p,query)+'</div><div class="actions">'+button('Muat semula rekod','refresh',{cls:'secondary',symbol:'clock'})+'</div></section>'+
    '<section class="card"><h2>Senarai penerima</h2><div class="actions">'+button('Muat naik senarai nama','import-list',{symbol:'file'})+button('Reset senarai nama','reset-list',{cls:'danger-outline',disabled:!p.names.length})+'</div>'+
    (p.names.length?'<details class="admin-name-list"><summary>Lihat '+p.names.length+' nama</summary><ul>'+p.names.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul></details>':'<p>Belum ada nama. Muat naik fail untuk membuka cabutan.</p>')+'</section></div>'+
    '<div class="admin-tools"><section class="card share-card"><h2>Kongsi penyertaan</h2><p>Pautan dan QR untuk peserta program ini.</p><div class="qr">'+qrGraphic(url)+'</div><label class="field">Pautan program<input type="url" value="'+esc(url)+'" readonly></label><div class="actions">'+button('Salin pautan','copy',{symbol:'link',cls:'secondary'})+'<a class="btn quiet" href="'+esc(url)+'">Buka paparan peserta</a></div>'+''+'</section>'+
    '<section class="card testing-card"><h2>Alat ujian</h2><p>Semak sama ada setiap peserta simulasi mendapat penerima yang berbeza.</p><div class="actions acceptance-action">'+button('UJIAN PENERIMAAN','acceptance-test',{symbol:'check',disabled:p.names.length<2})+'</div>'+
    (p.names.length<2?'<p>Muat naik sekurang-kurangnya dua nama untuk menjalankan ujian.</p>':'')+
    '</section></div></div>';
}
function resetModal(p,resetList=false){
  const detail=resetList
    ? 'Semua nama dan rekod cabutan untuk <strong>'+esc(p.title)+'</strong> akan dikosongkan. Muat naik senarai baharu untuk membuka semula cabutan.'
    : 'Semua cabutan untuk <strong>'+esc(p.title)+'</strong>, termasuk yang belum disahkan, akan dikosongkan. Peserta boleh mencabut semula menggunakan pautan yang sama.';
  openDialog(resetList?'Reset senarai nama?':'Reset undian?','<p>'+detail+'</p><form data-form="'+(resetList?'reset-list':'reset')+'">'+programField(p)+'<div class="actions reset-actions">'+button('Batal','close',{cls:'secondary'})+button(resetList?'Ya, reset senarai nama':'Ya, reset undian','',{type:'submit',cls:'danger'})+'</div><p class="form-error" role="alert"></p></form>');
  dialog.querySelector('form [data-act="close"]').focus();
}
function route(){
  const [view,id,step]=location.hash.replace(/^#\/?/,'').split('/');
  return {isAdmin:view==='urus',id,step};
}
function render(){
  clearTimeout(revealTimer);
  clearInterval(countdownTimer);
  const {isAdmin,step}=route();
  const p=program;
  const showDraw=Boolean(!isAdmin&&step==='undian'&&p?.own);
  document.body.classList.toggle('draw-view',showDraw);
  document.body.classList.toggle('admin-view',isAdmin);
  switchAccount.hidden=!account;
  document.querySelector('#admin-link').toggleAttribute('aria-current',isAdmin);
  document.querySelector('#participant-link').toggleAttribute('aria-current',!isAdmin);
  if(authProblem||loadProblem){
    app.innerHTML=statusPanel('Cabut Nama',authProblem||loadProblem,refreshButton());
    return;
  }
  if(!authenticated||loading&&!p){
    app.innerHTML=statusPanel('Cabut Nama','Sedang memuatkan…');
    return;
  }
  app.innerHTML=isAdmin?admin(p):participant(p,showDraw);
  const seconds=app.querySelector('.confirm-countdown');
  if(seconds&&p?.own){
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
    [p.names[e.recipient],'750',53,'#17382e',63,36],
    ['Dicabut oleh '+e.name,'500',27,'#50665a',38,21],
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

app.addEventListener('click',async ev=>{
  const btn=ev.target.closest('[data-act]');
  if(!btn||btn.disabled) return;
  const action=btn.dataset.act;
  const p=program;
  const version=requestVersion;
  try {
    if(action==='login') return await login();
    if(action==='logout') return await logout();
    if(action==='refresh') return await refresh();
    if(route().isAdmin&&account){
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
      nameChoice=editedName=undefined;
      if(location.hash===drawLink(p)) render();
      else location.hash=drawLink(p);
    }
    if(action==='edit-name'){
      const draft=nameDraft(p);
      if(draft.row===undefined) return;
      return openDialog('Edit nama anda','<form data-form="edit-name">'+nameField('Nama penuh',draft.name)+button('Simpan nama','',{type:'submit',cls:'wide',symbol:'check'})+'<p class="form-error" role="alert"></p></form>');
    }
    if(action==='download') return downloadResult(p,selected(p));
    if(action==='draw'||action==='confirm'){
      if(action==='draw'&&!canDraw()) return;
      btn.disabled=true;
      if(route().step!=='undian') return;
      const data=await request(action,p,action==='draw'?{agreed:true,confirmedName:p.own.name}:{});
      if(version===requestVersion&&program?.id===data.id&&program.revision===data.revision){adopt(data);render();}
    }
  }catch(error){
    toast(error.message);
  }finally{
    if(btn.isConnected&&action!=='draw') btn.disabled=false;
    if(btn.isConnected&&action==='draw') btn.disabled=!canDraw();
  }
});
dialog.addEventListener('click',ev=>{
  if(ev.target.closest('[data-act="close"]')) dialog.close();
});

dialog.addEventListener('change',ev=>{
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
    render();
    document.querySelector('#participant-name')?.focus();
    return;
  }
  if(ev.target.id!=='admin-program') return;
  adminId=ev.target.value;
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
    if(!route().isAdmin) return;
    if(action==='read-list'){
      const title=target?p.title:clean(data.get('title')??'');
      if(!title) throw new Error('Masukkan nama program.');
      const names=data.get('source')==='paste'?splitNames(data.get('names')):await readNames(data.get('file'));
      if(!names.length) throw new Error('Masukkan sekurang-kurangnya dua nama penerima.');
      if(dialog.open&&form.isConnected) importPreview(target?p:null,title,names);
      return;
    }
    if(action==='save-list'){
      const names=validateNames(splitNames(data.get('names')));
      if(target) await request('replace',p,{names});
      else adminId=(await firebase.call('create',{title:data.get('title'),names})).id;
    }else if(action==='rename'&&target) await request('rename',p,{title:data.get('title')});
    else if((action==='reset'||action==='reset-list')&&target) await request(action,p);
    else return;
    query='';
    dialog.close();
    await refresh();
    toast('Perubahan disimpan.');
  }catch(error){
    form.querySelector('.form-error').textContent=error.message;
  }finally{btn.disabled=false;}
}
dialog.addEventListener('submit',submit);
window.addEventListener('hashchange',()=>{
  if(dialog.open) dialog.close();
  const old=program;
  if(route().isAdmin||old?.id!==route().id) program=undefined;
  nameChoice=editedName=undefined;
  refresh();
  window.scrollTo(0,0);
});


function parseCsv(text){
  const separator=text.split(/\r?\n/,1)[0].includes(';')?';':',';
  const rows=[];
  let row=[], value='', quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'){
      if(quoted&&text[i+1]==='"'){value+='"';i++;}
      else quoted=!quoted;
    } else if(!quoted&&char===separator){
      row.push(value);value='';
    } else if(!quoted&&(char==='\n'||char==='\r')){
      row.push(value); rows.push(row);row=[];value='';
      if(char==='\r'&&text[i+1]==='\n') i++;
    } else {
      value+=char;
    }
  }
  if(quoted) throw new Error('Fail CSV mengandungi tanda petik yang tidak lengkap.');
  if(value||row.length) rows.push([...row,value]);
  return rows;
}
async function openOfficeArchive(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  const view=new DataView(bytes.buffer);
  const decoder=new TextDecoder();
  const u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);
  let end=bytes.length-22;
  while(end>=Math.max(0,bytes.length-65557)&&u32(end)!==0x06054b50) end--;
  if(end<Math.max(0,bytes.length-65557)) throw new Error('Fail Word atau Excel tidak dapat dibaca.');
  const directory=new Map();
  let ptr=u32(end+16);
  for(let i=0;i<u16(end+10);i++){
    if(u32(ptr)!==0x02014b50) break;
    const nameLength=u16(ptr+28),name=decoder.decode(bytes.subarray(ptr+46,ptr+46+nameLength));
    directory.set(name,{method:u16(ptr+10),size:u32(ptr+20),raw:u32(ptr+24),start:u32(ptr+42)});
    ptr+=46+nameLength+u16(ptr+30)+u16(ptr+32);
  }
  async function xml(name){
    const f=directory.get(name);
    if(!f) return null;
    if(f.raw>12500000) throw new Error('Kandungan dokumen terlalu besar untuk prototaip.');
    const start=f.start+30+u16(f.start+26)+u16(f.start+28);
    const content=bytes.subarray(start,start+f.size);
    let source;
    if(f.method===0) source=decoder.decode(content);
    else if(f.method===8) source=await new Response(new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    else throw new Error('Jenis mampatan dokumen tidak disokong.');
    const document=new DOMParser().parseFromString(source,'application/xml');
    if(document.querySelector('parsererror')) throw new Error('Kandungan dokumen tidak dapat dibaca.');
    return document;
  }
  return xml;
}
async function parseXlsx(file){
  const xml=await openOfficeArchive(file);
  const sheetId=(await xml('xl/workbook.xml'))?.getElementsByTagName('sheet')[0]?.getAttribute('r:id');
  const rels=(await xml('xl/_rels/workbook.xml.rels'))?.getElementsByTagName('Relationship');
  const target=Array.from(rels||[]).find(x=>x.getAttribute('Id')===sheetId)?.getAttribute('Target');
  const sheet=(target?new URL(target,'https://xlsx.local/xl/workbook.xml').pathname.slice(1):'xl/worksheets/sheet1.xml');
  const sheetXml=await xml(sheet);
  if(!sheetXml) throw new Error('Helaian pertama Excel tidak ditemui.');
  const shared=(await xml('xl/sharedStrings.xml'))?.getElementsByTagName('si');
  const innerText=element=>Array.from(element?.getElementsByTagName('t')||[]).map(n=>n.textContent).join('');
  return Array.from(sheetXml.getElementsByTagName('row')).map(row=>{
    const values=[];
    for(const cell of row.getElementsByTagName('c')){
      const letters=cell.getAttribute('r')?.match(/^[A-Z]+/)?.[0]||'A';
      const column=[...letters].reduce((sum,v)=>sum*26+v.charCodeAt(0)-64,0)-1;
      const value=cell.getElementsByTagName('v')[0]?.textContent||'';
      const type=cell.getAttribute('t');
      values[column]=type==='s'?innerText(shared?.[Number(value)]):type==='inlineStr'?innerText(cell.getElementsByTagName('is')[0]):value;
    }
    return values;
  });
}
const nameHeaders=['nama','nama penuh','nama penerima','nama peserta','nama penuh penerima'];
const headerIndex=row=>row.findIndex(cell=>nameHeaders.includes(norm(cell??'')));
function columnNames(rows){
  const headings=rows.shift()||[];
  const index=headerIndex(headings);
  if(index<0) throw new Error('Letakkan tajuk “Nama” pada baris pertama fail.');
  return rows.map(row=>row[index]??'');
}
function documentNames(rows){
  return rows.map(line=>clean(line).replace(/^\(?\d{1,4}[.)\-:]\s*|^[•●▪–—-]\s+/,''))
    .filter(line=>line&&!nameHeaders.includes(norm(line))&&!/^senarai (?:nama|penerima|peserta)$/i.test(line)&&!/^(?:muka surat|halaman)\s*\d+/i.test(line)&&!/^\d+$/.test(line));
}
async function parseDocx(file){
  const xml=await openOfficeArchive(file);
  const doc=await xml('word/document.xml');
  const body=doc?.getElementsByTagNameNS('*','body')[0];
  if(!body) throw new Error('Dokumen Word tidak dapat dibaca. Gunakan fail .docx.');
  const textOf=el=>Array.from(el.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join('');
  const names=[];
  const paragraphs=[];
  for(const block of body.children){
    if(block.localName==='p') paragraphs.push(textOf(block));
    if(block.localName!=='tbl') continue;
    const rows=Array.from(block.children).filter(row=>row.localName==='tr').map(row=>
      Array.from(row.children).filter(cell=>cell.localName==='tc').map(cell=>
        Array.from(cell.children).filter(part=>part.localName==='p').map(textOf).join(' ')));
    const heading=rows.findIndex(row=>headerIndex(row)>=0);
    if(heading>=0) names.push(...columnNames(rows.slice(heading)));
    else if(rows.every(row=>row.length===1)) names.push(...rows.map(row=>row[0]));
  }
  return documentNames(names.length?names:paragraphs);
}
function pdfRows(items){
  const rows=[];
  for(const item of items){
    if(!item.str?.trim()) continue;
    const [,,,,x,y]=item.transform;
    let row=rows.find(r=>Math.abs(r.y-y)<2.5);
    if(!row){row={y,parts:[]};rows.push(row);}
    row.parts.push({x,end:x+item.width,text:item.str,height:item.height});
  }
  return rows.sort((a,b)=>b.y-a.y).map(row=>{
    const cells=[];
    for(const part of row.parts.sort((a,b)=>a.x-b.x)){
      const last=cells.at(-1);
      if(last&&part.x-last.end<Math.max(7,part.height*.75)){
        last.text+=(part.x-last.end>1?' ':'')+part.text;
        last.end=Math.max(last.end,part.end);
      }else cells.push({...part});
    }
    return cells;
  });
}
async function parsePdf(file){
  const pdfjs=await import('./pdfjs-build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdfjs-build/pdf.worker.min.mjs',location.href).href;
  const task=pdfjs.getDocument({
    data:new Uint8Array(await file.arrayBuffer()),useWasm:false,
    cMapUrl:new URL('./pdfjs-build/cmaps/',location.href).href,cMapPacked:true,
    standardFontDataUrl:new URL('./pdfjs-build/standard_fonts/',location.href).href
  });
  const names=[];
  let column;
  try {
    const pdf=await task.promise;
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);
      const rows=pdfRows((await page.getTextContent()).items);
      const heading=rows.findIndex(row=>headerIndex(row.map(cell=>cell.text))>=0);
      if(heading>=0){
        const cells=rows[heading];
        const index=headerIndex(cells.map(cell=>cell.text));
        column={start:cells[index].x-8,end:cells[index+1]?.x-8||Infinity};
      }
      for(const row of rows.slice(heading+1)){
        const cells=column?row.filter(c=>c.x>=column.start&&c.x<column.end):row;
        if(!column&&/^\d{1,4}[.)]?$/.test(clean(cells[0]?.text??''))) cells.shift();
        names.push(cells.map(c=>c.text).join(' '));
      }
    }
  } catch(error){
    if(error.name==='PasswordException') throw new Error('Fail PDF dilindungi kata laluan. Gunakan salinan yang boleh dibuka.');
    throw error;
  } finally {await task.destroy();}
  if(!names.some(name=>name.trim())) throw new Error('Tiada teks dikesan dalam PDF. Untuk PDF imbasan, jalankan OCR dahulu atau gunakan Word atau CSV.');
  return documentNames(names);
}
async function readNames(file){
  if(!file?.size) throw new Error('Pilih PDF, CSV, Word atau Excel yang mengandungi senarai penerima.');
  if(file.size>4000000) throw new Error('Gunakan fail berukuran di bawah 4 MB.');
  const ext=file.name.split('.').pop().toLowerCase();
  let names;
  if(ext==='pdf') names=await parsePdf(file);
  else if(ext==='docx') names=await parseDocx(file);
  else if(ext==='csv') names=columnNames(parseCsv(await file.text()));
  else if(ext==='xlsx') names=columnNames(await parseXlsx(file));
  else throw new Error('Gunakan fail .pdf, .csv, .docx atau .xlsx.');
  names=names.map(clean).filter(Boolean);
  if(!names.length) throw new Error('Tiada nama dikesan. Semak format senarai dalam fail.');
  return names;
}
const splitNames=text=>String(text??'').split(/\r\n|\n|\r/).map(clean).filter(Boolean);
function validateNames(lines){
  const names=lines.map(clean).filter(Boolean);
  if(names.length<2) throw new Error('Masukkan sekurang-kurangnya dua nama penerima.');
  if(names.some(n=>n.length>130)) throw new Error('Pendekkan nama penerima yang melebihi 130 aksara.');
  if(new Set(names.map(norm)).size!==names.length) throw new Error('Ada nama penerima yang sama. Bezakan nama tersebut dalam fail dan muat naik semula.');
  return names;
}
if(firebase){
  firebase.observe(user=>{
    account=user;
    authenticated=true;
    program=undefined;
    dialog.close();
    refresh();
  });
}else{
  authProblem='Modul Firebase tidak dimuatkan. Bina aplikasi dahulu.';
  render();
}
