// Reader – faster load, .jpg only, lazy images, incremental pagination,
// smooth swipe with velocity, arrows disabled at ends.
// Works with your existing reader.html (IDs: #stage #track #counter #prev #next)

(function () {
  const $  = (s, el=document) => el.querySelector(s);

  const stage   = $('#stage');
  const track   = $('#track');
  const counter = $('#counter');
  const prevBtn = $('#prev');
  const nextBtn = $('#next');

  const params  = new URLSearchParams(location.search);
  const slug    = params.get('book');
  if (!slug) {
    track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=…</div></div></div>`;
    disableNav(true);
    return;
  }
  const TXT_URL = `books/${slug}/book.txt`;
  const IMG_DIR = `books/${slug}/images/`;

  // ---------- Loader (injected, no HTML changes) ----------
  const loader = document.createElement('div');
  loader.setAttribute('role','status');
  loader.style.cssText = `
    position:fixed;inset:0;display:flex;flex-direction:column;gap:12px;
    align-items:center;justify-content:center;z-index:9999;
    background:radial-gradient(ellipse at top, rgba(255,255,255,.55), transparent 60%), var(--paper, #f7f1e3);
    font-family:"EB Garamond", Georgia, "Times New Roman", serif;color:#4b4035;
  `;
  loader.innerHTML = `
    <div style="width:50px;height:50px;border-radius:50%;
      border:4px solid #d6c7b2;border-top-color:#907052;animation:spin 1s linear infinite"></div>
    <div id="loaderMsg" style="font-size:18px;opacity:.9">Loading book…</div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(loader);
  const setLoader = (t)=>{ const m=$('#loaderMsg', loader); if(m) m.textContent=t; };
  const hideLoader= ()=>{ loader.style.display='none'; };

  // ---------- Helpers ----------
  function escapeHTML(s){ return s.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
  function setCounter(i, total){
    counter.textContent = `${i+1}/${Math.max(total,1)}`;
    prevBtn.disabled = (i<=0);
    nextBtn.disabled = (i>=total-1);
  }
  function disableNav(v){
    prevBtn.disabled = v; nextBtn.disabled = v;
  }
  function lineToHtml(line){
    if (/^\*{6,}\s*$/.test(line)) return '<hr class="separator">';
    if (/^\s*$/.test(line))       return '<br>';
    return escapeHTML(line);
  }
  function textToHTML(text){
    return text.split(/\r?\n/).map(lineToHtml).join('\n');
  }
  function buildPage(html){
    const p   = document.createElement('div'); p.className='page';
    const card= document.createElement('div'); card.className='page-card';
    const inn = document.createElement('div'); inn.className='page-inner';
    inn.innerHTML = html;
    card.appendChild(inn); p.appendChild(card);
    return { page:p, inner:inn };
  }
  function getPageWidth(){ return stage.clientWidth; }
  function getMaxInnerHeight(){
    // height available for .page-inner content
    const H = stage.clientHeight;
    // מרווחי המסך אצלך: padding page + שכבת ניווט — נאפשר מרווח קטן
    return Math.max(200, H - 36); // שמרני
  }

  // ---------- Images: {image-N} => <img loading="lazy" src=".../image-N.jpg">
  //   *אין* סבב סיומות. אם חסר קובץ – הדפדפן לא יעמיס זמן, פשוט לא יראה.
  function injectImagesJpg(raw){
    return raw.replace(/\{image-(\d+)\}/g, (_,n)=>{
      const src = `${IMG_DIR}image-${n}.jpg`;
      return `<img loading="lazy" decoding="async" src="${src}" alt="image-${n}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'pill',textContent:'Missing image-${n}'}))">`;
    });
  }

  // ---------- Pagination (incremental): shows first page fast, rest in idle ----------
  function paginateIncremental(fullHTML){
    // Measuring DOM (hidden)
    const meas = buildPage('');
    meas.page.style.visibility='hidden';
    track.appendChild(meas.page);

    const maxH = getMaxInnerHeight();

    // Tokenize (don’t split <img>/<hr>)
    const tokens = [];
    fullHTML.split(/(<img[^>]+>|<hr class="separator">)/g).forEach(part=>{
      if(!part) return;
      if(/^<img|^<hr/.test(part)) tokens.push({t:'html', v:part});
      else tokens.push({t:'txt', v:part});
    });

    const pagesHTML = [];
    let cur = '';

    const fits = (h)=>{ meas.inner.innerHTML = h; return meas.inner.scrollHeight <= maxH; };
    const flush = ()=>{ if(cur.trim()) pagesHTML.push(cur); cur=''; };

    for(const tk of tokens){
      if (tk.t==='html'){
        const tryH = cur + tk.v;
        if (fits(tryH)) cur = tryH;
        else {
          flush();
          if (fits(tk.v)) cur = tk.v;
          else { pagesHTML.push(tk.v); cur=''; } // very tall image => own page
        }
      } else {
        const parts = tk.v.split(/(\s+)/);
        for(const chunk of parts){
          const tryH = cur + chunk;
          if (fits(tryH)) cur = tryH;
          else {
            flush();
            // start next page with this chunk
            if (!fits(chunk)){ // pathological long token
              let cut = chunk;
              while(cut.length>1 && !fits(cut)) cut = cut.slice(0, Math.floor(cut.length*0.9));
              if (cut.trim()) pagesHTML.push(cut);
              cur = chunk.slice(cut.length);
            } else {
              cur = chunk.trimStart();
            }
          }
        }
      }
    }
    flush();

    // remove measurer
    meas.page.remove();

    // Render first page fast
    track.innerHTML = '';
    const first = buildPage(pagesHTML[0] || '<div class="pill">Empty.</div>');
    track.appendChild(first.page);

    // Render rest in idle
    const renderRest = ()=> {
      for(let i=1;i<pagesHTML.length;i++){
        const pg = buildPage(pagesHTML[i]);
        track.appendChild(pg.page);
      }
      setCounter(0, pagesHTML.length);
    };
    if ('requestIdleCallback' in window) requestIdleCallback(renderRest);
    else setTimeout(renderRest, 0);

    return pagesHTML.length || 1;
  }

  // ---------- Swipe (smooth drag + snap with velocity) ----------
  function enableSwipe(getIndex, setIndex, getTotal){
    let dragging=false, startX=0, lastX=0, lastT=0, velocity=0;
    function onDown(e){
      const x = (e.touches? e.touches[0].clientX : e.clientX);
      dragging = true; startX = lastX = x; lastT = e.timeStamp; velocity = 0;
      track.style.transition = 'none';
      document.body.style.userSelect = 'none';
    }
    function onMove(e){
      if(!dragging) return;
      const x = (e.touches? e.touches[0].clientX : e.clientX);
      const dx = x - startX;
      const now = e.timeStamp;
      const dt = Math.max(16, now - lastT);
      velocity = 0.8*velocity + 0.2*((x - lastX)/dt); // px/ms
      lastX = x; lastT = now;

      const w = getPageWidth();
      const base = -getIndex() * w;
      track.style.transform = `translate3d(${base + dx}px,0,0)`;
    }
    function onUp(){
      if(!dragging) return; dragging=false;
      const w = getPageWidth();
      const dx = lastX - startX;
      const speed = velocity * 1000; // px/s
      const TH = Math.min(140, w*0.18);

      let i = getIndex();
      if (dx < -TH || speed < -450) i++;
      else if (dx > TH || speed > 450) i--;
      i = Math.max(0, Math.min(getTotal()-1, i));
      setIndex(i, /*animate*/true);
      track.style.transition = '';
      document.body.style.userSelect = '';
    }
    stage.addEventListener('touchstart', onDown, {passive:true});
    stage.addEventListener('touchmove',  onMove, {passive:true});
    stage.addEventListener('touchend',   onUp,   {passive:true});
  }

  // ---------- Main ----------
  (async function init(){
    try{
      disableNav(true);
      setLoader('Loading book…');
      const res = await fetch(`${TXT_URL}?v=${Date.now()}`, {cache:'no-store'});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      let raw = await res.text();
      if(!raw.trim()){
        track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Empty book.txt</div></div></div>`;
        hideLoader(); return;
      }

      // Extract optional Place/Date (top)
      let place=null, date=null;
      raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
      raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

      // Replace images & separators
      let html = injectImagesJpg(raw.replace(/\r/g,'')).replace(/^\*{6,}\s*$/gm, '<hr class="separator">');
      html = textToHTML(html);

      // Pills at top
      if (place || date){
        const pills = [
          date  ? `<span class="pill">Date: ${escapeHTML(date)}</span>` : '',
          place ? `<span class="pill">Place: ${escapeHTML(place)}</span>` : ''
        ].filter(Boolean).join(' ');
        html = `<div class="meta-pills">${pills}</div>` + html;
      }

      // Paginate (incremental) – render first page fast
      const total = paginateIncremental(html);
      let index = 0;

      // First frame visible → hide loader
      requestAnimationFrame(()=>{
        hideLoader();
        disableNav(false);
        setCounter(index, total);
        // Snap to page 0
        const w = getPageWidth();
        track.style.transform = `translate3d(${-index*w}px,0,0)`;
      });

      // Buttons
      const go = (i, animate=true)=>{
        index = Math.max(0, Math.min(total-1, i));
        const w = getPageWidth();
        track.style.transition = animate ? 'transform 280ms cubic-bezier(.22,.61,.36,1)' : 'none';
        track.style.transform  = `translate3d(${-index*w}px,0,0)`;
        setCounter(index, total);
      };
      prevBtn.onclick = ()=> go(index-1);
      nextBtn.onclick = ()=> go(index+1);

      // Swipe
      enableSwipe(()=>index, go, ()=>total);

      // Reflow on resize/rotation – rebuild pages quickly
      addEventListener('resize', ()=>{
        const htmlSnapshot = [...track.querySelectorAll('.page-inner')]
          .map(n=>n.innerHTML).join('');
        const keep = index;
        const t = paginateIncremental(htmlSnapshot);
        go(Math.min(keep, t-1), /*animate*/false);
      });

    }catch(err){
      console.error(err);
      track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Failed to load: ${TXT_URL}<br>${String(err)}</div></div></div>`;
      hideLoader();
    }
  })();
})();