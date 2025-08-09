// reader.js — קורא פשוט ויציב: חיתוך לפי שורות, טעינה נעימה, ותמונות .jpg תחילה

/* ---------- קונפיגורציה ---------- */
const LINES_PER_PAGE = 16;                 // בול 16 שורות בעמוד
const IMG_EXTS       = ['.jpg','.jpeg','.png','.webp'];
const CACHE_BUSTER   = () => `?v=${Date.now()}`;

/* ---------- כלים קטנים ---------- */
const qs = (k) => {
  const v = new URLSearchParams(location.search).get(k);
  return v ? decodeURIComponent(v) : null;
};
const el = (sel) => document.querySelector(sel);

const setCounter = (i,total) => {
  el('#counter').textContent = `${i+1}/${Math.max(total,1)}`;
  el('#prev').disabled = (i<=0);
  el('#next').disabled = (i>=total-1);
};

const showLoading = (show) => {
  let overlay = el('#loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.cssText = `
      position:absolute; inset:12px 12px 86px; border-radius:18px;
      display:grid; place-items:center; background:rgba(255,255,255,.72);
      box-shadow:0 8px 24px rgba(0,0,0,.10); pointer-events:none; z-index:5;
    `;
    const pill = document.createElement('div');
    pill.textContent = 'טוען את הספר…';
    pill.style.cssText = `
      font-weight:700; color:#fff; background:#2f2a26; padding:.6rem 1.1rem;
      border-radius:999px; box-shadow:0 6px 18px rgba(0,0,0,.25)
    `;
    overlay.appendChild(pill);
    el('#stage').appendChild(overlay);
  }
  overlay.style.display = show ? 'grid' : 'none';
};

/* ---------- קבצים ---------- */
async function fetchText(url){
  const r = await fetch(url + CACHE_BUSTER(), { cache: 'no-store' });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}
function probeImage(base){
  // מנסה סיומות לפי סדר; מחזיר הבטחה ל־URL או null
  return new Promise((resolve)=>{
    let i=0, found=null;
    const tryNext = () => {
      if (found || i>=IMG_EXTS.length) return resolve(found);
      const url = `${base}${IMG_EXTS[i++]}`;
      const im  = new Image();
      im.onload = ()=>{ found=url; resolve(found); };
      im.onerror= ()=>{ found=null; tryNext(); };
      im.src = url;
    };
    tryNext();
  });
}

/* ---------- פרסינג + החלפות ---------- */
function escapeHTML(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function replaceImagesAndTokenize(raw, imgDir){
  // מזהה {image-N} גם אם מופיע באמצע שורה -> כל תמונה תהיה עמוד בפני עצמו.
  // כמו כן: שורה של ****** => מפריד (hr).
  const tokens = []; // {type:'line'|'blank'|'hr'|'image', html/text}
  const lines = raw.split(/\r?\n/);

  for (let line of lines){
    // meta pills נשמרים בחוץ (נחלץ לפני הקריאה לפונקציה הזו)
    if (/^\*{6,}\s*$/.test(line)) { tokens.push({type:'hr'}); continue; }
    if (/^\s*$/.test(line))       { tokens.push({type:'blank'}); continue; }

    // פיצול שורה אם יש בה תמונות
    const parts = line.split(/(\{image-(\d+)\})/g);
    for (let j=0; j<parts.length; j++){
      const seg = parts[j];
      if (!seg) continue;
      const m = seg.match(/^\{image-(\d+)\}$/);
      if (m){
        const num = m[1];
        const base = `${imgDir}/image-${num}`;
        const url  = await probeImage(base);
        // תמיד עמוד משל עצמו; אם לא נמצא — כיתוב חסר
        tokens.push({
          type: url ? 'image' : 'line',
          html: url ? `<figure style="margin:0">
                          <img src="${url}" alt="image-${num}" style="width:100%;height:auto;border-radius:10px"/>
                        </figure>`
                    : escapeHTML(`[Missing image ${num}]`)
        });
      }else{
        tokens.push({type:'line', text: seg});
      }
    }
  }
  return tokens;
}

/* ---------- עימוד לפי 16 שורות ---------- */
function paginateByLines(tokens, metaHTML){
  const pages = [];
  let linesUsed = 0;
  let buf = [];

  const flush = () => {
    pages.push(buf.join('\n'));
    buf = [];
    linesUsed = 0;
  };

  // עמוד ראשון – אם יש meta pills
  if (metaHTML){
    buf.push(`<div class="meta-pills">${metaHTML}</div>`);
    // נחשב את המטא כשורה אחת "וירטואלית" כדי שלא נאכל הרבה מקום
    linesUsed += 1;
  }

  for (const tk of tokens){
    if (tk.type === 'image'){
      // תמונה תמיד עמוד נפרד
      if (buf.length) flush();
      pages.push(tk.html);
      continue;
    }
    if (tk.type === 'hr'){
      // מפריד — מוסיף קו וגומר שורה אחת
      buf.push('<hr class="separator">');
      linesUsed += 1;
      if (linesUsed >= LINES_PER_PAGE){ flush(); }
      continue;
    }
    // line / blank
    const html = (tk.type==='blank')
      ? '<div class="ln">&nbsp;</div>'
      : `<div class="ln">${escapeHTML(tk.text)}</div>`;

    buf.push(html);
    linesUsed += 1;

    if (linesUsed >= LINES_PER_PAGE){
      flush();
    }
  }
  if (buf.length) flush();

  // לפחות עמוד אחד
  return pages.length ? pages : [''];
}

/* ---------- רינדור וניווט ---------- */
function clearTrack(){ const t=el('#track'); while(t.firstChild) t.removeChild(t.firstChild); }

function buildPage(html){
  const p   = document.createElement('div'); p.className='page';
  const card= document.createElement('div'); card.className='page-card';
  const inn = document.createElement('div'); inn.className='page-inner page-ltr';
  inn.innerHTML = html;
  card.appendChild(inn); p.appendChild(card);
  return p;
}

function renderPages(pages){
  const track = el('#track');
  clearTrack();
  pages.forEach(h => track.appendChild(buildPage(h)));
  // התאמת רוחב למסילה
  track.style.width = `${pages.length * 100}%`;
  [...track.children].forEach(pg => pg.style.width = `${100/pages.length}%`);
}

function enableNav(pages){
  let idx = 0;
  const go = (i) => {
    idx = Math.max(0, Math.min(pages.length-1, i));
    const x = -idx * el('#stage').clientWidth;
    const tr = el('#track');
    tr.style.transition = 'transform 260ms ease';
    tr.style.transform  = `translate3d(${x}px,0,0)`;
    setCounter(idx, pages.length);
  };

  el('#prev').onclick = ()=>go(idx-1);
  el('#next').onclick = ()=>go(idx+1);

  // החלקה פשוטה ועמידה
  const stage = el('#stage');
  let x0=null, y0=null, t0=0;
  stage.addEventListener('touchstart', e=>{
    const t=e.touches[0]; x0=t.clientX; y0=t.clientY; t0=Date.now();
  }, {passive:true});
  stage.addEventListener('touchend', e=>{
    if(x0==null) return;
    const t=e.changedTouches[0];
    const dx=t.clientX-x0, dy=Math.abs(t.clientY-y0), dt=Date.now()-t0;
    x0=null;
    if(dy<60 && dt<600 && Math.abs(dx)>40){
      if(dx<0) go(idx+1); else go(idx-1);
    }
  }, {passive:true});

  // התחלה
  go(0);
}

/* ---------- MAIN ---------- */
(async function init(){
  try{
    showLoading(true);

    const slug = qs('book');
    if(!slug){
      renderPages(['Missing ?book=']);
      setCounter(0,1);
      showLoading(false);
      return;
    }

    const txtURL = `books/${slug}/book.txt`;
    const imgDir = `books/${slug}/images`;

    let raw = await fetchText(txtURL);

    // חילוץ Place/Date מהשורות הראשונות (לא חובה)
    let place=null, date=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

    const meta = [
      date  ? `<span class="pill">Date: ${escapeHTML(date)}</span>` : '',
      place ? `<span class="pill">Place: ${escapeHTML(place)}</span>`: ''
    ].filter(Boolean).join(' ');

    // טוקניזציה + החלפת תמונות
    const tokens = await replaceImagesAndTokenize(raw, imgDir);

    // עימוד קשיח לפי 16 שורות
    const pages  = paginateByLines(tokens, meta);

    // רינדור וניווט
    renderPages(pages);
    enableNav(pages);

    showLoading(false);
  }catch(err){
    console.error(err);
    showLoading(false);
    renderPages([`<div>בעיה בטעינה<br>${escapeHTML(String(err))}</div>`]);
    setCounter(0,1);
  }
})();