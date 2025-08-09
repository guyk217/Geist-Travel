// Reader – יציב, בלי תקיעות:
// * book.txt נטען מ books/<slug>/book.txt
// * {image-N} -> עמוד תמונה (JPG כברירת מחדל; אם חסר מוצג "Missing image")
// * ****** -> <hr>
// * עימוד לפי 17 שורות (≈ 17*56 תווים), פסקאות נשברות יפה על גבולות עמוד
// * שכבת "טוען את הספר…" נסגרת רק כשהעמוד הראשון מוכן

(function(){
  // ---------- Utils ----------
  const $ = (s, el=document) => el.querySelector(s);
  const qs = k => {
    const v = new URLSearchParams(location.search).get(k);
    return v ? decodeURIComponent(v) : null;
  };
  const CAP_LINES = 17;
  const CHARS_PER_LINE = 56;             // ניתן לכיול אם תרצה
  const CAP = CAP_LINES * CHARS_PER_LINE;
  const HR_WEIGHT = 2 * CHARS_PER_LINE;  // מפריד = ~2 שורות

  function showLoading(show){
    const el = $('#loading');
    if (el) el.style.display = show ? 'flex' : 'none';
  }
  function setCounter(i, total){
    $('#counter').textContent = `${i+1}/${Math.max(total,1)}`;
    $('#prev').disabled = (i<=0);
    $('#next').disabled = (i>=total-1);
  }
  async function fetchText(url){
    const r = await fetch(url + `?v=${Date.now()}`, {cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  }
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ---------- Tokenize book.txt ----------
  // הופך את הקובץ לטוקנים: {type:'para'|'hr'|'image', text?|url?}
  function tokenize(raw, imgDir){
    // Place/Date בראש (לא חובה)
    let place=null, date=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

    const tokens = [];
    if (date || place){
      const pills = [
        date  ? `<span class="pill">Date: ${esc(date)}</span>` : '',
        place ? `<span class="pill">Place: ${esc(place)}</span>` : ''
      ].filter(Boolean).join(' ');
      tokens.push({ type:'html', html:`<div class="meta-pills">${pills}</div>` });
    }

    // קודם מחליפים {image-N} במארקר טכני כדי לא להתנגש עם שאר הלוגיקה
    const parts = raw.split(/(\{image-(\d+)\})/g);

    for (let i=0; i<parts.length; i++){
      const part = parts[i];
      if (!part) continue;

      const m = part.match(/^\{image-(\d+)\}$/);
      if (m){
        const n = m[1];
        // תמונה היא עמוד בפני עצמו; לא טוענים מראש כדי לא להקריס
        const url = `${imgDir}/image-${n}.jpg`;
        tokens.push({ type:'image', url, alt:`image-${n}` });
        continue;
      }

      // טקסט רגיל: מפצלים לשורות, מזהים ****** ו־פסקאות
      const lines = part.replace(/\r/g,'').split('\n');
      let para = [];
      const flushPara = ()=>{
        if (!para.length) return;
        const text = para.join(' ').trim().replace(/\s+/g,' ');
        if (text) tokens.push({ type:'para', text });
        para = [];
      };
      for (const ln of lines){
        if (/^\*{6,}\s*$/.test(ln)){
          flushPara();
          tokens.push({ type:'hr' });
        } else if (/^\s*$/.test(ln)){
          flushPara();
        } else {
          para.push(ln.trim());
        }
      }
      flushPara();
    }

    return tokens;
  }

  // ---------- Pagination by character budget ----------
  // ממיר טוקנים לדפים (HTML סטרינג), תמונות = דף נפרד
  function paginate(tokens){
    const pages = [];
    let budget = CAP;
    let html = '';

    const pushPage = ()=>{
      pages.push(html || '<br>');
      html = '';
      budget = CAP;
    };

    const pushParaChunk = (text) => {
      html += `<p>${esc(text)}</p>`;
      budget -= Math.ceil(text.length); // ספירה גסה אך יציבה
    };

    for (const tk of tokens){
      if (pages.length > 400) break; // תקרת ביטחון

      if (tk.type === 'html'){
        // בלוק HTML קטן (ה־pills) – נספר 1 שורה
        const weight = CHARS_PER_LINE;
        if (weight > budget) pushPage();
        html += tk.html;
        budget -= weight;
        continue;
      }

      if (tk.type === 'hr'){
        if (HR_WEIGHT > budget) pushPage();
        html += '<hr class="separator">';
        budget -= HR_WEIGHT;
        continue;
      }

      if (tk.type === 'image'){
        // תמיד דף נפרד
        if (html.trim()) pushPage();
        const safeImg = `<img src="${tk.url}" alt="${esc(tk.alt)}" loading="lazy" decoding="async"
                          onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'pill',textContent:'Missing image'}))">`;
        pages.push(safeImg);
        html = '';
        budget = CAP;
        continue;
      }

      if (tk.type === 'para'){
        let text = tk.text;
        // אם נכנס כולו – שים וסיים
        if (text.length <= budget){
          pushParaChunk(text);
          continue;
        }

        // לא נכנס: נפרק למילים ונחלק על כמה דפים
        const words = text.split(/\s+/);
        let cur = '';

        for (let i=0; i<words.length; i++){
          const w = words[i];
          const trial = (cur ? cur + ' ' : '') + w;
          if (trial.length <= budget){
            cur = trial;
          } else {
            if (cur){ pushParaChunk(cur); }
            else {
              // מילה בודדת גדולה מהתקציב: נחתוך אותה לפי התקציב
              const part = w.slice(0, budget);
              pushParaChunk(part);
              words[i] = w.slice(part.length);
              i--; // יטופל בסיבוב הבא
            }
            pushPage();
            cur = '';
          }
        }
        if (cur){
          if (cur.length > budget){
            // קצה נדיר: אם נשארת שורה ארוכה מדי – פצל
            const first = cur.slice(0, budget);
            pushParaChunk(first);
            pushPage();
            const rest = cur.slice(first.length).trim();
            if (rest) pushParaChunk(rest);
          } else {
            pushParaChunk(cur);
          }
        }
      }
    }
    if (html.trim() || !pages.length) pushPage();
    return pages;
  }

  // ---------- Render ----------
  function buildPage(html){
    const p   = document.createElement('div'); p.className='page';
    const card= document.createElement('div'); card.className='page-card';
    const inn = document.createElement('div'); inn.className='page-inner';
    inn.innerHTML = html;
    card.appendChild(inn); p.appendChild(card);
    return p;
  }
  function renderPages(pages){
    const track = $('#track');
    track.innerHTML = '';
    for (const h of pages){
      track.appendChild(buildPage(h));
    }
  }

  function enableSwipe(goPrev, goNext){
    const el = $('#stage');
    let x0=null,y0=null,t0=0;
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
        if(dx<0) goNext(); else goPrev();
      }
    },{passive:true});
  }

  // ---------- Main ----------
  (async function init(){
    showLoading(true);

    const slug = qs('book');
    if (!slug){
      $('#track').innerHTML = '<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=</div></div></div>';
      showLoading(false);
      return;
    }

    const txtURL = `books/${slug}/book.txt`;
    const imgDir = `books/${slug}/images`;

    try{
      let raw = await fetchText(txtURL);
      if(!raw.trim()){
        $('#track').innerHTML = '<div class="page"><div class="page-card"><div class="page-inner">Empty book.txt</div></div></div>';
        showLoading(false);
        return;
      }

      // טוקניזציה (ללא טעינת תמונות מראש כדי לא להיתקע)
      const tokens = tokenize(raw, imgDir);

      // עימוד
      const pages = paginate(tokens);

      // ציור + ניווט
      renderPages(pages);
      let index = 0, total = pages.length;

      const go = (i)=>{
        index = Math.max(0, Math.min(total-1, i));
        const w = $('#stage').clientWidth;
        $('#track').style.transition = 'transform 260ms ease';
        $('#track').style.transform  = `translate3d(${-index*w}px,0,0)`;
        setCounter(index, total);
      };

      $('#prev').onclick = ()=>go(index-1);
      $('#next').onclick = ()=>go(index+1);
      enableSwipe(()=>go(index-1), ()=>go(index+1));

      // Snap ראשון + סגירת טעינה
      go(0);
      showLoading(false);

      // ריסייז – רק יישר את הטרנספורם (אין חישוב מחדש כי העימוד לפי תווים)
      addEventListener('resize', ()=> go(index));

    }catch(err){
      console.error(err);
      showLoading(false);
      $('#track').innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Failed to load book.<br>${String(err)}</div></div></div>`;
    }
  })();
})();