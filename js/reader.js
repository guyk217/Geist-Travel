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
    tokens.push({type:'p', text: t});
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
        tokens.push({type:'p', text:`Missing image ${m[1]}`});
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
    if (date)  pills.push(`Date: ${escapeHTML(date)}`);
    if (place) pills.push(`Place: ${escapeHTML(place)}`);
    tokens.unshift({type:'meta', html: pills.join(' | ')});
  }

  return tokens;
}

// ---------- מדידת עימוד מדויקת לפי שורות ----------
function createMeasurer(){
  const measurer = document.createElement('div');
  measurer.className = 'page-inner';
  measurer.style.cssText = `
    position: absolute;
    top: -9999px;
    left: -9999px;
    visibility: hidden;
    pointer-events: none;
    width: ${$('#page').offsetWidth}px;
  `;
  document.body.appendChild(measurer);
  return measurer;
}

function measureText(measurer, text) {
  measurer.innerHTML = `<p>${escapeHTML(text)}</p>`;
  const lineHeight = parseFloat(getComputedStyle(measurer).lineHeight);
  const actualHeight = measurer.scrollHeight;
  return Math.round(actualHeight / lineHeight);
}

function paginate(tokens){
  const LINES_PER_PAGE = 16;
  const measurer = createMeasurer();
  const pages = [];
  
  let currentPageHTML = '';
  let currentLines = 0;

  const finishPage = () => {
    if (currentPageHTML.trim()) {
      pages.push(currentPageHTML);
    }
    currentPageHTML = '';
    currentLines = 0;
  };

  const addContent = (html, lines) => {
    // אם הוספת התוכן תעבור את 16 השורות - סיים דף נוכחי
    if (currentLines > 0 && currentLines + lines > LINES_PER_PAGE) {
      finishPage();
    }
    
    currentPageHTML += html;
    currentLines += lines;
    
    // אם הגענו בדיוק ל-16 שורות - סיים דף
    if (currentLines >= LINES_PER_PAGE) {
      finishPage();
    }
  };

  for (const token of tokens) {
    if (token.type === 'p') {
      const fullText = token.text;
      const words = fullText.split(/\s+/);
      
      let currentParagraph = '';
      
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testParagraph = currentParagraph ? currentParagraph + ' ' + word : word;
        const testLines = measureText(measurer, testParagraph);
        
        // בדוק אם הוספת המילה תגרום לחריגה מהמקום הפנוי
        const linesNeeded = testLines;
        const availableLines = LINES_PER_PAGE - currentLines;
        
        if (linesNeeded <= availableLines || currentLines === 0) {
          // המילה נכנסת - הוסף אותה
          currentParagraph = testParagraph;
        } else {
          // המילה לא נכנסת - סיים את הפסקה הנוכחית
          if (currentParagraph) {
            const paragraphHTML = `<p>${escapeHTML(currentParagraph)}</p>`;
            const paragraphLines = measureText(measurer, currentParagraph);
            addContent(paragraphHTML, paragraphLines);
          }
          
          // התחל פסקה חדשה עם המילה הנוכחית
          currentParagraph = word;
        }
      }
      
      // סיים את הפסקה האחרונה
      if (currentParagraph) {
        const paragraphHTML = `<p>${escapeHTML(currentParagraph)}</p>`;
        const paragraphLines = measureText(measurer, currentParagraph);
        addContent(paragraphHTML, paragraphLines);
      }
      
    } else if (token.type === 'img') {
      const imageHTML = `
        <figure class="img-block" data-src="${token.src}">
          <img alt="" decoding="async" loading="lazy" src="${token.src}">
          <button class="img-open" title="פתח באיכות מלאה">↔️</button>
        </figure>`;
      
      // תמונות תופסות בדרך כלל 4-5 שורות (לפי ה-CSS aspect-ratio)
      const imageLines = 4;
      addContent(imageHTML, imageLines);
      
    } else if (token.type === 'sep') {
      addContent('<hr class="separator">', 1);
      
    } else if (token.type === 'meta') {
      const metaHTML = `<div class="meta-pills"><span class="pill">${token.html}</span></div>`;
      addContent(metaHTML, 1);
    }
  }

  // סיים את הדף האחרון
  if (currentPageHTML.trim()) {
    finishPage();
  }

  measurer.remove();
  
  // ודא שיש לפחות דף אחד
  return pages.length > 0 ? pages : ['<p>No content found</p>'];
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

  // Lazy image: כבר יש לנו <img> עם src; אנחנו פשוט מסירים blur כשנטען
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
    const openBtn = block.querySelector('.img-open');
    if (openBtn) {
      openBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        window.open(full, '_blank');
      });
    }
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