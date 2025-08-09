// Reader – עימוד לפי מספר שורות קבוע + טעינה עם רקע מחברת
// book.txt נטען מתוך books/<slug>/book.txt, תמונות ב books/<slug>/(images|image)/image-N.(jpg|jpeg|png|webp)

const EXTENSIONS = ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.webp'];

// ---- פרמטרי עימוד (מעודכן: פחות שורות בעמוד) ----
const LINES_PER_PAGE   = 16;   // ↓ היה 22
const CHARS_PER_LINE   = 56;
const IMG_LINE_WEIGHT  = 18;
const HR_LINE_WEIGHT   = 2;

function qs(name){
  const v = new URLSearchParams(location.search).get(name);
  return v ? decodeURIComponent(v) : null;
}
function setCounter(i, total){
  const c = document.getElementById('counter');
  c.textContent = `${i+1}/${Math.max(total,1)}`;
  document.getElementById('prev').disabled = (i<=0);
  document.getElementById('next').disabled = (i>=total-1);
}
async function fetchText(url){
  const r = await fetch(url + `?v=${Date.now()}`, {cache:'no-store'});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}
async function probeImage(base){
  // מנסה את כל הסיומות (כולל .jpg באותיות קטנות/גדולות)
  for(const ext of EXTENSIONS){
    const url = `${base}${ext}`;
    const ok = await new Promise(res=>{
      const im = new Image();
      im.onload = ()=>res(true); im.onerror = ()=>res(false);
      im.src = url;
    });
    if(ok) return url;
  }
  return null;
}
async function hydrateImages(raw, imgDir){
  // תמיכה גם בתיקייה images/ וגם image/
  const altDir = imgDir.endsWith('/images') ? imgDir.replace(/\/images$/, '/image') : imgDir;

  const jobs = [];
  const withPh = raw.replace(/\{image-(\d+)\}/g, (m,n)=>{
    const ph = `@@IMG_${n}@@`;
    jobs.push((async ()=>{
      // ננסה קודם images/, ואז image/
      const src =
        (await probeImage(`${imgDir}/image-${n}`)) ||
        (await probeImage(`${altDir}/image-${n}`));

      const html = src ? `<img src="${src}" alt="image-${n}">`
                       : `<div class="pill">Missing image ${n}</div>`;
      return {ph, html};
    })());
    return ph;
  });
  const done = await Promise.all(jobs);
  let out = withPh;
  for(const {ph,html} of done) out = out.replaceAll(ph, html);
  return out;
}
function escapeHTML(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function textToHTML(text){
  return text.split(/\r?\n/).map(l=>{
    if(/^\*{6,}\s*$/.test(l)) return '<hr class="separator">';
    if(/^\s*$/.test(l)) return '<br>';
    return escapeHTML(l);
  }).join('\n');
}

// ---- עימוד לפי “שורות” ----
function tokenize(html){
  const tokens = [];
  html.split(/(<img[^>]+>|<hr class="separator">)/g).forEach(part=>{
    if(!part) return;
    if(/^<img/i.test(part)) tokens.push({kind:'img', html:part, w:IMG_LINE_WEIGHT});
    else if(/^<hr/i.test(part)) tokens.push({kind:'hr', html:part, w:HR_LINE_WEIGHT});
    else tokens.push({kind:'txt', html:part});
  });
  return tokens;
}
function weightOfText(txt){
  const clean = txt.replace(/<[^>]+>/g,'');
  const chars = clean.length;
  return Math.ceil(chars / CHARS_PER_LINE);
}
function paginateByLines(html){
  const tokens = tokenize(html);
  const pages = [];
  let curLines = 0;
  let curHTML  = '';

  const pushPage = ()=>{
    pages.push(curHTML || '&nbsp;');
    curHTML = '';
    curLines = 0;
  };

  for(const tk of tokens){
    if(tk.kind === 'txt'){
      if(!tk.html.trim()){ curHTML += tk.html; continue; }
      let remaining = tk.html;
      while(remaining){
        const room = LINES_PER_PAGE - curLines;
        if(room <= 0){ pushPage(); continue; }

        const charsRoom = room * CHARS_PER_LINE;
        if(remaining.length <= charsRoom){
          curHTML += remaining;
          curLines += weightOfText(remaining);
          remaining = '';
        }else{
          let cut = remaining.slice(0, charsRoom);
          const lastSpace = cut.lastIndexOf(' ');
          if(lastSpace > charsRoom * 0.6) cut = cut.slice(0, lastSpace);
          curHTML += cut;
          curLines += weightOfText(cut);
          remaining = remaining.slice(cut.length);
          if(curLines >= LINES_PER_PAGE) pushPage();
        }
      }
    }else{
      const w = tk.w;
      if(w > LINES_PER_PAGE){
        if(curLines>0) pushPage();
        curHTML += tk.html;
        pushPage();
        continue;
      }
      if(curLines + w > LINES_PER_PAGE) pushPage();
      curHTML += tk.html;
      curLines += w;
    }
  }
  if(curHTML.trim() || !pages.length) pushPage();
  return pages;
}

// ---- הצגה / ניווט ----
function buildPage(html){
  const p   = document.createElement('div'); p.className='page';
  const card= document.createElement('div'); card.className='page-card';
  const inn = document.createElement('div'); inn.className='page-inner';
  inn.innerHTML = html;
  card.appendChild(inn); p.appendChild(card);
  return p;
}
function clear(el){ while(el.firstChild) el.removeChild(el.firstChild); }
function enableSwipe(onLeft, onRight){
  const el = document.getElementById('stage');
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

// ---- Loader ----
function showLoader(msg='טוען את הספר…'){
  let el = document.getElementById('loader');
  if(!el){
    el = document.createElement('div');
    el.id = 'loader';
    el.innerHTML = `
      <div class="loader-card">
        <div class="spinner"></div>
        <div class="loader-text">${msg}</div>
      </div>`;
    document.body.appendChild(el);
  }else{
    el.querySelector('.loader-text').textContent = msg;
  }
  el.style.display='grid';
}
function hideLoader(){
  const el = document.getElementById('loader');
  if(el) el.style.display='none';
}

// ---- main ----
(async function init(){
  try{
    const slug = qs('book');
    const track = document.getElementById('track');
    if(!slug){ track.innerHTML='<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=</div></div></div>'; return; }

    showLoader('טוען טקסט…');
    const txtURL = `books/${slug}/book.txt`;
    const imgDir = `books/${slug}/images`;
    let raw = await fetchText(txtURL);

    showLoader('מטפל בתמונות…');
    raw = await hydrateImages(raw, imgDir);

    // Place / Date (רשות)
    let place=null, date=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

    let html = textToHTML(raw);
    const pills=[];
    if(date)  pills.push(`<span class="pill">Date: ${date}</span>`);
    if(place) pills.push(`<span class="pill">Place: ${place}</span>`);
    if(pills.length) html = `<div class="meta-pills">${pills.join(' ')}</div>` + html;

    showLoader('מעצב עמודים…');
    const pagesHTML = paginateByLines(html);

    hideLoader();
    clear(track);
    for(const h of pagesHTML) track.appendChild(buildPage(h));

    let index = 0;
    const total = pagesHTML.length;
    const go = (i)=>{
      index = Math.max(0, Math.min(total-1, i));
      const pageW = document.getElementById('stage').clientWidth;
      track.style.transition = 'transform 260ms ease';
      track.style.transform  = `translate3d(${-index*pageW}px,0,0)`;
      setCounter(index, total);
    };
    setCounter(index, total);
    document.getElementById('prev').onclick = ()=>go(index-1);
    document.getElementById('next').onclick = ()=>go(index+1);
    enableSwipe(()=>go(index-1), ()=>go(index+1));
    addEventListener('resize', ()=>go(index));

  }catch(err){
    hideLoader();
    const track = document.getElementById('track');
    console.error(err);
    track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">שגיאה בטעינת הספר<br>${String(err)}</div></div></div>`;
  }
})();