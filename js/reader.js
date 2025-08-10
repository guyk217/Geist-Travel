// Reader v2.3 — דפדוף יציב, 18 שורות לעמוד, תמונות JPG כעמוד נפרד, טעינה עדינה
const LINES_PER_PAGE = 18;          // שנה כאן אם תרצה
const IMG_EXT = '.jpg';
const qs = k => new URLSearchParams(location.search).get(k);
const $  = s => document.querySelector(s);

const esc = s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function setCounter(i,total){
  $('#counter').textContent = `${i+1}/${Math.max(total,1)}`;
  $('#prev').disabled = (i<=0);
  $('#next').disabled = (i>=total-1);
}

/* ---------- שכבת טעינה עדינה בתוך ה-stage ---------- */
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
    }
  `;
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

/* ---------- חישוב תווים לשורה לפי רוחב .page-inner האמיתי ---------- */
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
  const repeated = sample.repeat(8);
  const pxPerChar = ctx.measureText(repeated).width / repeated.length;

  stage.removeChild(page);
  const chars = Math.max(24, Math.min(140, Math.floor(innerWidth / pxPerChar) - 2));
  return chars;
}

/* ---------- המרה לטוקנים: טקסט/ריק/מפריד/תמונה ---------- */
function tokenize(raw, slug) {
  const exp = raw.replace(/\{image-(\d+)\}/g, '\n[IMG:$1]\n');
  const rows = exp.split(/\r?\n/);
  const tokens = [];

  for (const r of rows) {
    if (/^\[IMG:(\d+)\]$/.test(r)) {
      const n = parseInt(r.match(/^\[IMG:(\d+)\]$/)[1], 10);
      const basePath = `books/${slug}/images/image-${n}`;

      // קבע סיומת ראשית לפי אם זה הקאבר או לא
      const primaryExt = (n === 1) ? 'jpg' : 'jpeg';
      const fallbackExt = (primaryExt === 'jpg') ? 'jpeg' : 'jpg';

      const html = `
        <figure style="margin:0;display:flex;align-items:center;justify-content:center;height:100%;">
          <img 
            src="${basePath}.${primaryExt}"
            alt="image-${n}" 
            loading="lazy" 
            decoding="async"
            onerror="this.onerror=null; this.src='${basePath}.${fallbackExt}';"
            style="max-width:100%;max-height:100%;border-radius:8px;display:block"
          >
        </figure>`;

      tokens.push({ type: 'image', html });
    } else if (/^\*{6,}\s*$/.test(r)) {
      tokens.push({ type: 'hr' });
    } else if (/^\s*$/.test(r)) {
      tokens.push({ type: 'blank' });
    } else {
      tokens.push({ type: 'line', text: r });
    }
  }
  return tokens;
}

/* ---------- עטיפה למילים → שורות לפי מקס' תווים ---------- */
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

/* ---------- עימוד קשיח: N שורות לעמוד; תמונות = עמוד עצמאי ---------- */
function paginate(tokens, metaHTML, charsPerLine){
  const pages = [];
  let buffer = [], used = 0;

  const flush = ()=>{ pages.push(buffer.join('\n')); buffer=[]; used=0; };

  if (metaHTML){ buffer.push(`<div class="date-banner">${metaHTML}</div>`); used += 1; }

  let para=[];
  const flushPara=()=>{
    if(!para.length) return;
    const wrapped = wrapParagraph(para.join(' '), charsPerLine);
    for (const ln of wrapped){
      buffer.push(`<div class="ln">${esc(ln)}</div>`);
      if(++used>=LINES_PER_PAGE) flush();
    }
    para=[];
  };

  for (const tk of tokens){
    if (tk.type==='line'){ para.push(tk.text); continue; }
    flushPara();

    if (tk.type==='blank'){
      buffer.push('<div class="ln">&nbsp;</div>');
      if(++used>=LINES_PER_PAGE) flush();
    } else if (tk.type==='hr'){
      buffer.push('<hr class="separator">');
      if(++used>=LINES_PER_PAGE) flush();
    } else if (tk.type==='image'){
      if (buffer.length) flush();
      pages.push(tk.html);  // תמונה כעמוד מלא
    }
  }
  flushPara();
  if (buffer.length) flush();
  return pages.length ? pages : [''];
}

/* ---------- רינדור, רוחבים וניווט יציב ---------- */
function clearTrack(){ const t=$('#track'); while(t.firstChild) t.removeChild(t.firstChild); }
function buildPage(html){ const p=document.createElement('div'); p.className='page'; p.innerHTML=`<div class="page-card"><div class="page-inner">${html}</div></div>`; return p; }
function renderPages(pages){
  const t=$('#track'); clearTrack();
  pages.forEach(h=>t.appendChild(buildPage(h)));
}
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
function enableNav(pages){
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
    // שמור בעמוד נוכחי
    $('#track').style.transition='none';
    $('#track').style.transform=`translate3d(${-idx*stageW}px,0,0)`;
    setCounter(idx, pages.length);
  });

  go(0);
}

/* ---------- תאריך "יום, חודש מספר" מודגש + שנה בנפרד ---------- */
function formatDateStrong(s){
  const d = new Date(s);
  if (isNaN(d)) return { strong: esc(s), year: '' };
  const strong = new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric'}).format(d);
  return { strong: esc(strong), year: String(d.getFullYear()) };
}

/* ======================= MAIN ======================= */
(async function init(){
  try{
    showLoading(true);

    const slug = qs('book');
    if(!slug){ renderPages(['Missing ?book=']); setCounter(0,1); showLoading(false); return; }

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
    const pages  = paginate(tokens, metaHTML, charsPerLine);

    renderPages(pages);
    enableNav(pages);
  }catch(err){
    console.error(err);
    renderPages([`<div class="ln">שגיאה בטעינה</div><div class="ln">${esc(String(err))}</div>`]);
    setCounter(0,1);
  }finally{
    showLoading(false);
  }
})();