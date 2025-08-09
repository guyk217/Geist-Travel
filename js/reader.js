// קריאת ספר: מפרק לפי מפרידי ********, מצמיד תמונות {image-N},
// מציג Place/Date כשבבי מידע, ודפדוף ע"י החלקה (סוויפ).

(function () {
  const params = new URLSearchParams(location.search);
  const slug   = params.get('slug') || 'europe-roots-1993'; // ברירת מחדל לספר שלך
  const base   = `books/${slug}`;
  const txtURL = `${base}/book.txt`;
  const imgDir = `${base}/images`;

  const canvas = document.getElementById('canvas');
  const pager  = document.getElementById('pager');
  const hint   = document.getElementById('hint');

  // --------- Utilities ----------
  const IMG_EXTS = ['jpg','jpeg','png','webp'];

  function imgHTML(num){
    // טריק זעיר: נטען <picture> עם כמה פורמטים; הדפדפן יבחר מה שקיים.
    const name = `image-${num}`;
    const sources = IMG_EXTS.map(ext => `<source srcset="${imgDir}/${name}.${ext}" type="image/${ext==='jpg'?'jpeg':ext}">`).join('');
    // נפילה ל-JPG (אם אין כלום – יוצג ריבוע "חסר תמונה")
    return `
      <picture onerror="this.outerHTML='<div class=chip>Missing ${name}</div>'">
        ${sources}
        <img src="${imgDir}/${name}.jpg" alt="${name}">
      </picture>`;
  }

  function splitParts(raw){
    // ננרמל שורות, נחליף תמונות, ונפצל.
    let text = raw.replace(/\r\n?/g, '\n');

    // החלפת {image-N} ל-HTML (נשאיר בלי escaping מכיוון שהטקסט שלנו “נקי”)
    text = text.replace(/\{image-(\d+)\}/g, (_,n)=> imgHTML(n));

    // מפצלים על שורה של 8+ כוכביות – עם או בלי רווחים מסביב
    const parts = text.split(/(?:^|\n)\*{8,}\s*(?:\n|$)/).map(s=>s.trim());
    return parts.filter(p => p.length); // בלי חלקים ריקים
  }

  function extractMetaAndBody(part){
    // מוציא Place/Date משתי שורות ראשונות אם קיימות
    let place=null, date=null, body=part;

    body = body.replace(/^(?:Place:\s*)(.+)\s*\n/i, (_,v)=>{ place=v.trim(); return '' });
    body = body.replace(/^(?:Date:\s*)(.+)\s*\n/i,  (_,v)=>{ date =v.trim(); return '' });

    // שורה של כוכבית בודדת => קו דקורטיבי
    body = body.replace(/(?:^|\n)\*\s*(?:\n|$)/g, '\n@@STAR@@\n');

    return { place, date, body: body.trim() };
  }

  function pageDOM(meta){
    const art = document.createElement('article');
    art.className = 'page';
    const inner = document.createElement('div');
    inner.className = 'page-inner';

    // chips
    const chips = document.createElement('div');
    chips.className = 'chips';
    if (meta.date)  chips.innerHTML += `<span class="chip">Date: ${meta.date}</span>`;
    if (meta.place) chips.innerHTML += `<span class="chip">Place: ${meta.place}</span>`;
    inner.appendChild(chips);

    // body
    const content = document.createElement('div');
    content.className = 'content';
    // נפרק לפי פלייסהולדר של קו-כוכב
    meta.body.split('@@STAR@@').forEach((chunk, idx) => {
      if (idx>0){
        const hr = document.createElement('div');
        hr.className = 'star-hr';
        hr.innerHTML = `<span class="star">★</span>`;
        content.appendChild(hr);
      }
      const block = document.createElement('div');
      block.innerHTML = chunk;          // כבר כולל <picture>/<img> מההחלפה
      content.appendChild(block);
    });

    inner.appendChild(content);
    art.appendChild(inner);
    return art;
  }

  // --------- Swipe navigation ----------
  let current = 0, pages = [];

  function show(i){
    if (!pages.length) return;
    current = Math.max(0, Math.min(i, pages.length-1));
    canvas.style.transform = `translateX(${-current*100}%)`;
    pager.textContent = `${current+1}/${pages.length}`;
    // רמז החלקה – רק בדף הראשון
    hint.style.opacity = current===0 && pages.length>1 ? '1' : '0';
  }

  function bindSwipe(){
    let startX=0, dx=0, touching=false;
    const TH = 60; // threshold

    canvas.addEventListener('touchstart', e=>{
      touching=true; startX = e.touches[0].clientX; dx=0;
    }, {passive:true});

    canvas.addEventListener('touchmove', e=>{
      if(!touching) return;
      dx = e.touches[0].clientX - startX;
      canvas.style.transition='none';
      canvas.style.transform = `translateX(${(-current*100)+(dx/window.innerWidth*100)}%)`;
    }, {passive:true});

    canvas.addEventListener('touchend', ()=>{
      canvas.style.transition='';
      if (Math.abs(dx) > TH){
        show( dx<0 ? current+1 : current-1 );
      } else {
        show(current);
      }
      touching=false; dx=0;
    });
  }

  // --------- Boot ----------
  (async function(){
    try{
      const res = await fetch(txtURL);
      if(!res.ok) throw new Error('book.txt not found');
      const raw = await res.text();

      const parts = splitParts(raw);
      pages = parts.map(p => extractMetaAndBody(p)).map(pageDOM);

      // ננקה ונכניס DOM
      canvas.innerHTML = '';
      pages.forEach(p => canvas.appendChild(p));

      // תצוגה ראשונית
      bindSwipe();
      show(0);
    }catch(err){
      canvas.innerHTML = `<div class="page"><div class="page-inner"><div class="content">Loading error: ${err.message}</div></div></div>`;
      pager.textContent = '—';
      console.error(err);
    }
  })();

})();