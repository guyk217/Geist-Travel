const $ = (s, el=document) => el.querySelector(s);
const stage  = $('#stage');
const track  = $('#track');
const pager  = $('#pager');
const prevBt = $('#prevBtn');
const nextBt = $('#nextBtn');

const params = new URLSearchParams(location.search);
const slug   = params.get('slug') || 'europe-roots-1993';

const TXT_URL = `books/${slug}/book.txt`;
const IMG_DIR = `books/${slug}/images/`;
const IMG_EXTS = ['.jpg','.jpeg','.png','.webp'];

// כמה שורות בעמוד
const LINES_PER_PAGE = 20;

let pages=[], idx=0, PAGE_W=0;

// ---------- images ----------
async function headExists(url){
  try { const r = await fetch(url, {method:'HEAD'}); return r.ok; }
  catch { return false; }
}
async function resolveImg(n){
  const base = IMG_DIR + `image-${n}`;
  for (const ext of IMG_EXTS){
    const u = base + ext;
    if (await headExists(u)) return `<img src="${u}" alt="image-${n}">`;
  }
  return `<div class="pill">Missing image-${n}</div>`;
}

// ---------- load ----------
async function loadBook(){
  let raw;
  try{
    const res = await fetch(TXT_URL);
    if(!res.ok) throw new Error(`book.txt not found at ${TXT_URL}`);
    raw = await res.text();
  }catch(e){
    showSingle(`Error loading book: ${e.message}`);
    return;
  }

  // {image-N} -> <img>
  const jobs=[], ph = (n)=>`@@IMG_${n}@@`;
  raw = raw.replace(/\{image-(\d+)\}/g, (m,n)=>{ jobs.push((async()=>({k:ph(n), v:await resolveImg(n)}))()); return ph(n); });
  for (const {k,v} of await Promise.all(jobs)) raw = raw.replaceAll(k, v);

  // ****** => קו מפריד
  raw = raw.replace(/\r?\n\s*\*{2,}\s*\r?\n/g, '\n<hr class="separator">\n');

  // חלוקה לפי מספר שורות קבוע
  const lines = raw.split(/\r?\n/);
  let buf=[]; pages=[];
  for(const ln of lines){
    buf.push(ln);
    if(buf.length>=LINES_PER_PAGE){ pages.push(buf.join('\n')); buf=[]; }
  }
  if(buf.length) pages.push(buf.join('\n'));
  if(!pages.length) pages=[raw.trim()];

  buildSlides();
  layout();
  go(0, true);
}

function showSingle(html){
  track.innerHTML = `<div class="page"><article class="page-inner"><div class="content">${html}</div></article></div>`;
  pages=[html]; idx=0; layout(); go(0, true);
}

function buildSlides(){
  track.innerHTML='';
  pages.forEach(part=>{
    const p=document.createElement('div');
    p.className='page';
    p.innerHTML=`<article class="page-inner"><div class="content">${part}</div></article>`;
    track.appendChild(p);
  });
}

// ---------- layout / nav ----------
function layout(){
  // width via BCR מונע “גליץ’ פס גלילה” בספארי
  PAGE_W = Math.round(stage.getBoundingClientRect().width);
  [...track.children].forEach(p=>p.style.width = PAGE_W+'px');
  track.style.width = (PAGE_W*pages.length)+'px';
  snap(true); // align
  updateUI();
}
function snap(instant=false){
  track.style.transition = instant ? 'none' : 'transform .35s ease';
  // translate3d = GPU, מדוייק יותר
  track.style.transform  = `translate3d(${-idx*PAGE_W}px,0,0)`;
  if(instant) requestAnimationFrame(()=>track.style.transition='transform .35s ease');
}
function go(i, instant=false){
  idx = Math.max(0, Math.min(pages.length-1, i));
  snap(instant); updateUI();
}
function updateUI(){
  pager.textContent = `${idx+1}/${pages.length}`;
  prevBt.disabled = (idx===0);
  nextBt.disabled = (idx===pages.length-1);
}

// ---------- swipe (Pointer Events עם סף+מהירות) ----------
let dragging=false, sx=0, sy=0, cx=0, cy=0, lastT=0, lastX=0, velocity=0;

function onPointerDown(e){
  // לא להתחיל דראג אם לוחצים על כפתור
  if (e.target.closest('button')) return;
  dragging=true;
  stage.setPointerCapture(e.pointerId);
  sx=lastX=cx=e.clientX; sy=cy=e.clientY;
  lastT=e.timeStamp; velocity=0;
  track.style.transition='none';
  document.body.classList.add('noSelect');
}
function onPointerMove(e){
  if(!dragging) return;
  cx=e.clientX; cy=e.clientY;

  // אם הגרירה אנכית יותר – תן לגלילה טבעית
  if (Math.abs(cy-sy) > Math.abs(cx-sx) + 6) { onPointerUp(e, true); return; }

  const dx=cx-sx;
  const now=e.timeStamp;
  const dt=Math.max(1, now-lastT);
  velocity = 0.8*velocity + 0.2*((cx-lastX)/dt); // px/ms
  lastT=now; lastX=cx;

  const base = -idx*PAGE_W;
  track.style.transform = `translate3d(${base+dx}px,0,0)`;
}
function onPointerUp(e, canceled=false){
  if(!dragging) return;
  dragging=false;
  document.body.classList.remove('noSelect');

  if (canceled){ snap(); return; }

  const dx=cx-sx;
  const TH = Math.min(140, PAGE_W*0.18);
  const speed = velocity*1000; // px/s

  if (dx < -TH || speed < -500) go(idx+1);
  else if (dx > TH || speed >  500) go(idx-1);
  else snap();
}

stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove',  onPointerMove);
stage.addEventListener('pointerup',    onPointerUp);
stage.addEventListener('pointercancel',e=>onPointerUp(e,true));
window.addEventListener('resize', layout);

prevBt.addEventListener('click', ()=>go(idx-1));
nextBt.addEventListener('click', ()=>go(idx+1));

loadBook();