/* Reader – עיצוב המחברת הישן, רק עובד.
   טוען books/<slug>/book.txt, מחליף {image-N}, הופך ****** ל-<hr>,
   יוצר "טבליות" Place/Date אם יש בתחילת קטע,
   ומחלק לעמודים אוטומטית לפי אורך טקסט (לא לפי ******).
*/

const qs = new URLSearchParams(location.search);
const slug = qs.get('book'); // למשל europe-roots-1993
const TXT_URL = slug ? `books/${slug}/book.txt` : null;
const IMG_DIR = slug ? `books/${slug}/images/` : `books/images/`;
const IMG_EXTS = ['.jpg','.jpeg','.png','.webp','.JPG','.PNG'];

const track = document.getElementById('track');
const counter = document.getElementById('counter');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

let pages = [];
let pageIndex = 0;

// ------- helpers -------
async function headExists(url){
  try{
    const r = await fetch(url, { method:'HEAD' });
    return r.ok;
  }catch(e){ return false; }
}
async function findImageSrc(base){
  for (const ext of IMG_EXTS){
    const url = base + ext;
    if (await headExists(url)) return url;
  }
  return null;
}
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function pillsFromHead(lines){
  // מחפש שורות פתיחה Place:/Date: ומסיר אותן מהטקסט
  let place=null, date=null;
  while(lines.length){
    const ln = lines[0].trim();
    if (/^Place\s*:/.test(ln)) { place = ln.replace(/^Place\s*:\s*/,'').trim(); lines.shift(); continue; }
    if (/^Date\s*:/.test(ln))  { date  = ln.replace(/^Date\s*:\s*/,'').trim();  lines.shift(); continue; }
    break;
  }
  let html = '';
  if(place || date){
    html += `<div class="meta">`;
    if(date)  html += `<span class="pill">Date: ${escapeHtml(date)}</span>`;
    if(place) html += `<span class="pill">Place: ${escapeHtml(place)}</span>`;
    html += `</div>`;
  }
  return { html, rest: lines.join('\n') };
}

function splitIntoPages(html){
  // חותך לפי פסקאות כדי לא לשבור מילים, עם יעד אורך דינמי למובייל/דסקטופ
  const target = (innerWidth <= 420) ? 1400 : (innerWidth <= 900 ? 2000 : 2400);
  // נפרק לפסקאות (כבר יש <hr> ו<img> וכן הלאה)
  const blocks = html.split(/\n{2,}/).map(s=>s.trim()).filter(Boolean);

  let current = '';
  const out = [];
  for(const b of blocks){
    if ((current + '\n\n' + b).length > target && current){
      out.push(current);
      current = b;
    }else{
      current = current ? current + '\n\n' + b : b;
    }
  }
  if(current) out.push(current);
  return out;
}

function renderPages(pagesHtml){
  track.innerHTML = '';
  pages = pagesHtml;

  pages.forEach((html, i)=>{
    const p = document.createElement('div');
    p.className = 'page';
    const inner = document.createElement('div');
    inner.className = 'page-inner';
    inner.innerHTML = html;
    p.appendChild(inner);
    track.appendChild(p);
  });

  pageIndex = 0;
  updateUI();
}

function updateUI(){
  const total = pages.length || 1;
  counter.textContent = `${pageIndex+1}/${total}`;
  const x = -pageIndex * window.innerWidth;
  track.style.transform = `translate3d(${x}px,0,0)`;

  prevBtn.disabled = (pageIndex === 0);
  nextBtn.disabled = (pageIndex >= total-1);
}

function go(dir){
  const total = pages.length || 1;
  pageIndex = Math.min(Math.max(pageIndex + dir, 0), total-1);
  updateUI();
}

// swipe
(function attachSwipe(){
  let sx=0, dx=0, dragging=false;
  const stage = document.getElementById('stage');

  stage.addEventListener('touchstart', e=>{
    if(!e.touches[0]) return;
    dragging=true; sx=e.touches[0].clientX; dx=0;
  }, {passive:true});

  stage.addEventListener('touchmove', e=>{
    if(!dragging||!e.touches[0]) return;
    dx = e.touches[0].clientX - sx;
  }, {passive:true});

  stage.addEventListener('touchend', ()=>{
    if(!dragging) return;
    dragging=false;
    if (Math.abs(dx) > 60){
      go(dx<0 ? +1 : -1);
    }
  });
})();

prevBtn.addEventListener('click', ()=>go(-1));
nextBtn.addEventListener('click', ()=>go(+1));
window.addEventListener('resize', ()=>updateUI());

// ------- boot -------
(async function init(){
  try{
    if(!TXT_URL) throw new Error('Missing book slug');
    const res = await fetch(TXT_URL);
    if(!res.ok) throw new Error('Text file not found');
    let raw = await res.text();

    // {image-N} -> <img>
    const jobs = [];
    raw = raw.replace(/\{image-(\d+)\}/g, (m, num)=>{
      const ph = `@@IMG_${num}@@`;
      jobs.push((async ()=>{
        const base = IMG_DIR + `image-${num}`;
        const src  = await findImageSrc(base);
        return { ph, html: src ? `<img src="${src}" alt="image-${num}">` :
                                 `<div class="pill">Missing image-${num}</div>` };
      })());
      return ph;
    });
    const results = await Promise.all(jobs);
    let hydrated = raw;
    for (const r of results){ hydrated = hydrated.replaceAll(r.ph, r.html); }

    // הפוך ****** לקו מפריד
    hydrated = hydrated.replace(/^\*{6,}\s*$/gm, '<hr class="separator">');

    // טבליות Place/Date בתחילת הספר (אם יש)
    const lines = hydrated.split(/\r?\n/);
    const { html: metaHtml, rest } = pillsFromHead(lines);

    // ניקוי כפלי רווחים ועיבוד שורות
    let bodyHtml = rest
      .replace(/\r/g,'')
      // שמירה על שבירת שורות לפסקאות
      .split(/\n{2,}/).map(p => p.trim())
      .map(p => {
        // לא להסב שוב תגיות אמיתיות
        if (p.startsWith('<img ') || p.startsWith('<hr ')) return p;
        return p.replace(/\n/g,'<br>');
      })
      .join('\n\n');

    const fullHtml = metaHtml + bodyHtml;

    // חלוקה לעמודים לפי אורך יעד (דינמי)
    const pagesHtml = splitIntoPages(fullHtml);
    renderPages(pagesHtml);

  }catch(err){
    console.error(err);
    // fallback: דף ריק אלגנטי
    track.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'page';
    p.innerHTML = `<div class="page-inner"><div class="pill">Error loading text.</div></div>`;
    track.appendChild(p);
    pages = ['err'];
    pageIndex = 0;
    updateUI();
  }
})();