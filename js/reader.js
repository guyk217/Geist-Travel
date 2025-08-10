// Reader (Columns) — עימוד לפי גובה מסך עם CSS Columns
// * טוען books/<slug>/book.txt
// * {image-N} -> <img> (ברירת מחדל .jpeg, fallback .jpg; ל-cover בד"כ .jpg)
// * ****** -> <hr class="separator">
// * גלילה/החלקה/כפתורים בין עמודים, מונה, GoTo + פרמטר &page=
// * התאמה דינמית לגודל מסך, ספירת עמודים מדויקת גם אחרי טעינת תמונות

(function(){
  const $ = s => document.querySelector(s);
  const qs = k => {
    const v = new URLSearchParams(location.search).get(k);
    return v ? decodeURIComponent(v) : null;
  };

  const setLoading = on => {
    const el = document.getElementById('loadingOverlay');
    if (el) el.style.display = on ? 'grid' : 'none';
  };

  function setCounter(page, total){
    const c = $('#counter');
    if (c) c.textContent = `${page+1}/${Math.max(total,1)}`;
    const prev = $('#prev'), next = $('#next');
    if (prev) prev.disabled = (page<=0);
    if (next) next.disabled = (page>=total-1);
  }

  async function fetchText(url){
    const r = await fetch(url + `?v=${Date.now()}`, {cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }

  // --- המרת טקסט ל-HTML: פסקאות, תמונות, מפרידים ---
  function normalizeLines(raw){ return raw.replace(/\r\n/g, '\n'); }

  function toBlocks(raw, imgBase){
    // בלוקים: paragraph / hr / image
    const out = [];
    const lines = normalizeLines(raw).split('\n');

    const pushPara = buf=>{
      const text = buf.join(' ').trim();
      if(text) out.push({t:'p', html: escapeHTML(text)});
    };

    let buf = [];
    for(const ln of lines){
      if (/^\*{6,}\s*$/.test(ln)){
        if (buf.length) { pushPara(buf); buf=[]; }
        out.push({t:'hr'});
      } else if (/^\s*$/.test(ln)){
        if (buf.length) { pushPara(buf); buf=[]; }
      } else if (/^\{image-(\d+)\}\s*$/.test(ln.trim())){
        if (buf.length) { pushPara(buf); buf=[]; }
        const n = parseInt(RegExp.$1, 10);
        out.push({t:'img', n, base: imgBase});
      } else {
        buf.push(ln.trim());
      }
    }
    if (buf.length) pushPara(buf);
    return out;
  }

  function escapeHTML(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function imgTag(base, n){
    // רוב התמונות .jpeg; ל-cover לעתים .jpg — נוסיף fallback
    const prefer = (n===1) ? 'jpg' : 'jpeg';
    const alt    = (prefer==='jpg') ? 'jpeg' : 'jpg';
    const p0 = `${base}/image-${n}.${prefer}`;
    const p1 = `${base}/image-${n}.${alt}`;
    // width/height רצוי אם ידועים – לשמירת יחס ולמניעת קפיצות
    return `<figure class="page-column" style="margin:0;display:block;">
      <img src="${p0}" loading="lazy" decoding="async"
           onerror="this.onerror=null;this.src='${p1}';"
           alt="image-${n}">
    </figure>`;
  }

  function blocksToHTML(blocks){
    // עוטפים כל בלוק ב-.page-column כדי לאפשר snap ו-avoid split
    let html = '';
    for(const b of blocks){
      if (b.t==='p'){
        html += `<p class="page-column">${b.html}</p>`;
      } else if (b.t==='hr'){
        html += `<div class="page-column"><hr class="separator"></div>`;
      } else if (b.t==='img'){
        html += imgTag(b.base, b.n);
      }
    }
    return html;
  }

  // --- Columns pagination helpers ---
  function setPageWidthCSS(px){
    const el = document.getElementById('columns');
    if (el) el.style.columnWidth = px + 'px';
  }

  function getPageMetrics(){
    const el = document.getElementById('columns');
    if (!el) return {pageW:1, pages:1};
    const pageW = el.clientWidth || 1;    // רוחב עמוד אחד
    const totalW = el.scrollWidth || pageW;
    const pages = Math.max(1, Math.ceil(totalW / pageW));
    return {pageW, pages};
  }

  function scrollToPage(index){
    const el = document.getElementById('columns');
    const {pageW, pages} = getPageMetrics();
    const clamped = Math.max(0, Math.min(index, pages-1));
    el.scrollTo({ left: clamped * pageW, top: 0, behavior: 'smooth' });
    setCounter(clamped, pages);
    return clamped;
  }

  function currentPageIndex(){
    const el = document.getElementById('columns');
    const {pageW} = getPageMetrics();
    return Math.round((el.scrollLeft || 0) / Math.max(1,pageW));
  }

  // --- Throttle/Resize helpers ---
  function throttle(fn, ms){
    let t=0, timer=null, lastArgs=null;
    return (...args)=>{
      const now=Date.now(); lastArgs=args;
      if (now - t > ms){ t=now; fn(...lastArgs); }
      else{
        clearTimeout(timer);
        timer = setTimeout(()=>{ t=Date.now(); fn(...lastArgs); }, ms);
      }
    };
  }

  function askGoto(){
    const {pages} = getPageMetrics();
    const cur = currentPageIndex();
    const v = prompt(`לאיזה עמוד לקפוץ? (1–${pages})`, String(cur+1));
    if(!v) return;
    const n = Math.max(1, Math.min(pages, parseInt(v,10)||1));
    scrollToPage(n-1);
  }

  // --- Init ---
  (async function(){
    const slug = qs('book');
    if (!slug){
      const c = $('#columns');
      if (c) c.innerHTML = '<div class="page-column"><p>Missing ?book=…</p></div>';
      return;
    }
    setLoading(true);

    try{
      const txtURL = `books/${slug}/book.txt`;
      const imgBase = `books/${slug}/images`;

      let raw = await fetchText(txtURL);

      // אופציונלי: הסרת Place/Date בתחילת הטקסט אם מופיעים
      raw = raw.replace(/^(Place:\s*[^\n]+)\n/i,'')
               .replace(/^(Date:\s*[^\n]+)\n/i,'');

      const blocks = toBlocks(raw, imgBase);
      const html   = blocksToHTML(blocks);

      const columns = $('#columns');
      columns.innerHTML = html;

      // column-width = רוחב אזור הטקסט האמיתי בתוך הקלף
      const stageInner = document.querySelector('.page-inner');
      setPageWidthCSS(stageInner.clientWidth);

      // מונה ראשוני
      let {pages} = getPageMetrics();
      setCounter(0, pages);

      // ניווט בכפתורים
      const prev = $('#prev'), next = $('#next');
      if (prev) prev.onclick = ()=> scrollToPage(currentPageIndex()-1);
      if (next) next.onclick = ()=> scrollToPage(currentPageIndex()+1);
      const gotoBtn = $('#gotoBtn');
      if (gotoBtn) gotoBtn.onclick = askGoto;

      // עידכון מונה בעת גלילה/החלקה (Scroll Snap יעזור לנעילה בעמודים)
      columns.addEventListener('scroll', throttle(()=>{
        const {pages} = getPageMetrics();
        setCounter(currentPageIndex(), pages);
      }, 80), {passive:true});

      // תמונות עשויות לשנות פריסה → עדכון מונה לאחר טעינה
      const refreshAfterImages = throttle(()=>{
        const cur = currentPageIndex();
        const {pages} = getPageMetrics();
        setCounter(cur, pages);
      }, 120);
      columns.querySelectorAll('img').forEach(im=>{
        im.addEventListener('load', refreshAfterImages, {once:true});
        im.addEventListener('error', refreshAfterImages, {once:true});
      });

      // שינויי גודל/סיבוב – מחשבים מחדש column-width ושומרים מיקום
      const onResize = throttle(()=>{
        setPageWidthCSS(stageInner.clientWidth);
        const cur = currentPageIndex();
        const clamp = scrollToPage(cur);
        const {pages} = getPageMetrics();
        setCounter(clamp, pages);
      }, 150);
      addEventListener('resize', onResize);

      // פתיחה עם &page= (1-based)
      const p0 = parseInt(qs('page')||'',10);
      if (p0 && p0>0) scrollToPage(p0-1);

    }catch(err){
      console.error(err);
      const c = $('#columns');
      if (c) c.innerHTML = `<div class="page-column"><p>Failed to load book.<br>${String(err)}</p></div>`;
    }finally{
      setLoading(false);
    }
  })();
})();