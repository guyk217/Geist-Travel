// --- DOM helpers ---
const $ = (s, el = document) => el.querySelector(s);
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

// כמה שורות בעמוד (שנה כרצונך)
const LINES_PER_PAGE = 20;

let pages = [];
let idx = 0;
let PAGE_W = 0;

function disable(btn, v){ btn.disabled = !!v; }

// ---------- images ----------
async function headExists(url){
  try{ const r = await fetch(url, {method:'HEAD'}); return r.ok; }
  catch{ return false; }
}
async function resolveImg(num){
  const base = IMG_DIR + `image-${num}`;
  for(const ext of IMG_EXTS){
    const u = base + ext;
    if(await headExists(u)) return `<img src="${u}" alt="image-${num}">`;
  }
  return `<div class="pill">Missing image-${num}</div>`;
}

// ---------- load & build ----------
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
  const jobs = [];
  raw = raw.replace(/\{image-(\d+)\}/g, (m,n)=>{
    const ph = `@@IMG_${n}@@`;
    jobs.push((async()=>({ph, html:await resolveImg(n)}))());
    return ph;
  });
  const repl = await Promise.all(jobs);
  repl.forEach(r => raw = raw.replaceAll(r.ph, r.html));

  // כוכביות -> קו מפריד
  raw = raw.replace(/\r?\n\s*\*{2,}\s*\r?\n/g, '\n<hr class="separator">\n');

  // חלוקה לפי מספר שורות קבוע
  const lines = raw.split(/\r?\n/);
  let buf = [];
  pages = [];
  for(const ln of lines){
    buf.push(ln);
    if(buf.length >= LINES_PER_PAGE){
      pages.push(buf.join('\n'));
      buf = [];
    }
  }
  if(buf.length) pages.push(buf.join('\n'));
  if(!pages.length) pages = [raw.trim()];

  buildSlides();
  layout();
  go(0, true);
}

function showSingle(html){
  track.innerHTML = `<div class="page"><article class="page-inner"><div class="content">${html}</div></article></div>`;
  pages = [html]; idx = 0;
  layout(); go(0, true);
}

function buildSlides(){
  track.innerHTML = '';
  pages.forEach(part=>{
    const p = document.createElement('div');
    p.className = 'page';
    p.innerHTML = `<article class="page-inner"><div class="content">${part}</div></article>`;
    track.appendChild(p);
  });
}

// ---------- layout & nav ----------
function layout(){
  PAGE_W = Math.floor(stage.clientWidth);
  [...track.children].forEach(p => p.style.width = PAGE_W + 'px');
  track.style.width = (PAGE_W * pages.length) + 'px';
  snap(true);
  updUI();
}
function snap(instant=false){
  track.style.transition = instant ? 'none' : 'transform .35s ease';
  track.style.transform  = `translateX(${-idx*PAGE_W}px)`;
  if(instant) requestAnimationFrame(()=>track.style.transition='transform .35s ease');
}
function go(i, instant=false){
  idx = Math.max(0, Math.min(pages.length-1, i));
  snap(instant); updUI();
}
function updUI(){
  pager.textContent = `${idx+1}/${pages.length}`;
  disable(prevBt, idx===0);
  disable(nextBt, idx===pages.length-1);
}

// ---------- swipe ----------
let drag=false, sx=0, cx=0;
function down(e){ drag=true; sx=(e.touches?e.touches[0].clientX:e.clientX); cx=sx; track.style.transition='none'; }
function move(e){ if(!drag) return; cx=(e.touches?e.touches[0].clientX:e.clientX); const dx=cx-sx; track.style.transform=`translateX(${(-idx*PAGE_W)+dx}px)`; }
function up(){ if(!drag) return; drag=false; const dx=cx-sx; const TH=Math.min(140, PAGE_W*0.18); if(dx<-TH) go(idx+1); else if(dx>TH) go(idx-1); else snap(); }

stage.addEventListener('touchstart', down, {passive:true});
stage.addEventListener('touchmove',  move, {passive:true});
stage.addEventListener('touchend',   up);
stage.addEventListener('mousedown',  down);
window.addEventListener('mousemove', move);
window.addEventListener('mouseup',   up);
window.addEventListener('resize',    layout);

prevBt.addEventListener('click', ()=>go(idx-1));
nextBt.addEventListener('click', ()=>go(idx+1));

loadBook();