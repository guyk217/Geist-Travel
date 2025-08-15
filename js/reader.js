// Reader יציב ומהיר: עימוד חזותי לפי גובה, Lazy Images, שמירת DOM קטן,
// טעינה של עמוד נוכחי + שכנים בלבד, תמונות ב-LQ עד לטעינה, וכפתור לאיכות מלאה.
//
// מבנה ספר: books/<slug>/book.txt  +  books/<slug>/images/image-N.(jpeg|jpg|png|webp)
// הערה: הקאבר יכול להיות .jpg – קבצי התוכן ברובם .jpeg. יש זיהוי אוטומטי.

// ---------- כלי עזר ----------
const EXTENSIONS = ['.jpeg', '.jpg', '.png', '.webp'];

const qs = name => {
  const v = new URLSearchParams(location.search).get(name);
  return v ? decodeURIComponent(v) : null;
};

const $ = sel => document.querySelector(sel);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const fetchText = async (url) => {
  const r = await fetch(url + `?v=${Date.now()}`, { cache:'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
};

// בדיקת קובץ תמונה קיים
async function probeImage(baseUrl){
  for (const ext of EXTENSIONS){
    const url = `${baseUrl}${ext}`;
    const ok = await new Promise(res=>{
      const im = new Image();
      im.onload = ()=>res(true);
      im.onerror = ()=>res(false);
      im.src = url;
    });
    if (ok) return url;
  }
  return null;
}

// escape בסיסי
const escapeHTML = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ---------- המרה לטוקנים ----------
/*
  הופך את הטקסט ל"טוקנים" (יחידות עימוד):
  - פסקאות
  - מפריד ****** => <hr>
  - תמונות => בלוק עם יחס ממדים יציב (נטען תמונה עצלה כשמופיעה)
*/
async function textToTokens(raw, imgDir){
  // Place/Date בתחילת הספר (לא חובה)
  let place=null, date=null;
  raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
  raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date=v.trim();  return ''; });

  // החלפת {image-N} לפלייסהולדרים עם נתיב קבוע מראש
  const jobs = [];
  raw = raw.replace(/\{image-(\d+)\}/g, (m,n)=>{
    const ph = `@@IMG_${n}@@`;
    jobs.push((async ()=>{
      const src = await probeImage(`${imgDir}/image-${n}`);
      return {ph, src};   // ייתכן null => נציג "חסר"
    })());
    return ph;
  });
  const imgs = await Promise.all(jobs);

  // פיצול לשורות → יצירת טוקנים
  const tokens = [];
  const pushP = (txt) => {
    const t = txt.trim();
    if (!t) return;
    tokens.push({type:'p', html:`<p>${escapeHTML(t)}</p>`});
  };

  let buf = '';
  const lines = raw.split(/\r?\n/);
  for (let line of lines){
    // החזרת הפלייסהולדרים לטוקן תמונה
    const m = line.match(/^@@IMG_(\d+)@@\s*$/);
    if (m){
      if (buf) { pushP(buf); buf=''; }
      const ref = imgs.find(x => x.ph === `@@IMG_${m[1]}@@`);
      if (ref && ref.src){
        tokens.push({type:'img', src: ref.src});
      }else{
        tokens.push({type:'sep'});
        tokens.push({type:'p', html:`<p><em>Missing image ${m[1]}</em></p>`});
        tokens.push({type:'sep'});
      }
      continue;
    }

    // קו מפריד מכוכביות
    if (/^\*{6,}\s*$/.test(line)){
      if (buf) { pushP(buf); buf=''; }
      tokens.push({type:'sep'});
      continue;
    }

    // שורה ריקה = סוף פסקה
    if (/^\s*$/.test(line)){
      if (buf) { pushP(buf); buf=''; }
      continue;
    }

    // אחרת – צבירת פסקה
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) pushP(buf);

  // הזרקת Place/Date לראש הדפים
  if (date || place){
    const pills=[];
    if (date)  pills.push(`<span class="pill">Date: ${escapeHTML(date)}</span>`);
    if (place) pills.push(`<span class="pill">Place: ${escapeHTML(place)}</span>`);
    tokens.unshift({type:'meta', html:`<div class="meta-pills">${pills.join(' ')}</div>`});
  }

  return tokens;
}

