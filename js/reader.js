// Reader v2 – יציב למובייל:
// * טוען books/<slug>/book.txt
// * מחליף {image-N} בתמונה אמיתית (נטענת מראש + width/height למניעת קפיצות)
// * כוכביות ****** -> <hr>
// * עימוד לפי 17 שורות לעמוד (תמונה/HR = דף משלהם)
// * חצים + החלקה, השבתת חצים בתחילת/סוף
// * שכבת "טוען את הספר…" עד שהכול מוכן

const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']; // jpg תחילה

// ------- עזר
function qs(name){
  const v = new URLSearchParams(location.search).get(name);
  return v ? decodeURIComponent(v) : null;
}
function showLoading(show){
  const el = document.getElementById('loading');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
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

// ------- תמונות – זיהוי והטענה מראש (כולל מימדים)
async function loadImage(url){
  const img = new Image();
  img.decoding = 'async';
  img.loading  = 'eager';
  return await new Promise(resolve=>{
    img.onload  = ()=>resolve({ ok:true, w:img.naturalWidth||800, h:img.naturalHeight||600 });
    img.onerror = ()=>resolve({ ok:false });
    img.src = url;
  });
}
async function probeImageBase(base){
  for (const ext of EXTENSIONS){
    const url = `${base}${ext}`;
    const res = await loadImage(url);
    if (res.ok) return { url, w:res.w, h:res.h };
  }
  return null;
}
async function hydrateImages(raw, imgDir){
  const jobs = [];
  const withPh = raw.replace(/\{image-(\d+)\}/g, (m,n)=>{
    const ph = `@@IMG_${n}@@`;
    jobs.push((async ()=>{
      const info = await probeImageBase(`${imgDir}/image-${n}`);
      const html = info
        ? `<img src="${info.url}" width="${info.w}" height="${info.h}" alt="image-${n}" decoding="async" loading="lazy" draggable="false">`
        : `<div class="pill">Missing image ${n}</div>`;
      return {ph, html};
    })());
    return ph;
  });
  const done = await Promise.all(jobs);
  let out = withPh;
  for (const {ph,html} of done) out = out.replaceAll(ph, html);
  return out;
}

// ------- המרות טקסט -> HTML
function escapeHTML(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function textToHTML(text){
  // שומרים תמונות כפי שהן; ממירים רק טקסט
  return text
    .split(/(<img[^>]*>)/gi)
    .map(part=>{
      if (!part) return '';
      if (/^<img/i.test(part)) return part;
      return part.split(/\r?\n/).map(line=>{
        if (/^\*{6,}\s*$/.test(line)) return '<hr class="separator">';
        if (/^\s*$/.test(line))       return '<br>';
        return escapeHTML(line);
      }).join('\n');
    })
    .join('');
}

// ------- DOM לעמודים
function clearTrack(){
  const track = document.getElementById('track');
  while(track.firstChild) track.removeChild(track.firstChild);
}
function buildPage(html){
  const p   = document.createElement('div'); p.className='page';
  const card= document.createElement('div'); card.className='page-card';
  const inn = document.createElement('div'); inn.className='page-inner';
  inn.innerHTML = html;
  card.appendChild(inn); p.appendChild(card);
  return {page:p, inner:inn};
}

// ------- עימוד לפי מספר שורות
function paginate(html){
  const track = document.getElementById('track');
  clearTrack();

  const meas = buildPage('');
  meas.page.style.visibility = 'hidden';
  track.appendChild(meas.page);

  const MAX_LINES = 17; // בקשתך – שורה אחת פחות
  const lh = parseFloat(getComputedStyle(meas.inner).lineHeight) || 28;

  // מפצלים ל"בלוקים" (תמונה/HR) וטקסט
  const tokens = [];
  html.split(/(<img[^>]+>|<hr class="separator">)/gi).forEach(part=>{
    if(!part) return;
    if(/^<img|^<hr/i.test(part)) tokens.push({t:'block', v:part});
    else                        tokens.push({t:'text',  v:part});
  });

  const pages = [];
  let cur = '';

  const linesOf = (candidate)=>{
    meas.inner.innerHTML = candidate || '';
    return Math.ceil(meas.inner.scrollHeight / lh);
  };
  const flush = ()=>{
    if (cur.trim()) pages.push(cur);
    cur = '';
  };

  for (const tk of tokens){
    if (tk.t === 'block'){
      if (cur.trim()) flush();
      pages.push(tk.v);       // תמונה / hr – עמוד נפרד
      cur = '';
      continue;
    }
    // טקסט – מילה־מילה עד שמגיעים לתקרה
    const parts = tk.v.split(/(\s+)/);
    for (const chunk of parts){
      const tryHtml = cur + chunk;
      if (linesOf(tryHtml) <= MAX_LINES){
        cur = tryHtml;
      } else {
        flush();
        cur = chunk.trimStart();
        if (cur && linesOf(cur) > MAX_LINES){
          // שמרני: חיתוך אלסטי אם מילה חריגה מאד
          let cut = cur;
          while (cut.length > 1 && linesOf(cut) > MAX_LINES){
            cut = cut.slice(0, Math.floor(cut.length*0.9));
          }
          if (cut.trim()) pages.push(cut);
          cur = cur.slice(cut.length);
        }
      }
    }
  }
  flush();

  // לבנות דפים אמיתיים
  clearTrack();
  for (const h of pages){
    const {page, inner} = buildPage(h);
    inner.style.overflow = 'hidden';
    track.appendChild(page);
  }
  return pages.length || 1;
}

// ------- החלקה
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

// ------- init
(async function init(){
  showLoading(true);

  const slug = qs('book');
  const track = document.getElementById('track');
  if(!slug){
    showLoading(false);
    track.innerHTML='<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=</div></div></div>';
    return;
  }

  const txtURL = `books/${slug}/book.txt`;
  const imgDir = `books/${slug}/images`;

  try{
    let raw = await fetchText(txtURL);
    if(!raw.trim()){
      showLoading(false);
      track.innerHTML='<div class="page"><div class="page-card"><div class="page-inner">Empty book.txt</div></div></div>';
      return;
    }

    // מציב תמונות (נטענות מראש + מימדים) לפני עימוד
    raw = await hydrateImages(raw, imgDir);

    // Place/Date בראש הטקסט (אם קיימים)
    let place=null, date=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

    let html = textToHTML(raw);
    const pills=[];
    if(date)  pills.push(`<span class="pill">Date: ${date}</span>`);
    if(place) pills.push(`<span class="pill">Place: ${place}</span>`);
    if(pills.length) html = `<div class="meta-pills">${pills.join(' ')}</div>` + html;

    // עימוד ובנייה
    let total = paginate(html);
    let index = 0;
    setCounter(index, total);

    const go = (i)=>{
      index = Math.max(0, Math.min(total-1, i));
      const pageW = document.getElementById('stage').clientWidth;
      const x = -index * pageW;
      const tr = document.getElementById('track');
      tr.style.transition = 'transform 260ms ease';
      tr.style.transform  = `translate3d(${x}px,0,0)`;
      setCounter(index, total);
    };

    document.getElementById('prev').onclick = ()=>go(index-1);
    document.getElementById('next').onclick = ()=>go(index+1);
    enableSwipe(()=>go(index-1), ()=>go(index+1));

    // ריסייז/רוטציה – מחשב עימוד מחדש (בלי לגעת בתמונות שכבר נטענו)
    addEventListener('resize', ()=>{
      const keep=index;
      total = paginate(html);
      go(Math.min(keep, total-1));
    });

    // התחל בעמוד הראשון וסגור את שכבת הטעינה
    go(0);
    showLoading(false);

  }catch(err){
    console.error(err);
    showLoading(false);
    track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Failed to load: ${txtURL}<br>${String(err)}</div></div></div>`;
  }
})();