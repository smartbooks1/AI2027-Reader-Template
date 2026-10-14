import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
// Discover the repository from the GitHub Pages hostname and first URL path.
// Standard project Pages: account.github.io/repository/
const PAGE_OWNER=location.hostname.endsWith('.github.io')?location.hostname.slice(0,-'.github.io'.length):'smartbooks1';
const PAGE_REPOSITORY=location.hostname.endsWith('.github.io')?(location.pathname.split('/').filter(Boolean)[0]||PAGE_OWNER+'.github.io'):'AI2027';
const ROOT=PAGE_OWNER+'/'+PAGE_REPOSITORY;
const $=id=>document.getElementById(id);
const isMobileLandscape=()=>window.matchMedia('(orientation:landscape) and (pointer:coarse) and (max-height:600px)').matches;
let readerDefaults={fit:'auto',twoPage:false,allowDownload:false};
const defaultFitMode=()=>readerDefaults.fit==='auto'?(isMobileLandscape()?'width':'page'):readerDefaults.fit;
const isMobilePortrait=()=>window.matchMedia('(orientation:portrait) and (pointer:coarse)').matches;
const effectiveSpread=()=>spread&&!isMobilePortrait();
let books=[],pdf=null,current=0,page=1,spread=false,zoom=1,rotation=0,fitMode="page",task=0,loadingTask=null;
const displayName=path=>decodeURIComponent(path.split('/').pop()).replace(/\.pdf$/i,'');
const link=path=>path.split('/').map(encodeURIComponent).join('/');

// Keep a small, pixel-budgeted LRU cache of rendered pages (not PDF originals).
const pageCache=new Map();
const MAX_CACHE_PIXELS=8500000;
let cachePixels=0,cacheEpoch=0,prefetchToken=0,prefetchTimer=null,renderedSignature='';
function resetPageCache(){
 cacheEpoch++;prefetchToken++;clearTimeout(prefetchTimer);prefetchTimer=null;
 pageCache.clear();cachePixels=0;renderedSignature='';
}
function cachedPage(key){
 const item=pageCache.get(key);
 if(item){pageCache.delete(key);pageCache.set(key,item)}
 return item;
}
function storePage(key,canvas,epoch){
 if(epoch!==cacheEpoch||canvas.width*canvas.height>MAX_CACHE_PIXELS/2)return;
 const old=pageCache.get(key);if(old){cachePixels-=old.width*old.height;pageCache.delete(key)}
 pageCache.set(key,canvas);cachePixels+=canvas.width*canvas.height;
 while(cachePixels>MAX_CACHE_PIXELS&&pageCache.size>1){
  const oldest=pageCache.keys().next().value,removed=pageCache.get(oldest);
  cachePixels-=removed.width*removed.height;pageCache.delete(oldest);
 }
}
function pageKey(n,width,height,angle){return [n,width,height,angle].join(':')}
function upcomingPages(start,total,paired){
 const next=paired?(start===1?2:start+2):start+1;
 return next>total?[]:paired?[next,next+1].filter(n=>n<=total):[next];
}
async function prefetchPage(n,scale,dpr,angle,documentRef,epoch,token){
 if(epoch!==cacheEpoch||token!==prefetchToken||documentRef!==pdf)return;
 const p=await documentRef.getPage(n);
 if(epoch!==cacheEpoch||token!==prefetchToken||documentRef!==pdf)return;
 const viewport=p.getViewport({scale:scale*dpr,rotation:(p.rotate+angle)%360});
 const w=Math.ceil(viewport.width),h=Math.ceil(viewport.height);
 const key=pageKey(n,w,h,angle);
 if(pageCache.has(key)||w*h>MAX_CACHE_PIXELS/2)return;
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
 if(epoch===cacheEpoch&&token===prefetchToken&&documentRef===pdf)storePage(key,canvas,epoch);
}
function queuePrefetch(start,total,paired,scale,dpr,angle,documentRef){
 clearTimeout(prefetchTimer);
 const token=++prefetchToken,epoch=cacheEpoch;
 prefetchTimer=setTimeout(async()=>{
  for(const n of upcomingPages(start,total,paired)){
   if(token!==prefetchToken||epoch!==cacheEpoch||documentRef!==pdf)break;
   try{await prefetchPage(n,scale,dpr,angle,documentRef,epoch,token)}catch{}
  }
 },180);
}

