const exts = ['.jpg','.jpeg','.png','.webp'];

const qs = new URLSearchParams(location.search);
const slug = qs.get('book') || '';
const TXT_URL = `books/${slug}/book.txt`;
const IMG_DIR = `books/${slug}/images/`;

const pager = document.getElementById('pager');
const pageCountEl = document.getElementById('pageCount');
const titleEl = document.getElementById('bookTitle');
const subEl = document.getElementById('bookSub');

let pages = [];
let idx = 0;

// ---- boot ----
(async function(){
  if(!slug){ pager.textContent='לא נבחר ספר.'; return; }

  // קרא את מטא הספר כדי להציג כותרת/תת־כותרת
  try{
    const r = await fetch('books/books.json');
    const arr = await r.json();
    const meta = arr.find(x => x.slug === slug);
    if(meta){
      titleEl.textContent = meta.title || slug;
      subEl.textContent   = meta.subtitle || '';
      document.querySelector('.book-head').dataset.title = meta.title || '';
      document.title = `${meta.title} – Reader`;
    }
  }catch{}

  try{
    const res = await fetch(TXT_URL);
    if(!res.ok) throw new Error('Text not found');
    let raw = await res.text();

    // החלף {image-N} לתגיות IMG (אסינכרוני – נשתמש בפלייסהולדרים)
    const jobs = [];
    raw = raw.replace(/\{image-(\d+)\}/g,(m,n)=>{
      const ph = `@@IMG_${n}@@`;
      jobs.push(replaceImage(ph, `image-${n}`));
      return ph;
    });
    const repl = await Promise.all(jobs);
    repl.forEach(({ph,html}) => raw = raw.replaceAll(ph, html));

    // הפוך שורה יחידה של * לקו כוכבית בהמשך
    raw = raw.replace(/\r?\n\*\r?\n/g, '\n@@STAR@@\n');

    // פצל לעמודים לפי ********
    pages = raw.split(/\r?\n\*{8,}\r?\n/).map(s => s.trim()).filter(Boolean);

    buildPager();
    go(0, false);
    enableSwipe();
  }catch(e){
    console.error(e);
    pager.innerHTML = '<div class="pill">Error loading text</div>';
  }
})();

async function replaceImage(ph, base){
  for(const ext of exts){
    const url = IMG_DIR + base + ext;
    try{
      const r = await fetch(url, {method:'HEAD'});
      if(r.ok) return { ph, html:`<img src="${url}" alt="${base}">` };
    }catch(){}
  }
  return { ph, html:`<div class="pill">Missing ${base}</div>` };
}

function buildPager(){
  pager.innerHTML = '';
  const track = document.createElement('div');
  track.className = 'page-track';
  pager.appendChild(track);

  pages.forEach(p => {
    const sec = document.createElement('section');
    sec.className = 'page';

    // Place + Date מההתחלה
    let place=null, date=null, body=p;

    body = body.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,a,b)=>{ place=b.trim(); return '' });
    body = body.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,a,b)=>{ date=b.trim();  return '' });

    const meta = document.createElement('div'); meta.className='meta';
    if(place){ const s = chip(`Place: ${place}`); meta.appendChild(s); }
    if(date){  const s = chip(`Date: ${date}`);  meta.appendChild(s); }
    if(place || date) sec.appendChild(meta);

    const div = document.createElement('div');
    div.className = 'body';

    // star rule
    const chunks = body.split('@@STAR@@');
    chunks.forEach((chunk,i)=>{
      if(i>0){
        const hr = document.createElement('div');
        hr.className='star-hr';
        hr.innerHTML = '<span class="star">★</span>';
        div.appendChild(hr);
      }
      const span = document.createElement('span');
      span.innerHTML = chunk; // כבר כולל <img>
      div.appendChild(span);
    });

    sec.appendChild(div);
    track.appendChild(sec);
  });
}

function chip(txt){
  const s=document.createElement('span');
  s.className='pill'; s.textContent=txt; return s;
}

function go(n, animate=true){
  idx = Math.max(0, Math.min(n, pages.length-1));
  const track = pager.querySelector('.page-track');
  if(!animate) track.style.transition='none';
  track.style.transform=`translateX(${-idx*100}%)`;
  if(!animate) requestAnimationFrame(()=>track.style.transition='transform .35s ease');
  pageCountEl.textContent = `${idx+1}/${pages.length}`;
}

// Swipe
function enableSwipe(){
  const track = pager.querySelector('.page-track');
  let startX=0, curX=0, dragging=false;

  pager.addEventListener('touchstart', e=>{
    if(!e.touches.length) return;
    dragging=true; startX=curX=e.touches[0].clientX;
    track.style.transition='none';
  }, {passive:true});

  pager.addEventListener('touchmove', e=>{
    if(!dragging) return;
    curX = e.touches[0].clientX;
    const dx = curX - startX;
    track.style.transform = `translateX(${(-idx*100)+(dx/window.innerWidth*100)}%)`;
  }, {passive:true});

  pager.addEventListener('touchend', ()=>{
    if(!dragging) return; dragging=false;
    const dx = curX - startX;
    track.style.transition='transform .25s ease';
    if(Math.abs(dx) > window.innerWidth*0.18){
      if(dx<0) go(idx+1); else go(idx-1);
    }else{
      go(idx); // חזור
    }
  });

  // גם חיצים במקלדת למקרה הצורך
  window.addEventListener('keydown', e=>{
    if(e.key==='ArrowLeft') go(idx+1);
    if(e.key==='ArrowRight') go(idx-1);
  });
}