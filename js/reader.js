// Reader v2.1 – עימוד יציב לפי גובה, מוגבל ל~17 שורות,
// בלי התפוצצות עמודים, תמונות נטענות מראש, ****** -> <hr>.

const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']; // jpg קודם

function qs(name){ const v=new URLSearchParams(location.search).get(name); return v?decodeURIComponent(v):null; }
function showLoading(show){ const el=document.getElementById('loading'); if(el) el.style.display = show?'flex':'none'; }
function setCounter(i,total){ const c=document.getElementById('counter'); c.textContent=`${i+1}/${Math.max(total,1)}`; prev.disabled=(i<=0); next.disabled=(i>=total-1); }
async function fetchText(url){ const r=await fetch(url+`?v=${Date.now()}`,{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }

// ---- images
async function loadImage(url){
  const img=new Image(); img.decoding='async'; img.loading='eager';
  return await new Promise(res=>{ img.onload=()=>res({ok:true,w:img.naturalWidth||800,h:img.naturalHeight||600}); img.onerror=()=>res({ok:false}); img.src=url; });
}
async function probeImageBase(base){
  for(const ext of EXTENSIONS){ const url=`${base}${ext}`; const r=await loadImage(url); if(r.ok) return {url,w:r.w,h:r.h}; }
  return null;
}
async function hydrateImages(raw, dir){
  const jobs=[]; 
  const ph=raw.replace(/\{image-(\d+)\}/g,(m,n)=>{
    const token=`@@IMG_${n}@@`;
    jobs.push((async ()=>{
      const info=await probeImageBase(`${dir}/image-${n}`);
      const html = info
        ? `<img src="${info.url}" width="${info.w}" height="${info.h}" alt="image-${n}" decoding="async" loading="lazy" draggable="false">`
        : `<div class="pill">Missing image ${n}</div>`;
      return {token, html};
    })());
    return token;
  });
  const done=await Promise.all(jobs);
  let out=ph; for(const {token,html} of done) out=out.replaceAll(token,html);
  return out;
}

// ---- text -> HTML
function escapeHTML(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function textToHTML(text){
  return text.split(/(<img[^>]*>)/gi).map(part=>{
    if(!part) return '';
    if(/^<img/i.test(part)) return part;
    return part.split(/\r?\n/).map(line=>{
      if(/^\*{6,}\s*$/.test(line)) return '<hr class="separator">';
      if(/^\s*$/.test(line)) return '<br>';
      return escapeHTML(line);
    }).join('\n');
  }).join('');
}

// ---- DOM helpers
function clearTrack(){ const t=document.getElementById('track'); while(t.firstChild) t.removeChild(t.firstChild); }
function buildPage(html){
  const p=document.createElement('div'); p.className='page';
  const card=document.createElement('div'); card.className='page-card';
  const inn=document.createElement('div'); inn.className='page-inner';
  inn.innerHTML=html; card.appendChild(inn); p.appendChild(card); 
  return {page:p, inner:inn};
}

// ---- pagination (HEIGHT-BASED with line cap)
function getStageHeight(){
  const stage=document.getElementById('stage');
  const cs=getComputedStyle(stage);
  return Math.max(200, stage.clientHeight - parseFloat(cs.paddingTop||0) - parseFloat(cs.paddingBottom||0) - 20);
}

function paginate(html){
  const track=document.getElementById('track');
  clearTrack();

  // measurer
  const meas=buildPage('');
  meas.page.style.visibility='hidden';
  meas.page.style.position='absolute';
  meas.page.style.inset='0';
  track.appendChild(meas.page);

  const MAX_LINES=17;
  const lineH = parseFloat(getComputedStyle(meas.inner).lineHeight) || 28;
  const maxH  = getStageHeight();
  const LIMIT_H = Math.min(maxH, Math.round(lineH*MAX_LINES));  // זה הקסם: גובה “17 שורות”, אך לא מעבר לגובה הדף

  const tokens=[];
  html.split(/(<img[^>]+>|<hr class="separator">)/gi).forEach(part=>{
    if(!part) return;
    if(/^<img|^<hr/i.test(part)) tokens.push({t:'block',v:part});
    else tokens.push({t:'text',v:part});
  });

  const pages=[];
  let cur='';

  const fits = (candidate)=>{
    meas.inner.innerHTML=candidate||'';
    return meas.inner.scrollHeight <= LIMIT_H + 1; // מרווח קטנטן
  };
  const flush=()=>{ if(cur.trim()) pages.push(cur); cur=''; };

  for(const tk of tokens){
    if(tk.t==='block'){ 
      if(cur.trim()) flush();
      // תמונה/HR – דף בפני עצמו
      pages.push(tk.v);
      continue;
    }
    // טקסט – מילה מילה
    const parts=tk.v.split(/(\s+)/);
    for(const chunk of parts){
      const tryHtml = cur + chunk;
      if(fits(tryHtml)){ cur=tryHtml; }
      else{
        flush();
        // התחל דף חדש עם המילה הנוכחית
        cur = chunk.trimStart();
        if(cur && !fits(cur)){
          // חיתוך אלסטי במקרה חריג מאוד
          let cut=cur;
          while(cut.length>1 && !fits(cut)) cut=cut.slice(0, Math.floor(cut.length*0.9));
          if(cut.trim()) pages.push(cut);
          cur = cur.slice(cut.length);
        }
      }
    }
  }
  flush();

  clearTrack();
  for(const htmlChunk of pages){
    const {page,inner}=buildPage(htmlChunk);
    inner.style.overflow='hidden';
    track.appendChild(page);
  }
  return pages.length || 1;
}

// ---- swipe
function enableSwipe(onLeft,onRight){
  const el=document.getElementById('stage'); let x0=null,y0=null,t0=0;
  const minDx=40,maxDy=60,maxT=600;
  el.addEventListener('touchstart',e=>{const t=e.touches[0]; x0=t.clientX; y0=t.clientY; t0=Date.now();},{passive:true});
  el.addEventListener('touchend',e=>{
    if(x0==null) return;
    const t=e.changedTouches[0], dx=t.clientX-x0, dy=Math.abs(t.clientY-y0), dt=Date.now()-t0; x0=null;
    if(dy<maxDy && dt<maxT && Math.abs(dx)>minDx){ if(dx<0) onRight(); else onLeft(); }
  },{passive:true});
}

// ---- init
(async function init(){
  showLoading(true);
  const slug=qs('book'); const track=document.getElementById('track');
  if(!slug){ showLoading(false); track.innerHTML='<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=</div></div></div>'; return; }

  const txtURL=`books/${slug}/book.txt`;
  const imgDir=`books/${slug}/images`;

  try{
    let raw = await fetchText(txtURL);
    if(!raw.trim()){ showLoading(false); track.innerHTML='<div class="page"><div class="page-card"><div class="page-inner">Empty book.txt</div></div></div>'; return; }

    raw = await hydrateImages(raw, imgDir);

    // Place/Date בראש (לא חובה)
    let place=null,date=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i,(_,p,v)=>{place=v.trim();return'';});
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{date =v.trim();return'';});

    let html = textToHTML(raw);
    const pills=[];
    if(date)  pills.push(`<span class="pill">Date: ${date}</span>`);
    if(place) pills.push(`<span class="pill">Place: ${place}</span>`);
    if(pills.length) html = `<div class="meta-pills">${pills.join(' ')}</div>` + html;

    let total = paginate(html);
    let index = 0;
    const go = (i)=>{
      index = Math.max(0, Math.min(total-1, i));
      const pageW=document.getElementById('stage').clientWidth;
      document.getElementById('track').style.transition='transform 260ms ease';
      document.getElementById('track').style.transform=`translate3d(${-index*pageW}px,0,0)`;
      setCounter(index,total);
    };

    prev.onclick = ()=>go(index-1);
    next.onclick = ()=>go(index+1);
    enableSwipe(()=>go(index-1), ()=>go(index+1));

    addEventListener('resize', ()=>{
      const keep=index;
      total = paginate(html);
      go(Math.min(keep, total-1));
    });

    go(0);
    showLoading(false);
  }catch(err){
    console.error(err);
    showLoading(false);
    track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Failed to load: ${txtURL}<br>${String(err)}</div></div></div>`;
  }
})();