// ---------- עימוד חזותי ----------
/*
  נעשה מדידה אמיתית בתוך page-inner "מדידה" נסתר.
  מוסיפים טוקן-טוקן עד שהוא לא נכנס → חותכים לפסקאות לפי מילים.
  בלוקי תמונה הם קבועי גובה (aspect-ratio) ולכן לא שוברים את העימוד.
*/
function makeMeasurer(){
  const meas = document.createElement('div');
  meas.className = 'page-inner';
  meas.style.position = 'absolute';
  meas.style.visibility = 'hidden';
  meas.style.pointerEvents = 'none';
  meas.style.inset = '0';
  $('#stage').appendChild(meas);
  return meas;
}

function getMaxContentHeight(){
  // גובה פנימי אמיתי של ה-page-inner
  const stage = $('#stage');
  const style = getComputedStyle(stage);
  const avail = stage.clientHeight
    - parseFloat(style.paddingTop||0)
    - parseFloat(style.paddingBottom||0)
    - 0;
  // הפחתה קלה לריווח בטוח
  return Math.max(200, avail - 6);
}

function tokenHTML(tk){
  if (tk.type === 'p')   return tk.html;
  if (tk.type === 'meta')return tk.html;
  if (tk.type === 'sep') return '<hr class="separator">';
  if (tk.type === 'img'){
    // בלוק עם יחס יציב; נטען תמונה אמיתית רק כשהעמוד מוצג
    return `
      <figure class="img-block" data-src="${tk.src}">
        <img alt="" decoding="async" loading="lazy" src="${tk.src}">
        <button class="img-open" title="פתח באיכות מלאה">↔️</button>
      </figure>`;
  }
  return '';
}

function splitParagraphHTML(html){
  // מפצל פסקה ל"חלקי מילים" כדי למלא עמוד יפה.
  // קלט כמו "<p>some text…</p>" → מוציא רק הטקסט הפנימי
  const text = html.replace(/^<p>/,'').replace(/<\/p>$/,'');
  const parts = text.split(/(\s+)/); // שומר רווחים
  return parts.map(p => escapeHTML(p)).map(p => p ? `<span>${p}</span>` : p);
}

function paginate(tokens){
  const pages = [];
  const meas = makeMeasurer();
  const maxH = getMaxContentHeight();

  let cur = '';      // HTML של העמוד הנוכחי
  const flush = ()=>{
    pages.push(cur || '<p></p>');
    cur = '';
  };

  const fits = (candidate)=>{
    meas.innerHTML = candidate;
    return meas.scrollHeight <= maxH;
  };

  for (const tk of tokens){
    const html = tokenHTML(tk);

    // בלוקים שאינם פסקאות – מנסים להכניס שלמים
    if (tk.type !== 'p'){
      const tryHtml = cur + html;
      if (fits(tryHtml)){
        cur = tryHtml;
      }else{
        flush();
        // אם לא נכנס בעמוד ריק (נדיר), נכריח בדף נפרד
        if (!fits(html)) {
          // במקרים חריגים (כמעט לא קורה) – נכפה גובה קטן יותר:
          meas.style.paddingBottom = '20px';
        }
        cur = html;
      }
      continue;
    }

// פסקה – נפרק לשורות במקום למילים
const lines = html
  .replace(/^<p>/, '').replace(/<\/p>$/, '')
  .split(/\n/); // שבר לפי שורות

let buf = '<p>';
let lineCount = 0;
for (const line of lines) {
  buf += escapeHTML(line) + '\n';
  lineCount++;

  const tryHtml = cur + buf + '</p>';
  const fitsHeight = fits(tryHtml);
  const fitsLines  = lineCount <= 16; // עד 16 שורות לעמוד

  if (!fitsHeight || !fitsLines) {
    cur += buf + '</p>';
    flush(); // סיום עמוד
    buf = '<p>';
    lineCount = 0;
  }
}
cur += buf + '</p>';
  }
  if (cur) flush();

  meas.remove();
  return pages;
}

// ---------- מציג עמוד + Lazy Images + שכנים ----------
let PAGES = [];        // מערך HTML של עמודים
let INDEX = 0;         // עמוד נוכחי
let RENDERED = new Map(); // זיכרון קטן לעמודים סמוכים

function setCounter(i, total){
  $('#counter').textContent = `${i+1}/${Math.max(total,1)}`;
  $('#prev').disabled = (i<=0);
  $('#next').disabled = (i>=total-1);
}

