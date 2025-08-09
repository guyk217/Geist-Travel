// Minimal reader: loads the book, builds slides, swipe + buttons.

const qs = (s,el=document)=>el.querySelector(s);
const track = qs('#track');
const pager = qs('#pager');
const prevBtn = qs('#prevBtn');
const nextBtn = qs('#nextBtn');

const url = new URL(location.href);
const slug = url.searchParams.get('slug') || 'europe-roots-1993';
const TXT_URL = `books/${slug}/book.txt`;
const IMG_DIR = `books/${slug}/images/`;
const IMG_EXTS = ['.jpg','.jpeg','.png','.webp'];

let pages = [];
let idx = 0;
let startX = 0, curX = 0, dragging = false;

async function headExists(url){
  try{ const r = await fetch(url, {method:'HEAD'}); return r.ok; }
  catch{ return false; }
}
async function resolveImageTag(num){
  const base = IMG_DIR + `image-${num}`;
  for (const ext of IMG_EXTS){
    const u = base + ext;
    if (await headExists(u)) return `<img src="${u}" alt="image-${num}">`;
  }
  return `<div class="pill">Missing image-${num}</div>`;
}

async function loadBook(){
  const res = await fetch(TXT_URL);
  if(!res.ok) throw new Error('book.txt not found');
  let raw = await res.text();

  // Replace {image-N} async
  const tasks = [];
  raw = raw.replace(/\{image-(\d+)\}/g, (m,num)=>{
    const ph = `@@IMG_${num}@@`;
    tasks.push((async()=>({ph, html: await resolveImageTag(num)}))());
    return ph;
  });
  const repl = await Promise.all(tasks);
  for (const r of repl) raw = raw.replaceAll(r.ph, r.html);

  // Split by ******** lines (8+ stars). Filter *true* empty parts.
  const rough = raw.split(/\r?\n\*{8,}\r?\n/g);
  pages = rough
    .map(s => s.trim())
    .filter(s => s.replace(/<[^>]+>/g,'').trim().length > 0);

  buildSlides();
  go(0, true);
}

function buildSlides(){
  track.innerHTML = '';
  pages.forEach(part=>{
    // extract top Place/Date
    let place=null, date=null, body=part;
    body = body.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''});
    body = body.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date=v.trim();  return ''});
    // single * line -> decorative star
    body = body.replace(/\r?\n\*\r?\n/g, '\n<div class="star-hr"><span class="star">★</span></div>\n');

    const page = document.createElement('div');
    page.className='page';
    page.innerHTML = `
      <article class="page-inner">
        ${ (place||date) ? `
        <div class="meta">
          ${date ? `<span class="pill">Date: ${date}</span>`:''}
          ${place? `<span class="pill">Place: ${place}</span>`:''}
        </div>`:''}
        <div class="content">${body}</div>
      </article>
    `;
    track.appendChild(page);
  });
  updatePager();
}

// navigation
function go(i, instant=false){
  idx = Math.max(0, Math.min(pages.length-1, i));
  const x = -idx * 100;
  track.style.transition = instant ? 'none' : 'transform .35s ease';
  track.style.transform = `translateX(${x}%)`;
  requestAnimationFrame(()=>{ track.style.transition='transform .35s ease'; });
  updatePager();
}
function updatePager(){ pager.textContent = `${idx+1}/${pages.length}`; }

// swipe handlers
function onDown(e){
  dragging = true;
  startX = (e.touches? e.touches[0].clientX : e.clientX);
  curX = startX;
}
function onMove(e){
  if(!dragging) return;
  curX = (e.touches? e.touches[0].clientX : e.clientX);
  const dx = curX - startX;
  track.style.transition='none';
  const w = window.innerWidth;
  const offset = (-idx*100) + (dx/w*100);
  track.style.transform = `translateX(${offset}%)`;
}
function onUp(){
  if(!dragging) return; dragging=false;
  const dx = curX - startX;
  const TH = Math.min(120, window.innerWidth*0.18);
  if (dx < -TH) go(idx+1);
  else if (dx > TH) go(idx-1);
  else go(idx); // snap back
}

// attach
const stage = qs('#stage');
stage.addEventListener('touchstart', onDown, {passive:true});
stage.addEventListener('touchmove',  onMove, {passive:true});
stage.addEventListener('touchend',   onUp);
stage.addEventListener('mousedown', onDown);
window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);

prevBtn.addEventListener('click', ()=>go(idx-1));
nextBtn.addEventListener('click', ()=>go(idx+1));

// init
loadBook().catch(err=>{
  track.innerHTML = `<div class="page"><div class="page-inner"><div class="content">Error: ${err.message}</div></div></div>`;
  pages = [1]; updatePager();
});