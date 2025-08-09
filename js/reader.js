// Reader — fixes: proper paragraph pagination (no 10k pages), in-stage notebook loader,
// smooth swipe + snap, .jpg-only lazy images. Works with your reader.html.

(function(){
  const $ = (s, el=document)=>el.querySelector(s);

  const stage   = $('#stage');
  const track   = $('#track');
  const counter = $('#counter');
  const prevBtn = $('#prev');
  const nextBtn = $('#next');

  const params  = new URLSearchParams(location.search);
  const slug    = params.get('book');
  if(!slug){
    track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=…</div></div></div>`;
    prevBtn.disabled = nextBtn.disabled = true;
    return;
  }
  const TXT_URL = `books/${slug}/book.txt`;
  const IMG_DIR = `books/${slug}/images/`;

  // ===== Loader (inside stage so the back button stays clickable) =====
  const loader = document.createElement('div');
  loader.className = 'reader-loader';
  loader.style.cssText = `
    position:absolute; inset:0; display:flex; flex-direction:column; gap:12px;
    align-items:center; justify-content:center; z-index:5;
    background:
      radial-gradient(ellipse at top, rgba(255,255,255,.55), transparent 60%),
      repeating-linear-gradient(0deg, rgba(0,0,0,.015), rgba(0,0,0,.015) 2px, transparent 2px, transparent 36px),
      var(--paper, #f7f1e3);
    border-radius:18px;
  `;
  loader.innerHTML = `
    <div style="width:50px;height:50px;border-radius:50%;
      border:4px solid #d6c7b2;border-top-color:#907052;animation:spin 1s linear infinite"></div>
    <div style="font-family:'EB Garamond',serif;font-size:18px;color:#4b4035;opacity:.9">Loading book…</div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  stage.style.position = stage.style.position || 'relative';
  stage.appendChild(loader);
  const hideLoader = ()=>{ loader.remove(); };

  // ===== Small helpers =====
  function setCounter(i, total){
    counter.textContent = `${i+1}/${Math.max(total,1)}`;
    prevBtn.disabled = (i<=0);
    nextBtn.disabled = (i>=total-1);
  }
  const esc = s => s.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

  // Convert raw text → HTML blocks (keep <hr> and later <img>)
  function toHTML(text){
    // lines: ****** → hr, blank → <br>, else text
    return text.split(/\r?\n/).map(l=>{
      if (/^\*{6,}\s*$/.test(l)) return '<hr class="separator">';
      if (/^\s*$/.test(l))       return '<br>';
      return esc(l);
    }).join('\n');
  }

  // Replace {image-N} → <img> (jpg only), lazy load
  function injectImagesJpg(raw){
    return raw.replace(/\{image-(\d+)\}/g, (_,n)=>{
      const src = `${IMG_DIR}image-${n}.jpg`;
      // onerror → תווית קטנה, לא תוקע טעינה
      return `<img loading="lazy" decoding="async" src="${src}" alt="image-${n}"
                onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'pill',textContent:'Missing image-${n}'}))">`;
    });
  }

  // ===== Pagination by HEIGHT using paragraph blocks (not single words) =====
  function getMaxInnerHeight(){
    // available height inside the page (stage already excludes header/footer by your CSS)
    return Math.max(200, stage.clientHeight - 20);
  }

  // Split HTML into coarse blocks: paragraphs / <hr> / <img> / double breaks
  function blockify(html){
    // protect <img> and <hr> as separate blocks, then split by empty lines
    const parts = html.split(/(<img[^>]*?>|<hr class="separator">)/g).filter(Boolean);
    const blocks = [];
    for (const part of parts){
      if (part.startsWith('<img') || part.startsWith('<hr')) { blocks.push(part); continue; }
      // further split long chunks on double breaks to get paragraphs
      part.split(/\n{2,}/).forEach(p=>{
        const s = p.trim();
        if (s) blocks.push(s);
      });
    }
    return blocks;
  }

  function paginateByBlocks(blocks){
    // hidden measurer that matches real layout
    const measPage = document.createElement('div');
    measPage.className = 'page';
    const card = document.createElement('div');
    card.className = 'page-card';
    const inner = document.createElement('div');
    inner.className = 'page-inner';
    card.appendChild(inner); measPage.appendChild(card);
    measPage.style.visibility = 'hidden';
    track.appendChild(measPage);

    const maxH = getMaxInnerHeight();

    const pages = [];
    let cur = '';

    const fits = (html)=>{
      inner.innerHTML = html;
      return inner.scrollHeight <= maxH;
    };
    const flush = ()=>{
      if (cur && cur.trim()) pages.push(cur);
      cur = '';
    };

    for (const block of blocks){
      const b = block.startsWith('<img') || block.startsWith('<hr') ? block : `<p>${block}</p>`;
      if (fits(cur + b)){
        cur += b;
      } else {
        if (!cur) {
          // single huge block (e.g., very tall image) → own page
          pages.push(b);
        } else {
          flush();
          // place in new page; if still too big, accept overflow (rare)
          cur = b;
        }
      }
    }
    flush();

    // build DOM (first clear)
    track.innerHTML = '';
    for (const html of pages){
      const p   = document.createElement('div'); p.className='page';
      const c   = document.createElement('div'); c.className='page-card';
      const inn = document.createElement('div'); inn.className='page-inner';
      inn.innerHTML = html;
      c.appendChild(inn); p.appendChild(c);
      track.appendChild(p);
    }
    return pages.length || 1;
  }

  // ===== Swipe with velocity + snap =====
  function enableSwipe(getIndex, setIndex, getTotal){
    let dragging=false, startX=0, lastX=0, lastT=0, velocity=0;
    function onDown(e){
      const x = (e.touches? e.touches[0].clientX : e.clientX);
      dragging=true; startX=lastX=x; lastT=e.timeStamp; velocity=0;
      track.style.transition='none';
      document.body.style.userSelect='none';
    }
    function onMove(e){
      if(!dragging) return;
      const x = (e.touches? e.touches[0].clientX : e.clientX);
      const now = e.timeStamp;
      const dt = Math.max(16, now - lastT);
      velocity = 0.8*velocity + 0.2*((x - lastX)/dt); // px/ms
      lastX = x; lastT = now;

      const w = stage.clientWidth;
      const base = -getIndex()*w;
      const dx = x - startX;
      track.style.transform = `translate3d(${base + dx}px,0,0)`;
    }
    function onUp(){
      if(!dragging) return; dragging=false;
      const w = stage.clientWidth;
      const dx = lastX - startX;
      const speed = velocity * 1000; // px/s
      const TH = Math.min(140, w*0.18);
      let i = getIndex();
      if (dx < -TH || speed < -450) i++;
      else if (dx > TH || speed > 450) i--;
      i = Math.max(0, Math.min(getTotal()-1, i));
      setIndex(i, true);
      track.style.transition='';
      document.body.style.userSelect='';
    }
    stage.addEventListener('touchstart', onDown, {passive:true});
    stage.addEventListener('touchmove',  onMove, {passive:true});
    stage.addEventListener('touchend',   onUp,   {passive:true});
  }

  // ===== Main =====
  (async function init(){
    try{
      prevBtn.disabled = nextBtn.disabled = true;

      // load text
      const res = await fetch(`${TXT_URL}?v=${Date.now()}`, {cache:'no-store'});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      let raw = await res.text();
      if(!raw.trim()){
        track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Empty book.txt</div></div></div>`;
        hideLoader(); return;
      }
      raw = raw.replace(/\r/g,''); // normalize

      // Optional Place/Date (top)
      let place=null, date=null;
      raw = raw.replace(/^(Place:\s*)(.+)\s*\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
      raw = raw.replace(/^(Date:\s*)(.+)\s*\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

      // images + separators + HTML conversion
      let html = injectImagesJpg(raw).replace(/^\*{6,}\s*$/gm, '<hr class="separator">');
      html = toHTML(html);

      // Pills block
      if (place || date){
        const pills = [
          date  ? `<span class="pill">Date: ${esc(date)}</span>` : '',
          place ? `<span class="pill">Place: ${esc(place)}</span>` : ''
        ].filter(Boolean).join(' ');
        html = `<div class="meta">${pills}</div>\n` + html;
      }

      // Paginate using paragraph blocks (builds the first page as part of flow)
      const blocks = blockify(html);
      const total  = paginateByBlocks(blocks);
      let index = 0;

      // show first frame & enable nav
      requestAnimationFrame(()=>{
        hideLoader();
        setCounter(index, total);
        const w = stage.clientWidth;
        track.style.transform = `translate3d(${-index*w}px,0,0)`;
      });

      const go = (i, animate=true)=>{
        index = Math.max(0, Math.min(total-1, i));
        const w = stage.clientWidth;
        track.style.transition = animate ? 'transform 280ms cubic-bezier(.22,.61,.36,1)' : 'none';
        track.style.transform  = `translate3d(${-index*w}px,0,0)`;
        setCounter(index, total);
      };
      prevBtn.onclick = ()=>go(index-1);
      nextBtn.onclick = ()=>go(index+1);

      enableSwipe(()=>index, go, ()=>total);
      prevBtn.disabled = (index===0);
      nextBtn.disabled = (index===total-1);

      // Re-paginate on resize/rotation
      addEventListener('resize', ()=>{
        const all = [...track.querySelectorAll('.page-inner')].map(n=>n.innerHTML).join('');
        const keep = index;
        const t = paginateByBlocks(blockify(all));
        go(Math.min(keep, t-1), false);
      });

    }catch(err){
      console.error(err);
      track.innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Failed to load: ${TXT_URL}<br>${String(err)}</div></div></div>`;
      hideLoader();
    }
  })();
})();