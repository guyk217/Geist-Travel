// קורא את קובץ הטקסט, מזהה {image-N}, מצרף תמונות, מפצל לפי ********,
// מציג Place/Date כתגיות, וממיר שורות עם '*' בודדת לקו דקורטיבי עם כוכבית.

const TXT_URL = 'Europe-roots-trip.txt';
const IMG_DIR = '../../assets/europe-roots-trip/images/';
const IMG_EXTS = ['.jpg','.jpeg','.png','.webp'];

async function headExists(url){
  try{
    const r = await fetch(url, { method:'HEAD' });
    return r.ok;
  }catch(e){ return false; }
}
async function findImageSrc(base){
  for (const ext of IMG_EXTS){
    const url = base + ext;
    if (await headExists(url)) return url;
  }
  return null;
}

(async function init(){
  const mount = document.getElementById('sections');
  try{
    const res = await fetch(TXT_URL);
    if(!res.ok) throw new Error('Text file not found');
    let raw = await res.text();

    // 1) החלפת {image-N} בתגיות IMG (אסינכרוני: נשתמש בפלייסהולדרים)
    const jobs = [];
    raw = raw.replace(/\{image-(\d+)\}/g, (m, num)=>{
      const ph = `@@IMG_${num}@@`;
      jobs.push((async ()=>{
        const base = IMG_DIR + `image-${num}`;
        const src  = await findImageSrc(base);
        return { ph, html: src ? `<img src="${src}" alt="image-${num}">`
                               : `<div class="pill">Missing image-${num}</div>` };
      })());
      return ph;
    });
    const results = await Promise.all(jobs);
    let hydrated = raw;
    for (const r of results) hydrated = hydrated.replaceAll(r.ph, r.html);

    // 2) פיצול לחלקים: רק שורות שמכילות בדיוק כוכביות (8+) הן מפריד חלקים
    const parts = hydrated
      .split(/\r?\n\*{8,}\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    mount.innerHTML = ''; // נקה

    // 3) עבור כל חלק — טפל ב-Place/Date בתחילתו + כוכבית בודדת כקו דקורטיבי
    parts.forEach(part => {
      // חילוץ Place/Date רק מההתחלה (אם יש)
      let place=null, date=null, body=part;

      body = body.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,val)=>{
        place = val.trim(); return '';
      });
      body = body.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,val)=>{
        date = val.trim();  return '';
      });

      // המרת שורה שהיא '*' בלבד לדיב דקורטיבי
      body = body
        .replace(/\r?\n\*\r?\n/g, '\n@@STAR@@\n')        // הכן פלייסהולדר לכוכבית יחידה
        .trim();

      // בנה סקשן
      const sec = document.createElement('section');
      sec.className = 'section';

      if(place || date){
        const meta = document.createElement('div');
        meta.className = 'meta';
        if(place){ const s = document.createElement('span'); s.className='pill'; s.textContent=`Place: ${place}`; meta.appendChild(s); }
        if(date){  const s = document.createElement('span'); s.className='pill'; s.textContent=`Date: ${date}`;  meta.appendChild(s); }
        sec.appendChild(meta);
      }

      // המר את ה-@@STAR@@ לדיב דקורטיבי, שמור על LTR לטקסט
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'body';
      // חלק את הטקסט לפי הפלייסהולדרים כדי להכניס DOM "אמיתי" עבור הכוכבית
      const chunks = body.split('@@STAR@@');
      chunks.forEach((chunk, idx) => {
        if (idx>0){
          const star = document.createElement('div');
          star.className = 'star-hr';
          star.innerHTML = '<span class="star">★</span>';
          bodyDiv.appendChild(star);
        }
        // הכנס את ה-html (כבר כולל <img> מהשלב הקודם)
        const span = document.createElement('span');
        span.innerHTML = chunk
          .replace(/&lt;/g,'&amp;lt;') // הגנה בסיסית
          .replace(/&gt;/g,'&amp;gt;');
        // בפועל יש לנו כבר <img> כתווים, אז נרצה לא לאסקלייט אותם שוב.
        // לכן נעדיף פשוט:
        span.innerHTML = chunk;
        bodyDiv.appendChild(span);
      });

      sec.appendChild(bodyDiv);
      mount.appendChild(sec);
    });

    if(!parts.length){
      mount.textContent = 'No sections found. Make sure you separate sections with a line of ********';
    }
  }catch(err){
    mount.textContent = 'Error loading text.';
    // אפשר גם להציג שגיאה לקונסול:
    console.error(err);
  }
})();