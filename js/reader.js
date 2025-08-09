// Reader: paging by fixed line-count, **** -> <hr>, swipe + arrows

const $ = (s, el=document) => el.querySelector(s);
const stage  = $('#stage');
const track  = $('#track');
const pager  = $('#pager');
const prevBt = $('#prevBtn');
const nextBt = $('#nextBtn');

// --- accept both ?book= and ?slug= ---
const q = new URLSearchParams(location.search);
const slug = q.get('slug') || q.get('book') || 'europe-roots-1993';

const TXT_URL  = `books/${slug}/book.txt`;
const IMG_DIR  = `books/${slug}/images/`;
const IMG_EXTS = ['.jpg','.jpeg','.png','.webp'];

const LINES_PER_PAGE = 20; // כמה שורות בעמוד

let pages = [];
let idx = 0, PAGE_W = 0;

// --- utils ---
function disable(btn, v){ if(btn) btn.disabled = !!v; }

async function headExists(url){
  try{ const r = await fetch(url, {method:'HEAD'}); return r.ok; }
  catch{ return false; }
}
async function resolveImg(n){
  const base = IMG_DIR + `image-${n}`;
  for(const ext of IMG_EXTS){
    const u = base + ext;
    if(await headExists(u)) return `<img src="${u}" alt="image-${n}">`;
  }
  return `<div class="pill">Missing image-${n}</div>`;
}

// --- load ---
async function loadBook(){
  // בדוק שקיימים האלמנטים
  if(!stage || !track || !pager || !prevBt || !nextBt){
    console.error('Reader DOM IDs missing (#stage,#track,#pager,#prevBtn,#nextBtn)');
  }

  let raw;
  try{
    const res = await fetch(TXT_URL, {cache:'no-store'});
    if(!res.ok) throw new Error(`book.txt not found at ${TXT_URL}`);
    raw = await res.text();
  }catch(e){
    showSingle(`Error loading book: ${e.message}<br><small>URL tried: ${TXT_URL}</small>`);
    return;
  }

  // {image-N} -> <img> (async)
  const jobs = [];
  raw = raw.replace(/\{image-(\d+)\}/g, (m,n)=>{
    const ph = `@@IMG_${n}@@`;
    jobs.push((async()=>({ph, html: await resolveImg(n)}))());
    return ph;
  });
  for(const r of await Promise.all(jobs)) raw = raw.replaceAll(r.ph, r.html);

  // ****** => קו מפריד (לא פיצול עמודים)
  raw = raw.replace(/\r?\n\s*\*{2,}\s*\r?\n/g, '\n<hr class="separator">\n');

  // חלוקה לפי מספר שורות קבוע
  const lines = raw.split(/\r?\n/);
  pages = [];
  for(let i=0;i<lines.length;i+=LINES_PER_PAGE){
    const chunk = lines.slice(i, i+LINES_PER_PAGE).join('\n').trim();
    if(chunk.length) pages.push(chunk);
  }
  if(!pages.length) pages = [raw.trim()];

  buildSlides();
  layout();
  go(0, true);
}

function showSingle(html){
  track.innerHTML = `<div class="page"><article class="page-inner"><div class="content">${html}</div></article></div>`;
  pages=[html]; idx=0;
  layout(); go(0, true);
}

// --- build ---
function buildSlides(){
  track.innerHTML = '';
  pages.forEach(part=>{
    const p = document.createElement('div');
    p.className = 'page';
    p.innerHTML = `<article class="page-inner"><div class="content">${part}</div></article>`;
    track.appendChild(p);
  });
}

// --- layout & nav (pixel-perfect) ---
function layout(){
  PAGE_W = Math.round(stage.getBoundingClientRect().width);
  [...track.children].forEach(p => p.style.width = PAGE_W+'px');
  track.style.width = (PAGE_W * pages.length) + 'px';
  snap(true);
  updateUI();
}
function snap(instant=false){
  track.style.transition = instant ? 'none' : 'transform .35s ease';
  track.style.transform  = `translate3d(${-idx*PAGE_W}px,0,0)`;
  if(instant) requestAnimationFrame(()=>track.style.transition='transform .35s ease');
}
function go(i, instant=false){
  idx = Math.max(0, Math.min(pages.length-1, i));
  snap(instant);
  updateUI();
}
function updateUI(){
  pager.textContent = `${idx+1}/${pages.length}`;
  disable(prevBt, idx===0);
  disable(nextBt, idx===pages.length-1);
}

// --- swipe (pointer events) ---
let dragging=false, sx=0, cx=0, sy=0, cy=0, lastT=0, lastX=0, vel=0;
function pd(e){ if(e.target.closest('button')) return; dragging=true; stage.setPointerCapture(e.pointerId); sx=lastX=cx=e.clientX; sy=cy=e.clientY; lastT=e.timeStamp; vel=0; track.style.transition='none'; document.body.classList.add('noSelect'); }
function pm(e){
  if(!dragging) return;
  cx=e.clientX; cy=e.clientY;
  if(Math.abs(cy-sy) > Math.abs(cx-sx)+6){ pu(e,true); return; } // תן לגלילה אנכית לנצח
  const dx=cx-sx, now=e.timeStamp, dt=Math.max(1, now-lastT);
  vel = 0.8*vel + 0.2*((cx-lastX)/dt);
  lastT=now; lastX=cx;
  track.style.transform = `translate3d(${(-idx*PAGE_W)+dx}px,0,0)`;
}
function pu(e, cancel=false){
  if(!dragging) return; dragging=false; document.body.classList.remove('noSelect');
  if(cancel){ snap(); return; }
  const dx=cx-sx, TH=Math.min(140, PAGE_W*0.18), speed=vel*1000;
  if(dx<-TH || speed<-500) go(idx+1);
  else if(dx>TH || speed>500) go(idx-1);
  else snap();
}

stage.addEventListener('pointerdown', pd);
stage.addEventListener('pointermove',  pm);
stage.addEventListener('pointerup',    pu);
stage.addEventListener('pointercancel',e=>pu(e,true));
window.addEventListener('resize', layout);

prevBt.addEventListener('click', ()=>go(idx-1));
nextBt.addEventListener('click', ()=>go(idx+1));

// go
loadBook();