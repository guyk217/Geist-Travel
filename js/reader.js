// Reader v2.4 — 18 שורות, דפדוף יציב, ותמונות נטענות רק לעמוד הנוכחי/הבא.
// כלל סיומות: image-1 → .jpg תחילה; כל השאר → .jpeg תחילה; עם fallback אוטומטי.

const LINES_PER_PAGE = 18;
const qs = k => new URLSearchParams(location.search).get(k);
const $  = s => document.querySelector(s);
const esc = s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function setCounter(i,total){
  $('#counter').textContent = `${i+1}/${Math.max(total,1)}`;
  $('#prev').disabled = (i<=0);
  $('#next').disabled = (i>=total-1);
}

/* ---------- שכבת טעינה קטנה ---------- */
(function ensureOverlay(){
  if ($('#reader-aux-css')) return;
  const style = document.createElement('style');
  style.id='reader-aux-css';
  style.textContent = `
    .date-banner{margin:0 0 8px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
    .date-strong{font-weight:700;text-decoration:underline}
    .date-year{opacity:.7}
    #loadingOverlay{position:absolute;inset:0;display:none;place-items:center;z-index:4}
    #loadingOverlay .bubble{
      background:#2f2a26;color:#fff;padding:.6rem 1.1rem;border-radius:999px;
      box-shadow:0 10px 28px rgba(0,0,0,.18)
    }`;
  document.head.appendChild(style);
  const ov = document.createElement('div');
  ov.id='loadingOverlay';
  ov.innerHTML = `<div class="bubble">טוען את הספר…</div>`;
  $('#stage').appendChild(ov);
})();
const showLoading = on => { $('#loadingOverlay').style.display = on ? 'grid' : 'none'; };

