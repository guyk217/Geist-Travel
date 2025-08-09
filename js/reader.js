// js/reader.js
(function(){
  const q = new URLSearchParams(location.search);
  const slug = q.get('book');
  const titleEl = document.getElementById('bookTitle');
  const subEl   = document.getElementById('bookSubtitle');
  const mount   = document.getElementById('sections');

  if(!slug){
    titleEl.textContent = 'No book selected';
    mount.textContent = 'השתמשו בקישור מהמדף.'; 
    return;
  }

  // נתיבי הקובץ והתמונות עבור הספר הנתון
  const BASE = `books/${slug}/`;
  const TXT_URL = BASE + 'book.txt';
  const IMG_DIR = BASE + 'images/image-';
  const IMG_EXTS = ['.jpg','.jpeg','.png','.webp'];

  // שלוף כותרת משנה ותמונה מ-books.json (לא חובה, רק ל-header)
  fetch('books/books.json').then(r=>r.ok?r.json():[]).then(list=>{
    const meta = Array.isArray(list) ? list.find(b=>b.slug===slug) : null;
    titleEl.textContent = meta?.title || slug;
    subEl.textContent   = meta?.subtitle || '';
  }).catch(()=>{ titleEl.textContent = slug; });

  async function headExists(url){
    try{ const r = await fetch(url,{method:'HEAD'}); return r.ok; }
    catch(e){ return false; }
  }
  async function findImageSrc(num){
    for(const ext of IMG_EXTS){
      const url = IMG_DIR + String(num) + ext;
      if(await headExists(url)) return url;
    }
    return null;
  }

  async function init(){
    try{
      const res = await fetch(TXT_URL);
      if(!res.ok) throw new Error('text not found');
      let raw = await res.text();

      // החלפת {image-N} בתגיות IMG (אסינכרוני)
      const jobs = [];
      raw = raw.replace(/\{image-(\d+)\}/g, (m, num)=>{
        const ph = `@@IMG_${num}@@`;
        jobs.push((async ()=>{
          const src = await findImageSrc(num);
          return { ph, html: src ? `<img src="${src}" alt="image-${num}">`
                                 : `<div class="pill">Missing image-${num}</div>` };
        })());
        return ph;
      });
      const resolved = await Promise.all(jobs);
      let hydrated = raw;
      for(const r of resolved) hydrated = hydrated.replaceAll(r.ph, r.html);

      // פיצול ל"פרקים" לפי שורה שמכילה 8+ כוכביות (********)
      const parts = hydrated
        .split(/\r?\n\*{8,}\r?\n/)
        .map(s=>s.trim())
        .filter(Boolean);

      mount.innerHTML = '';

      parts.forEach(part=>{
        let place=null, date=null, body=part;

        // נמשוך Place/Date אם הם ממש בתחילת החלק (שורה-שורה)
        body = body.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,val)=>{ place=val.trim(); return ''; });
        body = body.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,val)=>{ date =val.trim(); return ''; });

        // המרת שורה של כוכבית בודדת לכוכבית דקורטיבית
        body = body.replace(/\r?\n\*\r?\n/g, '\n@@STAR@@\n').trim();

        const sec = document.createElement('section');
        sec.className = 'section';

        if(place || date){
          const meta = document.createElement('div');
          meta.className = 'meta';
          if(place){ const s=document.createElement('span'); s.className='pill'; s.textContent=`Place: ${place}`; meta.appendChild(s); }
          if(date){  const s=document.createElement('span'); s.className='pill'; s.textContent=`Date: ${date}`;  meta.appendChild(s); }
          sec.appendChild(meta);
        }

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'body';

        // חלקים לפי כוכבית-בודדת
        const chunks = body.split('@@STAR@@');
        chunks.forEach((chunk, idx)=>{
          if(idx>0){
            const star = document.createElement('div');
            star.className = 'star-hr';
            star.innerHTML = '<span class="star">★</span>';
            bodyDiv.appendChild(star);
          }
          const span = document.createElement('span');
          span.innerHTML = chunk; // כולל IMG שכבר הוחדרו
          bodyDiv.appendChild(span);
        });

        sec.appendChild(bodyDiv);
        mount.appendChild(sec);
      });

      if(!parts.length){
        mount.textContent = 'לא נמצאו פרקים בקובץ.';
      }
    }catch(err){
      mount.textContent = 'שגיאה בטעינת הספר.';
      console.error(err);
    }
  }

  init();
})();