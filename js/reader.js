// reader.js — Lazy pagination + virtualization (prev/current/next only)
// - Loads books/<slug>/book.txt
// - Replaces {image-N} with <img> (jpg/jpeg/png/webp), images get their own page
// - Renders ****** as <hr>
// - Paginates with a hidden measurer, builds next page on demand
// - Disables arrows at ends, supports swipe

(function(){
  const EXT = ['.jpg','.jpeg','.png','.webp'];

  // ---------- utils ----------
  const qs = k => {
    const v = new URLSearchParams(location.search).get(k);
    return v ? decodeURIComponent(v) : null;
  };
  const $ = sel => document.querySelector(sel);

  const setCounter = (i,totalKnown,totalFinal)=>{
    // totalKnown: כמה כבר ידוע; totalFinal: אם ידוע המספר הסופי
    const t = totalFinal ? totalKnown : (totalKnown ? `${totalKnown}?` : '?');
    $('#counter').textContent = `${i+1}/${t}`;
    $('#prev').disabled = (i<=0);
    if (totalFinal) $('#next').disabled = (i>=totalKnown-1);
    else $('#next').disabled = false; // עד שלא יודעים הכל – אפשר להמשיך אם יש עוד שבנינו
  };

  const fetchText = async url => {
    const r = await fetch(url + `?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  };

  // Try existing file with multiple extensions
  const probeImage = async base => {
    for (const ext of EXT){
      const url = `${base}${ext}`;
      const ok = await new Promise(res=>{
        const im = new Image();
        im.onload = ()=>res(true);
        im.onerror = ()=>res(false);
        im.src = url;
      });
      if (ok) return url;
    }
    return null;
  };

  // Replace {image-N} with real <img>, or a placeholder. Images get their own page later.
  async function hydrateImages(raw, imgDir){
    const jobs = [];
    const withPH = raw.replace(/\{image-(\d+)\}/g, (m, num)=>{
      const ph = `@@IMG_${num}@@`;
      jobs.push((async ()=>{
        const src = await probeImage(`${imgDir}/image-${num}`);
        const html = src
          ? `<img src="${src}" loading="lazy" alt="image-${num}">`
          : `<div class="pill">Missing image ${num}</div>`;
        return {ph, html};
      })());
      return ph;
    });
    const done = await Promise.all(jobs);
    let out = withPH;
    for (const {ph, html} of done) out = out.replaceAll(ph, html);
    return out;
  }

  const escapeHTML = s => s
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');

  // Convert plain text to HTML, keep blank lines, ****** → <hr>
  function textToHTML(text){
    return text.split(/\r?\n/).map(line=>{
      if (/^\*{6,}\s*$/.test(line)) return '<hr class="separator">';
      if (/^\s*$/.test(line))       return '<br>';
      return escapeHTML(line);
    }).join('\n');
  }

  // ---------- layout helpers ----------
  // Gentle padding tweak so fewer pages (a bit less right padding)
  function tweakPadding(){
    const css = document.createElement('style');
    css.textContent = `
      .page-inner{ padding:22px 18px 26px 22px !important; }
      .page-inner img{ display:block; width:100%; height:auto; border-radius:8px; margin:10px 0; }
      hr.separator{ border:none; height:1px;
        background:linear-gradient(90deg, transparent, #b7a98f, transparent); margin:14px 0; }
      #stage{ position:relative; height: calc(100dvh - 110px); overflow:hidden; margin:8px auto 0; max-width:820px; }
      #track{ display:flex; height:100%; will-change: transform; }
      .page{ flex:0 0 100%; height:100%; padding:10px; box-sizing:border-box;}
      .page-card{ height:100%; width:100%; background:#fff7; border:1px solid var(--border);
        border-radius:18px; backdrop-filter: blur(2px); box-shadow:0 10px 24px var(--shadow); display:flex;}
      .page-inner{ direction:ltr; text-align:left;
        font-family:"EB Garamond", Georgia, "Times New Roman", serif;
        font-size:18px; line-height:1.7; color:#2c2a27; overflow:hidden; width:100%; }
      .loading-badge{position:absolute; inset:0; display:grid; place-items:center; pointer-events:none;}
      .loading-badge .pill{background:#2f2a26; color:#fff; box-shadow:0 8px 22px rgba(0,0,0,.2);}
    `;
    document.head.appendChild(css);
  }

  function buildShell(){
    // Create three page slots for virtualization
    const track = $('#track');
    track.innerHTML = '';
    for (let i=0;i<3;i++){
      const page = document.createElement('div'); page.className='page';
      const card = document.createElement('div'); card.className='page-card';
      const inner= document.createElement('div'); inner.className='page-inner';
      card.appendChild(inner); page.appendChild(card); track.appendChild(page);
    }
    return track;
  }

  function makeMeasurer(){
    // A hidden page with identical CSS, used only for measuring scrollHeight
    const track = $('#track');
    const measPage = document.createElement('div'); measPage.className='page';
    measPage.style.visibility='hidden';
    const card = document.createElement('div'); card.className='page-card';
    const inner= document.createElement('div'); inner.className='page-inner';
    inner.style.overflow='auto';
    card.appendChild(inner); measPage.appendChild(card); track.appendChild(measPage);
    return {holder: measPage, inner};
  }

  function maxInnerHeight(){
    const stage = $('#stage');
    const cs = getComputedStyle(stage);
    // inner height ≈ stage height minus outer paddings/margins in page/card/inner (we kept them fixed)
    // Empirically we allow inner scrollHeight up to 92% of stage height.
    return Math.floor(stage.clientHeight * 0.92);
  }

  // ---------- tokenization ----------
  function tokenize(html){
    // split into image/hr blocks and text chunks
    const out = [];
    html.split(/(<img[^>]+>|<hr class="separator">)/g).forEach(part=>{
      if (!part) return;
      if (/^<img|^<hr/.test(part)) out.push({t:'html', v:part});
      else out.push({t:'txt', v:part});
    });
    return out;
  }

  // ---------- lazy pagination state ----------
  let TOKENS = [];
  let CUR_POS = 0;                 // index into tokens: where next page should start
  const PAGES = [];                // cache of page html strings
  let TOTAL_KNOWN = 0;             // pages built so far
  let TOTAL_FINAL = false;         // becomes true once we reached end
  let CURRENT_INDEX = 0;

  // builds the next page from CUR_POS; returns html or null if end
  function buildNextPage(measurer){
    if (CUR_POS >= TOKENS.length){
      TOTAL_FINAL = true;
      return null;
    }

    const HMAX = maxInnerHeight();
    const m = measurer.inner;
    let html = '';
    m.innerHTML = '';      // reset
    let i = CUR_POS;

    const commit = () => { CUR_POS = i; return html || '<br>'; };

    while (i < TOKENS.length){
      const tk = TOKENS[i];

      if (tk.t === 'html'){
        // images get their own page to prevent reflow jumps; <hr> can stay
        if (/^<img/i.test(tk.v)){
          if (html.trim().length){ // finish current page, leave image for next
            break;
          } else {
            // image alone page
            m.innerHTML = tk.v;
            html = tk.v;
            i++;
            break;
          }
        } else {
          const test = html + tk.v;
          m.innerHTML = test;
          if (m.scrollHeight <= HMAX){
            html = test; i++;
          } else {
            break;
          }
        }
      } else {
        // text token – add word by word
        const parts = tk.v.split(/(\s+)/);
        for (let j=0;j<parts.length;j++){
          const test = html + parts[j];
          m.innerHTML = test;
          if (m.scrollHeight <= HMAX){
            html = test;
          } else {
            // if nothing fitted yet (very long word) – hard split
            if (!html.trim()){
              let chunk = parts[j];
              while (chunk.length>1){
                const mid = Math.max(1, Math.floor(chunk.length*0.9));
                const cut = chunk.slice(0, mid);
                m.innerHTML = cut;
                if (m.scrollHeight <= HMAX){ html = cut; chunk = ''; break; }
                chunk = cut;
              }
            }
            // we stop page here
            const before = parts.slice(0,j).join('');
            const after  = parts.slice(j).join('');
            // put back remaining text into tokens by replacing current
            TOKENS[i] = {t:'txt', v: after};
            // if “before” exists – we already consumed it (in html)
            return commit();
          }
        }
        // consumed full text token
        i++;
      }
    }

    // we exit loop: either reached end or overflow about to happen
    return commit();
  }

  function renderThree(index){
    // write prev/current/next into 3 slots
    const track = $('#track');
    const slots = Array.from(track.children).slice(0,3); // ignore measurer at the end
    const get = (k)=> PAGES[k] ?? '';
    const write = (slot, html) => { slot.firstChild.firstChild.innerHTML = html; };

    write(slots[0], get(index-1));
    write(slots[1], get(index));
    write(slots[2], get(index+1));

    const pageW = $('#stage').clientWidth;
    track.style.transition = 'none';
    track.style.transform  = `translate3d(${-pageW}px,0,0)`; // middle slot centered

    // ensure correct widths for 3-slot track
    track.style.width = `${pageW*3}px`;
    slots.forEach(s => s.style.width = `${pageW}px`);

    // animate slight snap when changing (optional)
    requestAnimationFrame(()=>{
      track.style.transition = 'transform 240ms ease';
      track.style.transform  = `translate3d(${-pageW}px,0,0)`;
    });
  }

  function goTo(index){
    index = Math.max(0, Math.min(index, TOTAL_KNOWN-1));
    CURRENT_INDEX = index;
    renderThree(CURRENT_INDEX);
    setCounter(CURRENT_INDEX, TOTAL_KNOWN, TOTAL_FINAL);
  }

  function ensurePageBuilt(n, measurer){
    while (TOTAL_KNOWN <= n){
      const html = buildNextPage(measurer);
      if (html == null) break; // reached end
      PAGES.push(html);
      TOTAL_KNOWN = PAGES.length;
    }
  }

  function enableSwipe(prevFn, nextFn){
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
        if(dx<0) nextFn(); else prevFn();
      }
    },{passive:true});
  }

  // ---------- init ----------
  (async function(){
    tweakPadding();

    const slug = qs('book');
    if (!slug){
      $('#track').innerHTML =
        '<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=…</div></div></div>';
      return;
    }

    // Loading badge (keeps the "חזרה" usable)
    const badge = document.createElement('div');
    badge.className = 'loading-badge';
    badge.innerHTML = '<div class="pill" style="padding:10px 16px;font-weight:700;">טוען את הספר…</div>';
    $('#stage').appendChild(badge);

    const txtURL = `books/${slug}/book.txt`;
    const imgDir = `books/${slug}/images`;

    try{
      let raw = await fetchText(txtURL);
      // strip Place/Date lines at top (we כבר מציגים במקומות אחרים אם תרצה בעתיד)
      raw = raw.replace(/^(Place:\s*[^\r\n]+)\s*\r?\n/i,'')
               .replace(/^(Date:\s*[^\r\n]+)\s*\r?\n/i,'');

      raw = await hydrateImages(raw, imgDir);
      let html = textToHTML(raw);

      // Tokenize once
      TOKENS = tokenize(html);
      CUR_POS = 0;
      PAGES.length = 0;
      TOTAL_KNOWN = 0;
      TOTAL_FINAL  = false;
      CURRENT_INDEX= 0;

      const track = buildShell();
      const meas  = makeMeasurer();

      // Build first page only
      ensurePageBuilt(0, meas);
      // Build second (next) so שיהיה החלקה חלקה
      ensurePageBuilt(1, meas);
      goTo(0);

      // lazy build remaining in idle slices (לא חוסם UI)
      const idle = (cb)=> (window.requestIdleCallback ? requestIdleCallback(cb) : setTimeout(cb, 50));
      const pump = ()=>{
        if (TOTAL_FINAL) return;
        idle(()=>{
          // בונים עוד 2-3 עמודים בכל סשן כדי לא לתקוע
          for(let k=0;k<3 && !TOTAL_FINAL; k++){
            const html = buildNextPage(meas);
            if (html==null) break;
            PAGES.push(html);
            TOTAL_KNOWN = PAGES.length;
            setCounter(CURRENT_INDEX, TOTAL_KNOWN, TOTAL_FINAL);
          }
          if (!TOTAL_FINAL) pump();
        });
      };
      pump();

      // navigation
      const prev = ()=>{
        if (CURRENT_INDEX<=0) return;
        CURRENT_INDEX--;
        // דואגים שיש גם את הקודם-של-קודם ב־cache (לא חובה)
        renderThree(CURRENT_INDEX);
        setCounter(CURRENT_INDEX, TOTAL_KNOWN, TOTAL_FINAL);
      };
      const next = ()=>{
        ensurePageBuilt(CURRENT_INDEX+1, meas);
        if (CURRENT_INDEX+1 >= TOTAL_KNOWN) return;
        CURRENT_INDEX++;
        renderThree(CURRENT_INDEX);
        setCounter(CURRENT_INDEX, TOTAL_KNOWN, TOTAL_FINAL);
      };

      $('#prev').onclick = prev;
      $('#next').onclick = next;
      enableSwipe(prev, next);

      // על שינוי גודל – נשמר את ההתקדמות, נחשב מחדש, אבל בעדינות
      let resizeTimer=null;
      addEventListener('resize', ()=>{
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(()=>{
          // נבנה הכל מחדש מהתחלה, אבל נשאר באותו יחס (נניח באותו אינדקס ככל הניתן)
          const keep = CURRENT_INDEX;
          const keepTokenPos = CUR_POS; // פחות מדויק, אבל מספיק
          // reset
          $('#track').innerHTML = '';
          TOKENS = tokenize(textToHTML(raw));
          CUR_POS = 0; PAGES.length=0; TOTAL_KNOWN=0; TOTAL_FINAL=false;
          buildShell(); const m2 = makeMeasurer();
          ensurePageBuilt(keep, m2);
          ensurePageBuilt(keep+1, m2);
          goTo(Math.min(keep, TOTAL_KNOWN-1));
          pump();
        }, 180);
      });

      // done loading
      badge.remove();

    }catch(err){
      console.error(err);
      $('#track').innerHTML =
        `<div class="page"><div class="page-card"><div class="page-inner">
          Failed to load book.<br>${String(err)}
        </div></div></div>`;
      badge.remove();
    }
  })();
})();