function mountHTML(html){
  const host = $('#page');
  host.innerHTML = html;

  // Lazy image: כבר יש לנו <img> עם src; אנחנו פשוט מסירים blur כשנטען,
  // ומשאירים רק בעמוד מוצג. ביציאה מהעמוד ננקה כדי לשמור על זיכרון.
  host.querySelectorAll('.img-block').forEach(block=>{
    const img = block.querySelector('img');
    const full = block.getAttribute('data-src') || img.currentSrc || img.src;

    if (!img.complete){
      img.addEventListener('load', ()=> block.classList.add('loaded'), {once:true});
      img.addEventListener('error',()=> block.classList.add('loaded'), {once:true});
    }else{
      block.classList.add('loaded');
    }

    // פתיחה באיכות מלאה
    block.querySelector('.img-open').addEventListener('click', (e)=>{
      e.stopPropagation();
      window.open(full, '_blank');
    });
  });
}

function render(i, noAnim=false){
  INDEX = Math.max(0, Math.min(PAGES.length-1, i));
  setCounter(INDEX, PAGES.length);

  const card = $('.page-card');
  if (!noAnim){
    card.style.transition='opacity .18s ease';
    card.style.opacity='0';
  }

  // ננקה DOM של תמונות ישנות כדי לחסוך זיכרון
  $('#page').innerHTML = '';

  // מציגים
  mountHTML(PAGES[INDEX]);

  // קאפיינג: נשמור HTML בלבד (לא DOM) – אין פה דליפת זיכרון
  RENDERED.clear();
  if (PAGES[INDEX-1]) RENDERED.set(INDEX-1, PAGES[INDEX-1]);
  if (PAGES[INDEX])   RENDERED.set(INDEX,   PAGES[INDEX]);
  if (PAGES[INDEX+1]) RENDERED.set(INDEX+1, PAGES[INDEX+1]);

  requestAnimationFrame(()=>{
    if (!noAnim){
      card.style.opacity='1';
    }
  });
}

// ---------- מחוות ותפעול ----------
function enableSwipe(onLeft, onRight){
  const el = $('#stage');
  let x0=null, y0=null, t0=0;
  const minDx=40, maxDy=60, maxT=600;
  el.addEventListener('touchstart', e=>{
    const t=e.touches[0]; x0=t.clientX; y0=t.clientY; t0=Date.now();
  },{passive:true});
  el.addEventListener('touchend', e=>{
    if(x0==null) return;
    const t=e.changedTouches[0];
    const dx=t.clientX-x0, dy=Math.abs(t.clientY-y0), dt=Date.now()-t0;
    x0=null;
    if(dy<maxDy && dt<maxT && Math.abs(dx)>minDx){
      if(dx<0) onRight(); else onLeft();
    }
  },{passive:true});
}

// ---------- Init ----------
(async function init(){
  $('#back').onclick = ()=> history.back();
  $('#jump').onclick = ()=>{
    const n = prompt(`קפיצה לעמוד (1–${PAGES.length || 1})`, String(INDEX+1));
    const i = Math.max(1, Math.min(PAGES.length, parseInt(n,10)||1));
    render(i-1);
  };
  $('#prev').onclick = ()=> render(INDEX-1);
  $('#next').onclick = ()=> render(INDEX+1);
  enableSwipe(()=>render(INDEX-1), ()=>render(INDEX+1));

  const slug = qs('book');
  if(!slug){
    $('#page').innerHTML = '<p>Missing ?book=</p>';
    return;
  }

  const txtURL = `books/${slug}/book.txt`;
  const imgDir = `books/${slug}/images`;

  try{
    $('#loader').style.display='grid';

    // 1) טען טקסט
    let raw = await fetchText(txtURL);
    if (!raw.trim()){
      $('#page').innerHTML = '<p>Empty book.txt</p>';
      $('#loader').style.display='none';
      return;
    }

    // 2) המר לטוקנים (כולל זיהוי קבצי תמונה קיימים)
    const tokens = await textToTokens(raw, imgDir);

    // 3) עימוד חזותי – דפי HTML מוכנים
    PAGES = paginate(tokens);

    // 4) תצוגה ראשונה
    render(0, /*noAnim*/ true);

    // 5) סיום טעינה
    await sleep(120);
    $('#loader').style.display='none';

    // 6) ריסייז – מחשב עימוד מחדש, ועדיין נשאר באותו עמוד לוגית
    addEventListener('resize', ()=>{
      const keep = INDEX;
      $('#loader').style.display='grid';
      requestAnimationFrame(()=>{
        PAGES = paginate(tokens);
        render(Math.min(keep, PAGES.length-1), true);
        $('#loader').style.display='none';
      });
    });

  }catch(err){
    console.error(err);
    $('#page').innerHTML = `<p>אירעה שגיאה בטעינת הספר:<br>${escapeHTML(String(err))}</p>`;
    $('#loader').style.display='none';
  }
})();