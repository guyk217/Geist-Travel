// Reader v2 — עימוד יציב לפי 16 שורות:
/*
  - מחשב charsPerLine לפי רוחב ותכונות הפונט (Canvas measureText)
  - עוטף מילים; לא שוברים באמצע מילה אלא אם היא ארוכה מדי
  - ****** -> <hr> ונחשבת כשורה אחת
  - {image-N} -> עמוד תמונה נפרד (books/<slug>/images/image-N.jpg)
  - בלי מדידות scrollHeight, בלי לופים אינסופיים
*/

const LINES_PER_PAGE = 16;             // כמה שורות לעמוד
const IMG_EXT = '.jpg';                // לפי הבקשה – JPG בלבד
const qs = (k) => new URLSearchParams(location.search).get(k);
const $  = (s) => document.querySelector(s);

const setCounter = (i,total)=>{
  $('#counter').textContent = `${i+1}/${Math.max(total,1)}`;
  $('#prev').disabled = (i<=0);
  $('#next').disabled = (i>=total-1);
};
const showLoading = (on)=>{ $('#loadingOverlay').style.display = on ? 'grid' : 'none'; };

async function fetchText(url){
  const r = await fetch(url + `?v=${Date.now()}`, {cache:'no-store'});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
const esc = (s)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ---------- חישוב תווים לשורה בפועל ---------- */
function calcCharsPerLine(){
  // בונים אלמנט נסתר עם אותם חוקים של .page-inner כדי להוציא את רוחב התוכן והפונט
  const probe = document.createElement('div');
  probe.className = 'page-inner';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.height = '0';
  probe.style.overflow = 'hidden';
  probe.textContent = 'X';
  // מכניסים בתוך card כמו במציאות כדי לקבל paddings נכונים
  const wrap = document.createElement('div'); wrap.className = 'page-card';
  const page = document.createElement('div'); page.className = 'page';
  wrap.appendChild(probe); page.appendChild(wrap); $('#stage').appendChild(page);

  const style = getComputedStyle(probe);
  const innerWidth = probe.clientWidth;                 // רוחב התוכן לשורות בפועל
  const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;

  // Canvas למדוד רוחב ממוצע לתו בפונט הזה
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;

  // מדגמים מחרוזת ארוכה ומחלקים במספר התווים כדי לקבל רוחב ממוצע
  const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,;:!?\'"()[]{}-–—0123456789';
  const repeated = sample.repeat(8);
  const pxPerChar = ctx.measureText(repeated).width / repeated.length;

  // ניקוי
  $('#stage').removeChild(page);

  // חיץ קטן כדי שלא נהיה על הקצה
  const chars = Math.max(25, Math.min(140, Math.floor(innerWidth / pxPerChar) - 2));
  return { charsPerLine: chars, lineHeight: parseFloat(style.lineHeight) || 28 };
}

/* ---------- Tokenize לטקסט עם תמונות/מפרידים ---------- */
function tokenize(raw, slug){
  const exp = raw.replace(/\{image-(\d+)\}/g, '\n[IMG:$1]\n');   // תמונות לשורה עצמאית
  const rows = exp.split(/\r?\n/);
  const tokens = []; // image/hr/blank/line

  for (const r of rows){
    if (/^\[IMG:(\d+)\]$/.test(r)){
      const n = r.match(/^\[IMG:(\d+)\]$/)[1];
      const url = `books/${slug}/images/image-${n}${IMG_EXT}`;
      tokens.push({type:'image', html:`<figure style="margin:0"><img src="${url}" alt="image-${n}"></figure>`});
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

/* ---------- עטיפת פסקאות לשורות לפי charsPerLine ---------- */
function wrapParagraph(text, maxChars){
  // עוטף לפי מילים; מילה ארוכה מדי נחתכת "קשה" עם היפנים רכים
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';

  const push = ()=>{
    lines.push(cur);
    cur = '';
  };

  for (let w of words){
    if (!w) continue;
    if (cur.length === 0){
      if (w.length <= maxChars){ cur = w; }
      else {
        // מילה ארוכה – מפצלים לנתחים בגודל maxChars
        while (w.length > maxChars){
          lines.push(w.slice(0, maxChars));
          w = w.slice(maxChars);
        }
        cur = w;
      }
    } else {
      if (cur.length + 1 + w.length <= maxChars){
        cur += ' ' + w;
      } else {
        push();
        if (w.length <= maxChars){ cur = w; }
        else {
          while (w.length > maxChars){
            lines.push(w.slice(0, maxChars));
            w = w.slice(maxChars);
          }
          cur = w;
        }
      }
    }
  }
  if (cur.length) push();
  return lines;
}

/* ---------- עימוד קשיח: 16 שורות לעמוד ---------- */
function paginate(tokens, metaHTML, charsPerLine){
  const pages = [];
  let buffer = [];     // HTML של העמוד הנוכחי
  let used   = 0;      // כמה "שורות" מנוצלות בעמוד

  const flush = ()=>{
    pages.push(buffer.join('\n'));
    buffer = [];
    used   = 0;
  };

  // מטא בתחילת הספר = שורה אחת
  if (metaHTML){
    buffer.push(`<div class="meta-pills">${metaHTML}</div>`);
    used += 1;
  }

  // נאגד שורות רצופות לפסקה אחת כדי לעטוף נורמלי
  let para = [];

  const flushPara = ()=>{
    if (!para.length) return;
    const text = para.join(' ');
    const wrapped = wrapParagraph(text, charsPerLine);
    for (const ln of wrapped){
      buffer.push(`<div class="ln">${esc(ln)}</div>`);
      used += 1;
      if (used >= LINES_PER_PAGE){ flush(); }
    }
    para = [];
  };

  for (const tk of tokens){
    if (tk.type === 'line'){ para.push(tk.text); continue; }
    // כל דבר שאינו line – קודם נסיים פסקה פתוחה
    flushPara();

    if (tk.type === 'blank'){
      buffer.push('<div class="ln">&nbsp;</div>');
      used += 1;
      if (used >= LINES_PER_PAGE) flush();
    } else if (tk.type === 'hr'){
      buffer.push('<hr class="separator">');
      used += 1;
      if (used >= LINES_PER_PAGE) flush();
    } else if (tk.type === 'image'){
      // תמונה – עמוד מלא לעצמה
      if (buffer.length) flush();
      pages.push(tk.html);
    }
  }
  // סוף הטקסט
  flushPara();
  if (buffer.length) flush();
  return pages.length ? pages : [''];
}

/* ---------- רינדור + ניווט ---------- */
function clearTrack(){ const t=$('#track'); while(t.firstChild) t.removeChild(t.firstChild); }
function buildPage(html){
  const p = document.createElement('div'); p.className='page';
  p.innerHTML = `<div class="page-card"><div class="page-inner">${html}</div></div>`;
  return p;
}
function renderPages(pages){
  const track = $('#track');
  clearTrack();
  pages.forEach(h => track.appendChild(buildPage(h)));
}

function enableNav(pages){
  let idx=0;
  const go = (i)=>{
    idx = Math.max(0, Math.min(pages.length-1, i));
    const x = -idx * $('#stage').clientWidth;
    const tr = $('#track');
    tr.style.transition = 'transform 260ms ease';
    tr.style.transform  = `translate3d(${x}px,0,0)`;
    setCounter(idx, pages.length);
  };
  $('#prev').onclick = ()=>go(idx-1);
  $('#next').onclick = ()=>go(idx+1);

  // החלקה
  const stage = $('#stage');
  let x0=null, y0=null, t0=0;
  stage.addEventListener('touchstart', e=>{ const t=e.touches[0]; x0=t.clientX; y0=t.clientY; t0=Date.now(); },{passive:true});
  stage.addEventListener('touchend',   e=>{
    if(x0==null) return;
    const t=e.changedTouches[0]; const dx=t.clientX-x0; const dy=Math.abs(t.clientY-y0); const dt=Date.now()-t0; x0=null;
    if(dy<60 && dt<600 && Math.abs(dx)>40){ if(dx<0) go(idx+1); else go(idx-1); }
  },{passive:true});

  addEventListener('resize', ()=>go(idx)); // לא מחשב מחדש עמודים — אין צורך, כי אנחנו לפי תווים

  go(0);
}

/* ---------- MAIN ---------- */
(async function init(){
  try{
    showLoading(true);

    const slug = qs('book');
    if(!slug){ renderPages(['Missing ?book=']); setCounter(0,1); showLoading(false); return; }

    const txtURL = `books/${slug}/book.txt`;
    let raw = await fetchText(txtURL);

    // Place/Date מראש (אם קיימים)
    let place=null, date=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

    const { charsPerLine } = calcCharsPerLine();

    const pills = [
      date  ? `<span class="pill">Date: ${esc(date)}</span>`  : '',
      place ? `<span class="pill">Place: ${esc(place)}</span>`: ''
    ].filter(Boolean).join(' ');

    const tokens = tokenize(raw, slug);
    const pages  = paginate(tokens, pills, charsPerLine);

    renderPages(pages);
    enableNav(pages);
    showLoading(false);
  }catch(err){
    console.error(err);
    renderPages([`<div class="ln">בעיה בטעינה</div><div class="ln">${esc(String(err))}</div>`]);
    setCounter(0,1);
    showLoading(false);
  }
})();