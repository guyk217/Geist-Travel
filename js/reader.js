// js/reader.js — טוען ספר, ממיר תמונות, מפריד קווים, מעמד דפים ומציג
(function () {
  // ===== Utilities =====
  const $ = (sel) => document.querySelector(sel);
  const qs = (k) => new URLSearchParams(location.search).get(k);
  const slug = qs('book'); // books/<slug>/*
  if (!slug) {
    console.error('Missing ?book=slug in URL');
    return;
  }

  const textURL = `books/${slug}/book.txt`;
  const imgDir  = `books/${slug}/images`;

  const IMG_EXTS = ['jpg','jpeg','png','webp'];

  async function headExists(url) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      return r.ok;
    } catch { return false; }
  }
  async function findImageSrc(base) {
    for (const ext of IMG_EXTS) {
      const url = `${base}.${ext}`;
      if (await headExists(url)) return url;
    }
    return null;
  }

  // ===== DOM refs =====
  const stage   = $('#stage');
  const track   = $('#track');
  const pagerEl = $('#pager');
  const prevBtn = $('#prevBtn');
  const nextBtn = $('#nextBtn');

  // ===== Paging config =====
  // עימוד לפי תווים לעמוד (בערך) — מותאם למובייל. אפשר לשנות:
  const CHARS_PER_PAGE_BASE = 1600; // ערך בסיס
  const IMG_BLOCK = '\n@@IMG@@\n'; // עוגן פנימי

  let pages = [];     // מערך HTML לכל עמוד
  let pageWidth = 0;  // רוחב עמוד בפיקסלים
  let current = 0;    // אינדקס עמוד נוכחי

  // ===== Load text, hydrate images & separators, paginate and render =====
  (async function init() {
    try {
      const res = await fetch(textURL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Text not found');
      let raw = await res.text();

      // 1) המרת {image-N} ל־<img> (אסינכרוני)
      const jobs = [];
      raw = raw.replace(/\{image-(\d+)\}/g, (m, num) => {
        const ph = `@@IMG_${num}@@`;
        jobs.push((async () => {
          const base = `${imgDir}/image-${num}`;
          const src = await findImageSrc(base);
          const html = src
            ? `<img loading="lazy" decoding="async" src="${src}" alt="image-${num}">`
            : `<div class="pill">Missing image-${num}</div>`;
          return { ph, html };
        })());
        return ph;
      });
      const done = await Promise.all(jobs);
      let hydrated = raw;
      for (const r of done) hydrated = hydrated.replaceAll(r.ph, r.html);

      // 2) המרת שורות של ******** לקו מפריד יפה
      hydrated = hydrated.replace(/^\*{6,}\s*$/gm, '<hr class="separator">');

      // 3) נרצה לשמור על כותרות "Place/Date" בתחילת קטעים — אין צורך בפיצול לפי זה,
      //    העימוד שלנו לפי תווים; מספיק שהטקסט מכיל אותם.

      // 4) עימוד לפי תווים: התאמה דינמית למסך (מוסיף/מוריד ~15%)
      const vw = Math.min(980, document.documentElement.clientWidth || 360);
      const scale = vw < 380 ? 0.85 : vw < 480 ? 0.95 : vw > 800 ? 1.15 : 1.0;
      const CHARS_PER_PAGE = Math.max(900, Math.floor(CHARS_PER_PAGE_BASE * scale));

      // פיצול לפי "תווים לעמוד" – משתדלים לא לשבור באמצע תגיות/מילה
      pages = splitToPages(hydrated, CHARS_PER_PAGE);

      // 5) רנדר
      renderPages();
      goTo(0, /*noAnim*/true);
      bindNav();
      bindSwipe();
      window.addEventListener('resize', onResize);
    } catch (err) {
      console.error(err);
      track.innerHTML = '<div class="page"><div class="page-inner">Error loading text.</div></div>';
      pages = ['<p>Error loading text.</p>'];
      updatePager();
      disableButtons();
    }
  })();

  // ===== Split text to pages by character count =====
  function splitToPages(html, maxChars) {
    const out = [];
    let buf = '';
    let len = 0;

    // כדי לא לשבור תגיות IMG/HR, נחליף אותן בעוגנים רגעית
    const tokens = [];
    let tokenized = html
      .replace(/<img[^>]*>/g, m => { tokens.push(m); return IMG_BLOCK; })
      .replace(/<hr class="separator">/g, m => { tokens.push(m); return IMG_BLOCK; });

    const parts = tokenized.split(IMG_BLOCK); // שומרים בלוקים נפרדים (טקסט/תמונה/קו)
    for (let i = 0; i < parts.length; i++) {
      const textChunk = parts[i];
      if (textChunk) {
        const paragraphs = textChunk.split(/(\r?\n\r?\n+)/);
        for (const piece of paragraphs) {
          if (piece === undefined) continue;
          // אם זה רווח/שבירת פסקה — נספור גם אותו
          if (len + piece.length > maxChars && len > 0) {
            out.push(buf);
            buf = '';
            len = 0;
          }
          buf += piece;
          len += piece.length;
        }
      }
      // אחרי כל חלק טקסט, אם יש טוקן (תמונה/קו) – נטמיע אותו "שלם"
      if (i < parts.length - 1) {
        const token = tokens.shift();
        const tokenSize = 80; // הערכת משקל עבור עימוד
        if (len + tokenSize > maxChars && len > 0) {
          out.push(buf);
          buf = '';
          len = 0;
        }
        buf += token;
        len += tokenSize;
      }
    }
    if (buf.trim().length) out.push(buf);

    // מנקים רווחים מיותרים בקצוות
    return out.map(s => s.trim());
  }

  // ===== Render =====
  function renderPages() {
    track.innerHTML = '';
    const w = stage.clientWidth; // רוחב עמוד זמין
    pageWidth = w;

    pages.forEach(html => {
      const page = document.createElement('div');
      page.className = 'page';
      page.style.width = `${w}px`;

      const inner = document.createElement('div');
      inner.className = 'page-inner';
      inner.innerHTML = html;

      page.appendChild(inner);
      track.appendChild(page);
    });

    // עדכון רוחב הפס של ה-track
    track.style.width = `${pageWidth * pages.length}px`;
  }

  function onResize() {
    const old = pageWidth;
    renderPages();
    // שמירה על מיקום נוכחי גם אחרי שינוי רוחב
    if (old) goTo(current, true);
  }

  // ===== Nav / Pager =====
  function updatePager() {
    pagerEl.textContent = `${current + 1}/${pages.length}`;
  }
  function disableButtons() {
    prevBtn.disabled = (current <= 0);
    nextBtn.disabled = (current >= pages.length - 1);
  }

  function goTo(idx, noAnim = false) {
    current = Math.max(0, Math.min(idx, pages.length - 1));
    const x = -current * pageWidth;
    track.style.transition = noAnim ? 'none' : 'transform 320ms cubic-bezier(.22,.61,.36,1)';
    track.style.transform  = `translate3d(${x}px,0,0)`;
    // טריק קטן לאפשר אנימציה מייד אחר כך
    if (noAnim) requestAnimationFrame(() => (track.style.transition = 'transform 320ms cubic-bezier(.22,.61,.36,1)'));
    updatePager();
    disableButtons();
  }

  function bindNav() {
    prevBtn.addEventListener('click', () => goTo(current - 1));
    nextBtn.addEventListener('click', () => goTo(current + 1));
    // חיצים במקלדת (אם על דסקטופ)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft')  goTo(current + 1);
      if (e.key === 'ArrowRight') goTo(current - 1);
    });
  }

  // ===== Touch swipe =====
  function bindSwipe() {
    let startX = 0;
    let deltaX = 0;
    let dragging = false;

    stage.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches.length) return;
      dragging = true;
      startX = e.touches[0].clientX;
      deltaX = 0;
      track.style.transition = 'none';
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      deltaX = e.touches[0].clientX - startX;
      const base = -current * pageWidth;
      track.style.transform = `translate3d(${base + deltaX}px,0,0)`;
    }, { passive: true });

    stage.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      const threshold = Math.min(120, pageWidth * 0.18);
      if (deltaX < -threshold && current < pages.length - 1) {
        goTo(current + 1);
      } else if (deltaX > threshold && current > 0) {
        goTo(current - 1);
      } else {
        goTo(current); // חזרה למקום
      }
    });
  }
})();