async function fetchText(url){
  const r = await fetch(url + `?v=${Date.now()}`, {cache:'no-store'});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/* ---------- חישוב תווים לשורה לפי רוחב הפונט בפועל ---------- */
function calcCharsPerLine(){
  const stage = $('#stage');
  const page  = document.createElement('div'); page.className='page'; page.style.visibility='hidden';
  const card  = document.createElement('div'); card.className='page-card';
  const inner = document.createElement('div'); inner.className='page-inner'; inner.textContent='X';
  card.appendChild(inner); page.appendChild(card); stage.appendChild(page);

  const style = getComputedStyle(inner);
  const innerWidth = inner.clientWidth;
  const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d'); ctx.font = font;

  const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,;:!?\'"()[]{}-–—0123456789';
  const pxPerChar = ctx.measureText(sample.repeat(8)).width / (sample.length*8);

  stage.removeChild(page);
  return Math.max(24, Math.min(140, Math.floor(innerWidth / pxPerChar) - 2));
}

/* ---------- עוזרי תאריך ---------- */
function formatDateStrong(s){
  const d = new Date(s);
  if (isNaN(d)) return { strong: esc(s), year: '' };
  const strong = new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric'}).format(d);
  return { strong: esc(strong), year: String(d.getFullYear()) };
}

/* ---------- Tokenize: שורות/ריק/מפריד/תמונה (בלי לטעון תמונות עדיין) ---------- */
function tokenize(raw, slug){
  const exp = raw.replace(/\{image-(\d+)\}/g, '\n[IMG:$1]\n');
  const rows = exp.split(/\r?\n/);
  const tokens=[];
  for (const r of rows){
    if (/^\[IMG:(\d+)\]$/.test(r)){
      const n = parseInt(r.match(/^\[IMG:(\d+)\]$/)[1],10);
      tokens.push({type:'image', n});
    } else if (/^\*{6,}\s*$/.test(r)){
      tokens.push({type:'hr'});
    } else if (/^\s*$/.test(r)){
      tokens.push({type:'blank'});
    } else {
      tokens.push({type:'line', text:r});
    }
  }
  return tokens;
}

/* ---------- עטיפת מילים → שורות ---------- */
function wrapParagraph(text, maxChars){
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  const push=()=>{ lines.push(cur); cur=''; };
  for (let w of words){
    if(!w) continue;
    if(cur.length===0){
      if(w.length<=maxChars) cur=w;
      else { while(w.length>maxChars){ lines.push(w.slice(0,maxChars)); w=w.slice(maxChars);} cur=w; }
    }else if(cur.length+1+w.length<=maxChars){
      cur += ' '+w;
    }else{
      push();
      if(w.length<=maxChars) cur=w;
      else { while(w.length>maxChars){ lines.push(w.slice(0,maxChars)); w=w.slice(maxChars);} cur=w; }
    }
  }
  if(cur) push();
  return lines;
}

/* ---------- עימוד קשיח: 18 שורות; תמונות = עמוד עצמאי (עם מטא בנפרד) ---------- */
// נחזיר מערך עמודים: כל איבר הוא {kind:'html'|'image', html? , n?}
function paginate(tokens, metaHTML, charsPerLine){
  const pages = [];
  let buffer = [], used = 0;

  const pushHTML = () => { pages.push({kind:'html', html: buffer.join('\n') || '<br>'}); buffer=[]; used=0; };

  if (metaHTML){ buffer.push(`<div class="date-banner">${metaHTML}</div>`); used += 1; }

  let para=[];
  const flushPara = ()=>{
    if(!para.length) return;
    const wrapped = wrapParagraph(para.join(' '), charsPerLine);
    for (const ln of wrapped){
      buffer.push(`<div class="ln">${esc(ln)}</div>`);
      if(++used>=LINES_PER_PAGE) pushHTML();
    }
    para=[];
  };

  for (const tk of tokens){
    if (tk.type==='line'){ para.push(tk.text); continue; }
    flushPara();

    if (tk.type==='blank'){
      buffer.push('<div class="ln">&nbsp;</div>');
      if(++used>=LINES_PER_PAGE) pushHTML();
    } else if (tk.type==='hr'){
      buffer.push('<hr class="separator">');
      if(++used>=LINES_PER_PAGE) pushHTML();
    } else if (tk.type==='image'){
      if (buffer.length) pushHTML();
      pages.push({kind:'image', n: tk.n});
    }
  }
  flushPara();
  if (buffer.length) pushHTML();

  return pages.length ? pages : [{kind:'html', html:'<br>'}];
}

/* ---------- בניית DOM (תמונות כ-Placeholder עם data בלבד) ---------- */
function clearTrack(){ const t=$('#track'); while(t.firstChild) t.removeChild(t.firstChild); }
function pageHTML(content){ return `<div class="page-card"><div class="page-inner">${content}</div></div>`; }
function pageImagePlaceholder(slug, n){
  // לא טוענים src כאן! נטען רק כשנגיע לעמוד.
  const prefer = (n===1) ? 'jpg' : 'jpeg';
  const alt = `image-${n}`;
  return `
    <div class="page-card"><div class="page-inner" style="display:flex;align-items:center;justify-content:center">
      <figure style="margin:0;max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">
        <img data-slug="${slug}" data-n="${n}" data-loaded="0" data-prefer="${prefer}"
             alt="${esc(alt)}" style="max-width:100%;max-height:100%;border-radius:8px;display:block">
      </figure>
    </div></div>`;
}

function renderPages(pages, slug){
  const t = $('#track');
  clearTrack();
  pages.forEach(p=>{
    const div = document.createElement('div');
    div.className='page';
    if (p.kind==='html') div.innerHTML = pageHTML(p.html);
    else div.innerHTML = pageImagePlaceholder(slug, p.n);
    t.appendChild(div);
  });
}

/* ---------- ניהול רוחבים וניווט ---------- */
function sizePages(pagesLen){
  const stageW = $('#stage').clientWidth || 1;
  $('#track').style.width = `${pagesLen*stageW}px`;
  document.querySelectorAll('#track .page').forEach(p=>{
    p.style.flex='0 0 auto';
    p.style.width = `${stageW}px`;
    p.style.height='100%';
  });
  return stageW;
}

// חישוב URL לפי כללי הסיומות (עם fallback הפוך)
function imageUrlFor(slug, n, step=0){
  const prefer = (n===1) ? 'jpg' : 'jpeg';
  const alt    = (prefer==='jpg') ? 'jpeg' : 'jpg';
  const ext = (step===0 ? prefer : alt);
  return `books/${slug}/images/image-${n}.${ext}`;
}

function loadImageForPage(idx, slug, pages){
  const page = document.querySelectorAll('#track .page')[idx];
  if (!page) return;
  const img = page.querySelector('img[data-loaded="0"]');
  if (!img) return; // כבר נטען או שזה עמוד טקסט

  const n = parseInt(img.dataset.n, 10);
  img.dataset.loaded = '1'; // נסמן כדי לא לנסות שוב ושוב

  let step = 0;
  const trySrc = ()=>{
    const url = imageUrlFor(slug, n, step);
    img.onerror = ()=>{
      if (step===0){ step=1; trySrc(); }
    };
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = url;
  };
  trySrc();
}

function ensureImagesAround(index, slug, pages){
  // נטען רק את העמוד הנוכחי והסמוך (הבא + קודם)
  loadImageForPage(index, slug, pages);
  loadImageForPage(index+1, slug, pages);
  loadImageForPage(index-1, slug, pages);
}

function enableNav(pages, slug){
  let idx=0, anim=false, stageW=sizePages(pages.length);

  const go = (i)=>{
    if (anim) return;
    idx = Math.max(0, Math.min(pages.length-1, i));
    const tr = $('#track');
    tr.style.transition = 'transform 260ms ease';
    tr.style.willChange = 'transform';
    tr.style.transform  = `translate3d(${-idx*stageW}px,0,0)`;
    anim=true;
    setCounter(idx, pages.length);
    ensureImagesAround(idx, slug, pages);
    tr.addEventListener('transitionend', ()=>{ anim=false; tr.style.willChange='auto'; }, {once:true});
  };

  $('#prev').onclick = ()=>go(idx-1);
  $('#next').onclick = ()=>go(idx+1);

  // החלקה
  const stage = $('#stage');
  let x0=null,y0=null,t0=0;
  stage.addEventListener('touchstart', e=>{const t=e.touches[0];x0=t.clientX;y0=t.clientY;t0=Date.now();},{passive:true});
  stage.addEventListener('touchend', e=>{
    if(x0==null) return;
    const t=e.changedTouches[0], dx=t.clientX-x0, dy=Math.abs(t.clientY-y0), dt=Date.now()-t0;
    x0=null;
    if(dy<60 && dt<600 && Math.abs(dx)>40){ if(dx<0) go(idx+1); else go(idx-1); }
  },{passive:true});

  addEventListener('resize', ()=>{
    stageW = sizePages(pages.length);
    $('#track').style.transition='none';
    $('#track').style.transform=`translate3d(${-idx*stageW}px,0,0)`;
    setCounter(idx, pages.length);
    ensureImagesAround(idx, slug, pages);
  });

  // התחלה
  go(0);
}

/* ======================= MAIN ======================= */
(async function init(){
  try{
    showLoading(true);

    const slug = qs('book');
    if(!slug){ renderPages([{kind:'html', html:'Missing ?book='}], ''); setCounter(0,1); showLoading(false); return; }

    const txtURL = `books/${slug}/book.txt`;
    let raw = await fetchText(txtURL);

    // Place/Date מההתחלה
    let place=null, dateStr=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ dateStr=v.trim(); return ''; });

    const charsPerLine = calcCharsPerLine();

    const parts = [];
    if (dateStr){
      const {strong,year} = formatDateStrong(dateStr);
      parts.push(`<span class="date-strong">${strong}</span>`);
      if (year) parts.push(`<span class="date-year">${esc(year)}</span>`);
    }
    if (place){ parts.push(`<span class="pill">Place: ${esc(place)}</span>`); }
    const metaHTML = parts.join(' ');

    const tokens = tokenize(raw, slug);
    const pages  = paginate(tokens, metaHTML, charsPerLine); // [{kind, html|n}]

    renderPages(pages, slug);
    enableNav(pages, slug);
  }catch(err){
    console.error(err);
    renderPages([{kind:'html', html:`<div class="ln">שגיאה בטעינה</div><div class="ln">${esc(String(err))}</div>`}], '');
    setCounter(0,1);
  }finally{
    showLoading(false);
  }
})();