// Explicit, single bookmark. Legacy automatic reading positions are not imported.
const BOOKMARK_KEY='book-reader:'+ROOT+':manual-bookmark:v1';
function readBookmark(){
 try{const v=JSON.parse(localStorage.getItem(BOOKMARK_KEY));return v&&typeof v.file==='string'&&Number.isInteger(v.page)&&v.page>0?v:null}catch{return null}
}
function savedDestination(){
 const saved=readBookmark();if(!saved)return null;
 const index=books.findIndex(b=>b.file===saved.file);
 return index<0?null:{index,page:saved.page,title:books[index].title};
}
function updateBookmarkButtons(){
 const saved=savedDestination(),exists=!!saved;
 for(const id of ['resumeShortcut','mResumeShortcut','bookmarkDelete','mBookmarkDelete'])$(id).hidden=!exists;
 const here=!!(saved&&books[current]?.file===books[saved.index].file&&page===saved.page);
 $('bookmarkSave').textContent=here?'★ 책갈피 저장됨':'☆ 책갈피 저장';
 $('mBookmarkSave').textContent=here?'★ 이 페이지 저장됨':'☆ 현재 페이지 저장';
}
function saveBookmark(){
 if(!pdf||!books[current])return;
 try{localStorage.setItem(BOOKMARK_KEY,JSON.stringify({file:books[current].file,page}))}catch{}
 updateBookmarkButtons();closeMobileSettings();
}
function deleteBookmark(){
 try{localStorage.removeItem(BOOKMARK_KEY)}catch{}
 updateBookmarkButtons();closeMobileSettings();
}
function resumeReading(){
 const target=savedDestination();if(!target)return;
 closeMobileSettings();openBook(target.index,{resumePage:target.page});
}
$('bookmarkSave').onclick=saveBookmark;$('mBookmarkSave').onclick=saveBookmark;
$('bookmarkDelete').onclick=deleteBookmark;$('mBookmarkDelete').onclick=deleteBookmark;
$('resumeShortcut').onclick=resumeReading;$('mResumeShortcut').onclick=resumeReading;

