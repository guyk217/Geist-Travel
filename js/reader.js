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

// === פגינציה פשוטה ומהירה: לפי כמות מילים ===
function paginate(tokens){
  // כוונון מהיר: כמה מילים בעמוד? (160 ≈ ~16 שורות במסך טלפון)
  const WORDS_PER_PAGE = 160;
  const IMG_WEIGHT = 40;  // "עלות" תמונה במילים
  const SEP_WEIGHT = 10;  // "עלות" מפריד ****** במילים

  const pages = [];
  let curHTML  = '';
  let curWords = 0;

  const flush = () => {
    pages.push(curHTML.trim() ? curHTML : '<p></p>');
    curHTML = '';
    curWords = 0;
  };

  // עוזר קטן: הוספת פסקה מטקסט גולמי (ללא <p> מסביב)
  const addParagraph = (txt) => {
    curHTML += `<p>${txt}</p>`;
  };

  for (const tk of tokens) {
    if (tk.type === 'p') {
      // נורמליזציה של הפסקה לטקסט (בלי תגיות)
      const raw = tk.html
        .replace(/^<p>/, '')
        .replace(/<\/p>$/, '')
        .replace(/\s+/g, ' ')
        .trim();

      // פסקה ריקה
      if (!raw) {
        if (curWords >= WORDS_PER_PAGE) flush();
        addParagraph('&nbsp;');
        continue;
      }

      // שברים לפי מילים – בלי מדידות DOM
      const words = raw.split(' ');
      let buf = ''; // אוגר המילים לפסקה הנוכחית

      for (let i = 0; i < words.length; i++) {
        const w = words[i];

        // אם עברנו את היעד – סגור מה שיש ופתח עמוד חדש
        if (curWords >= WORDS_PER_PAGE) {
          if (buf) { addParagraph(buf); buf = ''; }
          flush();
        }

        if (buf) buf += ' ' + w; else buf = w;
        curWords += 1;
      }

      // סוף הפסקה – כתוב את מה שנשאר
      if (buf) addParagraph(buf);
      continue;
    }

    // בלוקים שאינם פסקאות (תמונה / מפריד / מטא)
    let html = '';
    let weight = 0;

    if (tk.type === 'img') {
      html = `
        <figure class="img-block" data-src="${tk.src}">
          <img alt="" decoding="async" loading="lazy" src="${tk.src}">
          <button class="img-open" title="פתח באיכות מלאה">↔️</button>
        </figure>`;
      weight = IMG_WEIGHT;
    } else if (tk.type === 'sep') {
      html = '<hr class="separator">';
      weight = SEP_WEIGHT;
    } else if (tk.type === 'meta') {
      html = tk.html;
      weight = 0;
    } else {
      html = tk.html || '';
    }

    // אם הבלוק "שובר" את היעד – שבור עמוד לפניו (אם יש כבר תוכן)
    if (curWords > 0 && curWords + weight > WORDS_PER_PAGE) {
      flush();
    }

    curHTML += html;
    curWords += weight;
  }

  if (curHTML.trim()) flush();
  return pages;
}
  // מצב עמוד נוכחי
  let curHTML   = '';
  let curWords  = 0;

  const flush = () => {
    pages.push(curHTML.trim() ? curHTML : '<p></p>');
    curHTML  = '';
    curWords = 0;
  };

  const tryAppend = (html) => fitsLines(curHTML + html);

  // פסקה ארוכה – מילים עד הגבלה
  const appendParagraphByWords = (pHtml) => {
    const raw = pHtml.replace(/^<p>/,'').replace(/<\/p>$/,'').replace(/\s+/g,' ').trim();
    if (!raw.length){
      const ph = '<p>&nbsp;</p>';
      if (!tryAppend(ph)) flush();
      curHTML += ph;
      return;
    }

    const words = raw.split(' ');
    let bufWords = [];

    for (let i = 0; i < words.length; i++){
      const w = words[i];

      // אם עברנו את יעד המילים – שבור עמוד
      if (curWords >= WORDS_PER_PAGE_TARGET){
        if (bufWords.length){
          const chunk = `<p>${bufWords.join(' ')}</p>`;
          if (!tryAppend(chunk)) flush();
          curHTML += chunk;
          bufWords = [];
        }
        flush();
      }

      const next = (bufWords.length ? bufWords.join(' ') + ' ' : '') + w;
      const nextHtml = `<p>${next}</p>`;

      if (tryAppend(nextHtml)){
        bufWords.push(w);
        curWords += 1;
      } else {
        if (bufWords.length){
          const chunk = `<p>${bufWords.join(' ')}</p>`;
          if (!tryAppend(chunk)) flush();
          curHTML += chunk;
          bufWords = [];
        } else {
          flush(); // מילה "גדולה" שלא נכנסה – פותחים עמוד
        }

        const fresh = `<p>${w}</p>`;
        // אחרי פתיחת עמוד חדש זה אמור להיכנס
        curHTML += fresh;
        curWords += 1;
      }
    }

    if (bufWords.length){
      const chunk = `<p>${bufWords.join(' ')}</p>`;
      if (!tryAppend(chunk)) flush();
      curHTML += chunk;
    }
  };

  for (const tk of tokens){
    if (tk.type === 'p'){
      appendParagraphByWords(tk.html);
      continue;
    }

    const html   = blockHTML(tk);
    const weight = (tk.type === 'img') ? IMG_WEIGHT
                 : (tk.type === 'sep') ? SEP_WEIGHT
                 : 0;

    if (curWords > 0 && curWords + weight > WORDS_PER_PAGE_TARGET){
      flush();
    }

    if (!tryAppend(html)) flush();
    curHTML += html;
    curWords += weight;
  }

  if (curHTML.trim()) flush();
  shell.remove();
  return pages;
}

  // מצב עמוד נוכחי
  let curHTML   = '';
  let curWords  = 0;

  const flush = () => {
    pages.push(curHTML.trim() ? curHTML : '<p></p>');
    curHTML  = '';
    curWords = 0;
  };

  // נסה לצרף html לעמוד הנוכחי – תוך בדיקת שורות/גובה
  const tryAppend = (html) => {
    const candidate = curHTML + html;
    return fitsHeight(candidate) && fitsLines(candidate);
  };

  // פסקה ארוכה – נוסיף מילה-מילה עד שנחצה יעד/שורות/גובה
  const appendParagraphByWords = (pHtml) => {
    const raw = pHtml.replace(/^<p>/,'').replace(/<\/p>$/,'').replace(/\s+/g,' ').trim();
    if (!raw.length){
      // פסקה ריקה
      if (!tryAppend('<p>&nbsp;</p>')) flush();
      curHTML += '<p>&nbsp;</p>';
      return;
    }

    const words = raw.split(' ');
    let buf = [];

    for (let i = 0; i < words.length; i++){
      const w = words[i];

      // האם חצינו יעד מילים? אם כן—נשבור לפני שמוסיפים עוד
      if (curWords >= WORDS_PER_PAGE_TARGET){
        // יש משהו בבאפר? נסגור אותו לדף ונפלוש
        if (buf.length){
          const chunk = `<p>${buf.join(' ')}</p>`;
          if (!tryAppend(chunk)) flush(); // ביטחון
          curHTML += chunk;
          buf = [];
        }
        flush();
      }

      // ננסה להוסיף את המילה לפסקה הנוכחית
      const nextBuf = buf.length ? (buf.join(' ') + ' ' + w) : w;
      const nextHtml = `<p>${nextBuf}</p>`;

      if (tryAppend(nextHtml)){
        buf.push(w);
        curWords += 1;
      } else {
        // המילה לא נכנסת – קודם נסגור את מה שכן נכנס
        if (buf.length){
          const chunk = `<p>${buf.join(' ')}</p>`;
          if (!tryAppend(chunk)) flush();
          curHTML += chunk;
          buf = [];
        } else {
          // קצה קיצון: גם מילה בודדת לא נכנסת בעמוד הנוכחי → שבור עמוד
          flush();
        }

        // נסה שוב בעמוד חדש
        const freshHtml = `<p>${w}</p>`;
        if (!tryAppend(freshHtml)) {
          // במקרה קיצון נוסף (גובה/שורות קשיחים מאוד) – נכפה
          curHTML += freshHtml;
        } else {
          curHTML += freshHtml;
        }
        curWords += 1;
      }
    }

    // סגור שאריות פסקה לעמוד הנוכחי
    if (buf.length){
      const chunk = `<p>${buf.join(' ')}</p>`;
      if (!tryAppend(chunk)) flush();
      curHTML += chunk;
    }
  };

  for (const tk of tokens){
    if (tk.type === 'p'){
      appendParagraphByWords(tk.html);
      continue;
    }

    // בלוקים אחרים – משקל מילים כדי לא לדחוס טקסט מעליהם
    const html = blockHTML(tk);
    const weight = (tk.type === 'img') ? IMG_WEIGHT
                 : (tk.type === 'sep') ? SEP_WEIGHT
                 : 0;

    // אם ה"משקל" יפוצץ את היעד—שבור עמוד קודם (רק אם יש כבר תוכן)
    if (curWords > 0 && curWords + weight > WORDS_PER_PAGE_TARGET){
      flush();
    }

    if (!tryAppend(html)) {
      flush();
    }
    curHTML += html;
    curWords += weight;
  }

  if (curHTML.trim()) flush();

  shell.remove(); // ניקוי המודד
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