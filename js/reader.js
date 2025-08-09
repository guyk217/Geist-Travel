// Robust mobile reader: loads books/<slug>/book.txt, replaces {image-N},
// draws <hr> for ******, paginates by the real stage height (no “empty” pages),
// arrows + swipe, disables buttons at ends.

const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

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
  const jobs = [];
  const withPh = raw.replace(/\{image-(\d+)\}/g, (m,n)=>{
    const ph = `@@IMG_${n}@@`;
    jobs.push((async ()=>{
      const src = await probeImage(`${imgDir}/image-${n}`);
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

function getStageHeight(){
  // גובה שימושי לעימוד – בפועל של ה"עמוד" עצמו
  const stage = document.getElementById('stage');
  const style = getComputedStyle(stage);
  const h = stage.clientHeight
          - parseFloat(style.paddingTop||0)
          - parseFloat(style.paddingBottom||0);
  // שוליים פנימיים בכרטיס
  return Math.max(200, h - 20); // שמרני
}

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

function paginate(html){
  const track = document.getElementById('track');
  clearTrack();

  // דף מדידה – חייב להיות עם אותו CSS בדיוק
  const meas = buildPage('');
  meas.page.style.visibility = 'hidden';
  track.appendChild(meas.page);

  const maxH = getStageHeight();

  // מפרקים לטוקנים (לא חותכים <img> / <hr>)
  const tokens = [];
  html.split(/(<img[^>]+>|<hr class="separator">)/g).forEach(part=>{
    if(!part) return;
    if(/^<img|^<hr/.test(part)) tokens.push({t:'html', v:part});
    else tokens.push({t:'txt', v:part});
  });

  const pages = [];
  let cur = '';

  const fits = (candidate)=>{
    meas.inner.innerHTML = candidate;
    // מדידה אמיתית לפי scrollHeight מול maxH
    return meas.inner.scrollHeight <= maxH;
  };
  const flush = ()=>{
    if(cur.trim()) pages.push(cur);
    cur = '';
  };

  for(const tk of tokens){
    if(tk.t==='html'){
      const tryH = cur + tk.v;
      if(fits(tryH)) cur = tryH;
      else{
        flush();
        if(fits(tk.v)) cur = tk.v;
        else{ // בלוק ענק (תמונה גבוהה) – עמוד בפני עצמו
          pages.push(tk.v);
          cur = '';
        }
      }
    }else{
      // טקסט – נוסיף חלקים קטנים עד שמפסיק להתאים
      const parts = tk.v.split(/(\s+)/);
      for(const chunk of parts){
        const tryH = cur + chunk;
        if(fits(tryH)) cur = tryH;
        else{
          flush();
          // אם גם לבד לא מתאים (טוקן חריג), נחתוך קשיח
          if(!fits(chunk)){
            let cut = chunk;
            while(cut.length>1 && !fits(cut)) cut = cut.slice(0, Math.floor(cut.length*0.9));
            if(cut.trim()) pages.push(cut);
            cur = chunk.slice(cut.length);
          }else{
            cur = chunk.trimStart();
          }
        }
      }
    }
  }
  flush();

  // בונים את הדום
  clearTrack();
  for(const h of pages){
    const {page, inner} = buildPage(h);
    // אחרי עימוד – אין צורך בגלילה פנימית
    inner.style.overflow='hidden';
    track.appendChild(page);
  }
  return pages.length || 1;
}

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

(async function init(){
  const slug = qs('book');
  const track = document.getElementById('track');
  if(!slug){ track.innerHTML='<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=</div></div></div>'; return; }

  const txtURL = `books/${slug}/book.txt`;
  const imgDir = `books/${slug}/images`;

  try{
    let raw = await fetchText(txtURL);
    if(!raw.trim()){
      track.innerHTML='<div class="page"><div class="page-card"><div class="page-inner">Empty book.txt</div></div></div>';
      return;
    }
    raw = await hydrateImages(raw, imgDir);

    // Place / Date מההתחלה (לא חובה)
    let place=null, date=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

    let html = textToHTML(raw);
    const pills=[];
    if(date)  pills.push(`<span class="pill">Date: ${date}</span>`);
    if(place) pills.push(`<span class="pill">Place: ${place}</span>`);
    if(pills.length) html = `<div class="meta-pills">${pills.join(' ')}</div>` + html;

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

    // ריסייז/רוטציה – מחשב עימוד מחדש
    addEventListener('resize', ()=>{
      const keep=index;
      total = paginate(html);
      go(Math.min(keep, total-1));
    });

  }catch(err){
    console.error(err);
    track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Failed to load: ${txtURL}<br>${String(err)}</div></div></div>`;
  }
})();