const info=(message,error=false)=>{$('message').textContent=message;$('message').className='message'+(error?' error':'');$('message').hidden=false};
async function discover(){
 const resp=await fetch('https://api.github.com/repos/'+ROOT+'/git/trees/main?recursive=1',{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
 if(!resp.ok)throw Error('GitHub 파일 목록 조회 실패 ('+resp.status+')');
 const obj=await resp.json();
 if(obj.truncated)throw Error('저장소 파일 목록이 너무 커 자동 검색하지 못했습니다.');
 return obj.tree.filter(f=>f.type==='blob'&&/\.pdf$/i.test(f.path)).map(f=>({file:f.path,title:displayName(f.path),visible:true,allowDownload:false})).sort((a,b)=>a.file.localeCompare(b.file,'ko',{numeric:true}));
}
function configuredBooks(config,discovered){
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('books.json의 최상위 값은 { } 형태여야 합니다.');
 if(config.books!==undefined&&!Array.isArray(config.books))throw Error('books 항목은 [ ] 목록이어야 합니다.');
 if(config.titleRules!==undefined&&!Array.isArray(config.titleRules))throw Error('titleRules 항목은 [ ] 목록이어야 합니다.');
 if(config.siteTitle!==undefined&&(typeof config.siteTitle!=='string'||!config.siteTitle.trim()))throw Error('siteTitle에는 비어 있지 않은 책 제목을 입력해 주세요.');
 if(config.autoDiscover!==undefined&&typeof config.autoDiscover!=='boolean')throw Error('autoDiscover는 true 또는 false로 지정해 주세요.');
 const defaults=config.readerDefaults===undefined?{}:config.readerDefaults;
 if(!defaults||typeof defaults!=='object'||Array.isArray(defaults))throw Error('readerDefaults는 { } 형태여야 합니다.');
 if(defaults.fit!==undefined&&!['auto','width','page'].includes(defaults.fit))throw Error('readerDefaults.fit은 auto, width, page 중 하나여야 합니다.');
 for(const key of ['twoPage','allowDownload'])if(defaults[key]!==undefined&&typeof defaults[key]!=='boolean')throw Error('readerDefaults.'+key+'는 true 또는 false여야 합니다.');
 const rules=config.titleRules||[];
 for(let i=0;i<rules.length;i++){const rule=rules[i];if(!rule||typeof rule.contains!=='string'||!rule.contains.trim()||typeof rule.title!=='string'||!rule.title.trim())throw Error('titleRules '+(i+1)+'번째 항목의 contains와 title을 확인해 주세요.')}
 const declared=config.books||[],seen=new Set(),ordered=[];
 for(let i=0;i<declared.length;i++){
  const b=declared[i],prefix='books '+(i+1)+'번째 항목';
  if(!b||typeof b!=='object'||Array.isArray(b))throw Error(prefix+'은 { } 형태여야 합니다.');
  if(typeof b.file!=='string'||!b.file.trim()||!(/\.pdf$/i.test(b.file)))throw Error(prefix+'의 file에 PDF 경로(.pdf)를 입력해 주세요.');
  if(b.file.startsWith('/')||b.file.includes('\\')||b.file.split('/').some(p=>p==='.'||p==='..'||!p))throw Error(prefix+'의 file 경로를 확인해 주세요.');
  if(seen.has(b.file.toLocaleLowerCase()))throw Error(prefix+'의 PDF 경로가 중복되었습니다: '+b.file);
  if(b.allowDownload!==undefined&&typeof b.allowDownload!=='boolean')throw Error(prefix+'의 allowDownload는 true 또는 false로 지정해 주세요.');
  if(b.visible!==undefined&&typeof b.visible!=='boolean')throw Error(prefix+'의 visible은 true 또는 false로 지정해 주세요.');
  if(b.title!==undefined&&(typeof b.title!=='string'||!b.title.trim()))throw Error(prefix+'의 title을 확인해 주세요.');
  seen.add(b.file.toLocaleLowerCase());if(b.visible!==false)ordered.push(b);
 }
 const auto=config.autoDiscover!==false;
 if(auto){for(const item of discovered){if(!seen.has(item.file.toLocaleLowerCase()))ordered.push(item)}}
 return ordered.map(b=>{
  const rule=rules.find(x=>b.file.includes(x.contains));
  return {...b,title:b.title||rule?.title||displayName(b.file)};
 });
}
async function loadBooks(){
 info('도서 목록을 불러오는 중입니다…');
 try{
  const response=await fetch('./config/books.json',{cache:'no-store'});if(!response.ok)throw Error('config/books.json을 찾을 수 없습니다 ('+response.status+').');
  let config;try{config=await response.json()}catch{throw Error('books.json 문법 오류: 쉼표, 따옴표, 괄호를 확인해 주세요.')}
  // Validate settings before making network requests.
  configuredBooks(config,[]);
  const discovered=config.autoDiscover!==false?await discover():[];
  books=configuredBooks(config,discovered);
  // Verify manually listed PDFs using GitHub Pages paths, also when auto discovery is disabled.
  const listed=books.filter(b=>(config.books||[]).some(x=>x.file===b.file));
  const check=await Promise.all(listed.map(async b=>{try{const res=await fetch(link(b.file),{method:'HEAD',cache:'no-store'});return res.ok?null:b.file+' (HTTP '+res.status+')'}catch{return b.file+' (연결 확인 실패)'}}));
  const missing=check.filter(Boolean);
  if(missing.length)throw Error('지정한 PDF 파일을 찾지 못했습니다: '+missing.join(', ')+'. books.json의 file 경로와 실제 업로드 파일명을 확인해 주세요.');
  readerDefaults={fit:config.readerDefaults?.fit||'auto',twoPage:config.readerDefaults?.twoPage===true,allowDownload:config.readerDefaults?.allowDownload===true};
  spread=readerDefaults.twoPage;
  const siteTitle=typeof config.siteTitle==='string'&&config.siteTitle.trim()?config.siteTitle:'전자책 자료실';
  $('siteTitle').textContent=siteTitle;document.title=siteTitle;
  if(!books.length){$('chapters').replaceChildren();info('표시할 PDF가 없습니다. config/books.json의 books, visible, autoDiscover 설정을 확인해 주세요.');return}
  const nav=$('chapters');nav.replaceChildren();books.forEach((b,i)=>{const btn=document.createElement('button');btn.className='chapter';btn.textContent=b.title;btn.onclick=()=>openBook(i);nav.appendChild(btn)});
  await openBook(0,{initial:true});updateBookmarkButtons();
 }catch(e){info('도서 목록을 불러오지 못했습니다: '+e.message,true)}
}
async function openBook(index,options={}){
 resetPageCache();current=index;page=1;zoom=1;rotation=0;fitMode=defaultFitMode();const id=++task;const b=books[index];
 if(loadingTask){try{loadingTask.destroy()}catch{}loadingTask=null}
 pdf=null;$('title').textContent=b.title;
 document.querySelectorAll('.chapter').forEach((n,i)=>n.classList.toggle('active',i===index));
 $('sidebar').classList.remove('open');$('sheets').replaceChildren();info('PDF를 불러오는 중입니다…');
 const dl=$('download');dl.classList.toggle('hidden',!(b.allowDownload??readerDefaults.allowDownload));dl.href=link(b.file);dl.download=b.file.split('/').pop();
 // Keep the reader URL unchanged when switching chapters.
 try{const job=pdfjsLib.getDocument({url:link(b.file)});loadingTask=job;const doc=await job.promise;if(id!==task){await doc.destroy();return}pdf=doc;loadingTask=null;if(options.resumePage)page=Math.max(1,Math.min(pdf.numPages,options.resumePage));await render();updateBookmarkButtons()}
 catch(e){if(id===task)info('PDF 열기 실패 ('+b.file+'): GitHub에 해당 PDF가 있는지 파일명과 경로를 확인해 주세요. '+e.message,true)}
}
async function render(){
 if(!pdf)return;
 const id=++task,documentRef=pdf,epoch=cacheEpoch;
 const paired=effectiveSpread();
 const slots=!paired?[page]:page===1?[null,1]:[page,page+1<=pdf.numPages?page+1:null];
 const viewer=$('viewer');
 const signature=[documentRef,page,paired,zoom,rotation,fitMode,viewer.clientWidth,viewer.clientHeight,window.innerHeight].join('|');
 if(renderedSignature===signature)return;
 clearTimeout(prefetchTimer);prefetchToken++;
 info('페이지를 표시하는 중입니다…');$('sheets').replaceChildren();
 try{
  const loaded=await Promise.all(slots.map(n=>n===null?null:documentRef.getPage(n)));
  if(id!==task||documentRef!==pdf)return;
  const real=loaded.filter(Boolean);
  const vw=Math.max(200,viewer.clientWidth-36),dpr=Math.min(devicePixelRatio||1,2);
  const base=real.map(p=>p.getViewport({scale:1,rotation:(p.rotate+rotation)%360}));
  const slotCount=slots.length,gap=paired?4:0;
  const widthScale=Math.min(...base.map(v=>(vw-gap*(slotCount-1))/(v.width*slotCount)));
  const availableHeight=Math.max(160,window.innerHeight-viewer.getBoundingClientRect().top-64);
  const heightScale=Math.min(...base.map(v=>availableHeight/v.height));
  const scale=(fitMode==='page'?Math.min(widthScale,heightScale):widthScale)*zoom;
  const canvases=loaded.map((p,i)=>{
   if(!p)return null;
   const view=p.getViewport({scale:scale*dpr,rotation:(p.rotate+rotation)%360});
   const w=Math.ceil(view.width),h=Math.ceil(view.height),key=pageKey(slots[i],w,h,rotation);
   const cached=cachedPage(key),canvas=document.createElement('canvas');
   canvas.className='sheet';canvas.width=w;canvas.height=h;
   canvas.style.width=(view.width/dpr)+'px';canvas.style.height=(view.height/dpr)+'px';
   return {p,view,canvas,key,cached};
  });
  $('sheets').classList.toggle('spread-mode',paired);
  const blankReference=canvases.find(Boolean)?.canvas;
  canvases.forEach(item=>{
   if(item){$('sheets').appendChild(item.canvas);return}
   const blank=document.createElement('div');blank.className='blank-page';blank.setAttribute('aria-label','빈 페이지');
   blank.style.width=blankReference.style.width;blank.style.height=blankReference.style.height;
   $('sheets').appendChild(blank);
  });
  await Promise.all(canvases.filter(Boolean).map(async c=>{
   const ctx=c.canvas.getContext('2d');
   if(c.cached){ctx.drawImage(c.cached,0,0);return}
   await c.p.render({canvasContext:ctx,viewport:c.view}).promise;
   if(id===task&&documentRef===pdf)storePage(c.key,c.canvas,epoch);
  }));
  if(id!==task||documentRef!==pdf)return;
  renderedSignature=signature;
  $('message').hidden=true;refreshModeButtons();
  $('page').value=page;$('page').max=documentRef.numPages;$('total').textContent=documentRef.numPages;
  $('prev').disabled=page<=1;$('firstPage').disabled=page<=1;$('edgePrev').disabled=$('prev').disabled;
  $('next').disabled=page+(paired&&page>1?1:0)>=documentRef.numPages;$('edgeNext').disabled=$('next').disabled;$('lastPage').disabled=$('next').disabled;
  $('zoomLabel').textContent=Math.round(zoom*100)+'%';
  queuePrefetch(page,documentRef.numPages,paired,scale,dpr,rotation,documentRef);
 }catch(e){if(id===task&&documentRef===pdf)info('페이지 표시 실패: '+e.message,true)}
}
function navigate(target){if(!pdf)return;let next=Math.max(1,Math.min(pdf.numPages,target));if(effectiveSpread()&&next>1&&next%2!==0)next-=1;page=next;updateBookmarkButtons();$('page').value=page;$('firstPage').disabled=page<=1;$('prev').disabled=page<=1;$('lastPage').disabled=page+(effectiveSpread()&&page>1?1:0)>=pdf.numPages;$('next').disabled=$('lastPage').disabled;$('viewer').scrollTop=0;render()}
$('menu').onclick=()=>{const small=window.matchMedia('(max-width:760px), (max-width:1000px) and (pointer:coarse)').matches;if(small){const opened=$('sidebar').classList.toggle('open');$('menu').textContent=opened?'☰ 목차 닫기':'☰ 목차 열기'}else{const collapsed=document.querySelector('.layout').classList.toggle('sidebar-collapsed');$('menu').textContent=collapsed?'☰ 목차 열기':'☰ 목차 접기';if(pdf)requestAnimationFrame(()=>{positionEdgeButtons();render()})}};
$('prev').onclick=()=>navigate(effectiveSpread()?(page<=2?1:page-2):page-1);$('next').onclick=()=>navigate(effectiveSpread()?(page===1?2:page+2):page+1);
$('page').onchange=()=>navigate(Number($('page').value)||1);
$('firstPage').onclick=()=>navigate(1);
$('lastPage').onclick=()=>{if(pdf)navigate(pdf.numPages)};
$('edgePrev').onclick=()=>$('prev').click();
$('edgeNext').onclick=()=>$('next').click();
function positionEdgeButtons(){document.querySelector('.layout').style.setProperty('--reader-left',document.querySelector('.main').getBoundingClientRect().left+'px')}
positionEdgeButtons();
$('zoomIn').onclick=()=>{zoom=Math.min(3,zoom+.1);render()};
$('zoomOut').onclick=()=>{zoom=Math.max(.5,zoom-.1);render()};
$('rotateLeft').onclick=()=>{rotation=(rotation+270)%360;render()};
$('rotateRight').onclick=()=>{rotation=(rotation+90)%360;render()};
function refreshModeButtons(){for(const [id,active] of [['fit',fitMode==='width'],['fitPage',fitMode==='page'],['spread',spread]]){$(id).setAttribute('aria-pressed',String(active));$(id).classList.toggle('mode-active',active)}}
$('fit').onclick=()=>{fitMode='width';zoom=1;refreshModeButtons();render()};$('fitPage').onclick=()=>{fitMode='page';zoom=1;refreshModeButtons();render()};
$('spread').onclick=()=>{spread=!spread;if(effectiveSpread()&&page>1&&page%2!==0)page-=1;$('spread').textContent=spread?'▤ 한 쪽':'▣ 두 쪽';refreshModeButtons();render()};


// Enter focus mode only through explicit controls; restore via exit or deliberate tap.
let focusReading=false;
function setFocusReading(enabled){
 if(focusReading===enabled)return;
 focusReading=enabled;
 document.querySelector('.layout').classList.toggle('focus-reading',enabled);
 $('focusExit').hidden=!enabled;
 $('focusMode').setAttribute('aria-pressed',String(enabled));
 $('mFocusMode').setAttribute('aria-pressed',String(enabled));
 closeMobileSettings();
 if(pdf)requestAnimationFrame(()=>{positionEdgeButtons();render()});
}
$('focusMode').onclick=()=>setFocusReading(true);
$('mFocusMode').onclick=()=>setFocusReading(true);
$('focusExit').onclick=()=>setFocusReading(false);

// Mobile settings: controls proxy to the existing reader buttons.
const mobileSettings=$('mobileSettings'), mobileMore=$('mobileMore');
function closeMobileSettings(){mobileSettings.hidden=true;mobileMore.setAttribute('aria-expanded','false')}
mobileMore.onclick=()=>{mobileSettings.hidden=!mobileSettings.hidden;mobileMore.setAttribute('aria-expanded',String(!mobileSettings.hidden));syncMobileSettings()};
$('closeMobileSettings').onclick=closeMobileSettings;
const mobileActions={mFit:'fit',mFitPage:'fitPage',mSpread:'spread',mRotateLeft:'rotateLeft',mRotateRight:'rotateRight'};
for(const [mobileId,sourceId] of Object.entries(mobileActions)){
 $(mobileId).onclick=()=>{$(sourceId).click();syncMobileSettings();closeMobileSettings()};
}
function syncMobileSettings(){
 for(const [mobileId,sourceId] of Object.entries({mFit:'fit',mFitPage:'fitPage',mSpread:'spread'})){
  $(mobileId).setAttribute('aria-pressed',$(sourceId).getAttribute('aria-pressed')||'false');
 }
 $('mSpread').disabled=isMobilePortrait();
 $('mSpread').title=isMobilePortrait()?'두 쪽 보기는 가로 화면에서 사용할 수 있습니다.':'';
 $('mSpread').textContent=isMobilePortrait()?'▣ 두 쪽 (가로에서)':spread?'▤ 한 쪽 보기':'▣ 두 쪽 보기';
}
document.addEventListener('pointerdown',e=>{if(!mobileSettings.hidden&&!e.target.closest('#mobileSettings')&&!e.target.closest('#mobileMore'))closeMobileSettings()});
function refreshMobileLayout(){
 closeMobileSettings();
 const desired=defaultFitMode();if(fitMode!==desired){fitMode=desired;zoom=1;refreshModeButtons()}
 if(effectiveSpread()&&page>1&&page%2!==0)page-=1;
 syncMobileSettings();
 const mobile=window.matchMedia('(max-width:760px), (max-width:1000px) and (pointer:coarse)').matches;
 if(mobile){$('sidebar').classList.remove('open');$('menu').textContent='☰ 목차';$('menu').setAttribute('aria-expanded','false')}
 else{$('menu').textContent=document.querySelector('.layout').classList.contains('sidebar-collapsed')?'☰ 목차 열기':'☰ 목차 접기'}
 if(pdf)requestAnimationFrame(()=>render());
}
window.addEventListener('orientationchange',()=>setTimeout(refreshMobileLayout,120));
document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(e.key==='Escape'&&focusReading){setFocusReading(false);return}if(e.key==='ArrowRight')$('next').click();if(e.key==='ArrowLeft')$('prev').click()});
document.addEventListener('contextmenu',e=>{if(e.target.closest('.viewer'))e.preventDefault()});
window.addEventListener('resize',()=>{positionEdgeButtons();if(pdf)requestAnimationFrame(()=>render())});
// A brief stationary touch exits focus mode; scrolling, swiping and long press do not.
let focusTap=null;
$('viewer').addEventListener('pointerdown',e=>{
 if(!focusReading||e.pointerType!=='touch'||!e.isPrimary||e.target.closest('button')){focusTap=null;return}
 focusTap={id:e.pointerId,x:e.clientX,y:e.clientY,at:Date.now()};
});
$('viewer').addEventListener('pointerup',e=>{
 if(!focusTap||e.pointerId!==focusTap.id)return;
 const t=focusTap;focusTap=null;
 if(!focusReading)return;
 if(Date.now()-t.at<=300&&Math.hypot(e.clientX-t.x,e.clientY-t.y)<=10)setFocusReading(false);
});
$('viewer').addEventListener('pointercancel',()=>{focusTap=null});

// Pointer Events swipe navigation (touch screens); allow vertical scrolling.
let swipeStart=null;
const area=$('viewer');
area.addEventListener('pointerdown',e=>{
 if(e.pointerType!=='touch'||!e.isPrimary){swipeStart=null;return}
 swipeStart={id:e.pointerId,x:e.clientX,y:e.clientY,at:Date.now()};
});
area.addEventListener('pointerup',e=>{
 if(!swipeStart||swipeStart.id!==e.pointerId)return;
 const dx=e.clientX-swipeStart.x,dy=e.clientY-swipeStart.y;
 const elapsed=Date.now()-swipeStart.at;swipeStart=null;
 if(elapsed<1200&&Math.abs(dx)>=45&&Math.abs(dx)>Math.abs(dy)*1.25){
  if(dx<0)$('next').click();else $('prev').click();
 }
});
area.addEventListener('pointercancel',()=>{swipeStart=null});
area.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&e.isPrimary)area.setPointerCapture(e.pointerId)});
loadBooks();
