// ----------- CONFIG -----------
// אם תשאיר את קובץ הטקסט והתיקייה images ליד index.html — לא צריך לשנות כלום.
const CANDIDATE_TXT = [
  './Europe-roots-trip.txt',
  '../Europe-roots-trip.txt',
  '/Europe-roots-trip.txt',
  '/assets/notes/Europe-roots-trip.txt',
  '/assets/europe-roots-trip/Europe-roots-trip.txt'
];

// היכן התמונות? ברירת מחדל: "./images/image-1.jpg|jpeg|png|webp"
const IMG_DIRS = [
  new URL('./images/', window.location).toString(),
  '/assets/europe-roots-trip/images/',
  '/assets/images/europe-roots-trip/'
];
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

// ----------- HELPERS -----------
async function tryFetch(url, opts={}) {
  try {
    const r = await fetch(url, opts);
    if (r.ok) return r;
  } catch (_) {}
  return null;
}

async function fetchFirst(paths) {
  for (const p of paths) {
    const r = await tryFetch(p, { cache: 'no-store' });
    if (r) return { url: p, res: r };
  }
  return null;
}

async function headExists(url){
  const r = await tryFetch(url, { method:'HEAD' });
  return !!r;
}

async function findImageSrc(num){
  for (const dir of IMG_DIRS) {
    for (const ext of IMG_EXTS) {
      const url = `${dir}image-${num}${ext}`;
      if (await headExists(url)) return url;
    }
  }
  return null;
}

// ----------- RENDER -----------
(async function init(){
  const mount = document.getElementById('sections');
  mount.textContent = '';

  // 1) הבא את קובץ הטקסט (ננסה כמה נתיבים)
  const found = await fetchFirst(CANDIDATE_TXT);
  if (!found) {
    mount.innerHTML = `<div class="error">Couldn’t load the diary text.
      Please place <code>Europe-roots-trip.txt</code> next to <code>index.html</code>
      or update paths in <code>main.js</code>.</div>`;
    return;
  }
  let raw = await found.res.text();

  // 2) החלף {image-N} ב-&lt;img&gt; (אסינכרוני)
  const jobs = [];
  raw = raw.replace(/\{image-(\d+)\}/g, (m, num) => {
    const ph = `@@IMG_${num}@@`;
    jobs.push((async () => {
      const src = await findImageSrc(num);
      return {
        ph,
        html: src
          ? `<figure class="figure"><img loading="lazy" src="${src}" alt="image-${num}"><figcaption>Photo ${num}</figcaption></figure>`
          : `<div class="pill missing">Missing image-${num}</div>`
      };
    })());
    return ph;
  });
  const replaced = await Promise.all(jobs);
  let hydrated = raw;
  for (const r of replaced) hydrated = hydrated.replaceAll(r.ph, r.html);

  // 3) פיצול חלקים לפי מפריד של ******** (8+ כוכביות בשורה לבדה)
  const parts = hydrated
    .split(/\r?\n\*{8,}\r?\n/g)
    .map(s => s.trim())
    .filter(Boolean);

  // 4) רנדר כל חלק, הוצא Place/Date רק מההתחלה, וטפל בכוכבית בודדת כשורת קישוט
  for (const part of parts) {
    let body = part, place=null, date=null;

    body = body.replace(/^(Place:\s*)(.+?)\s*\r?\n/i, (_, __, v) => { place = v.trim(); return ''; });
    body = body.replace(/^(Date:\s*)(.+?)\s*\r?\n/i,  (_, __, v) => { date  = v.trim(); return ''; });

    // כוכבית בודדת באמצע טקסט -> מפריד דקורטיבי
    body = body.replace(/\r?\n\*\r?\n/g, '\n@@STAR@@\n');

    const sec = document.createElement('section');
    sec.className = 'section';

    if (place || date) {
      const meta = document.createElement('div'); meta.className = 'meta';
      if (place){ const s=document.createElement('span'); s.className='pill'; s.textContent=`Place: ${place}`; meta.appendChild(s); }
      if (date){  const s=document.createElement('span'); s.className='pill'; s.textContent=`Date: ${date}`;   meta.appendChild(s); }
      sec.appendChild(meta);
    }

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'body';

    // חלק לפי @@STAR@@ כדי לשתול קו עם כוכבית בין קטעים
    const chunks = body.split('@@STAR@@');
    chunks.forEach((chunk, i) => {
      if (i>0) {
        const star = document.createElement('div');
        star.className = 'star-hr';
        star.innerHTML = '<span class="star">★</span>';
        bodyDiv.appendChild(star);
      }
      const container = document.createElement('div');
      container.className = 'paragraph';
      container.innerHTML = chunk
        // שמור שורות/רווחים, המרה למקטעים
        .split(/\r?\n\r?\n/).map(p => `<p>${p.replace(/\r?\n/g,'<br>')}</p>`).join('');
      bodyDiv.appendChild(container);
    });

    sec.appendChild(bodyDiv);
    mount.appendChild(sec);
  }

  if (!parts.length) {
    mount.innerHTML = '<div class="error">No sections found. Add lines with only ******** between sections.</div>';
  }
})();