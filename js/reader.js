// Reader – stable pagination by block height, JPG-first images, ****** -> <hr>
// No runaway pages. Swipe + arrows. Safe cap at 200 pages.

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

const $ = s => document.querySelector(s);
const qs = k => {
  const v = new URLSearchParams(location.search).get(k);
  return v ? decodeURIComponent(v) : null;
};

function showLoading(show) {
  let el = $('#loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading';
    el.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:5;' +
      'background:radial-gradient(ellipse at top,rgba(255,255,255,.6),transparent 60%),#f7f1e3;';
    el.innerHTML =
      '<div style="text-align:center;font-family:system-ui,Arial;color:#3b342b">' +
      '<div style="width:44px;height:44px;border-radius:50%;border:4px solid #cdbda3;border-top-color:#6a5a45;animation:spin 1s linear infinite;margin:0 auto 10px"></div>' +
      '<div>טוען את הספר…</div></div>';
    const kf = document.createElement('style');
    kf.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(kf);
    document.body.appendChild(el);
  }
  el.style.display = show ? 'flex' : 'none';
}

function setCounter(i, total) {
  $('#counter').textContent = `${i + 1}/${Math.max(1, total)}`;
  $('#prev').disabled = i <= 0;
  $('#next').disabled = i >= total - 1;
}

async function fetchText(url) {
  const r = await fetch(url + `?v=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

async function probeImage(base) {
  for (const ext of IMG_EXT) {
    const url = `${base}${ext}`;
    const ok = await new Promise(res => {
      const im = new Image();
      im.onload = () => res(true);
      im.onerror = () => res(false);
      im.decoding = 'async';
      im.loading = 'lazy';
      im.src = url;
    });
    if (ok) return url;
  }
  return null;
}

async function hydrateImages(text, dir) {
  const jobs = [];
  const withPh = text.replace(/\{image-(\d+)\}/g, (m, n) => {
    const token = `@@IMG_${n}@@`;
    jobs.push(
      (async () => {
        const src = await probeImage(`${dir}/image-${n}`);
        const html = src
          ? `<img src="${src}" alt="image-${n}" decoding="async" loading="lazy" draggable="false">`
          : `<div class="pill">Missing image ${n}</div>`;
        return { token, html };
      })()
    );
    return token;
  });
  const done = await Promise.all(jobs);
  let out = withPh;
  for (const { token, html } of done) out = out.replaceAll(token, html);
  return out;
}

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toBlocks(raw) {
  // הפוך טקסט לבלוקים: IMG/HR/פסקה
  // שומר <img> שכבר הוחדרו
  const parts = raw
    .split(/(<img[^>]*>)/i)
    .filter(Boolean)
    .map(p => (/^<img/i.test(p) ? { t: 'img', html: p } : { t: 'txt', s: p }));

  const blocks = [];
  for (const part of parts) {
    if (part.t === 'img') {
      blocks.push({ t: 'html', html: part.html });
      continue;
    }
    const lines = part.s.split(/\r?\n/);
    let para = [];
    for (const ln of lines) {
      if (/^\*{6,}\s*$/.test(ln)) {
        if (para.length) {
          blocks.push({ t: 'text', html: `<p>${escapeHTML(para.join(' '))}</p>` });
          para = [];
        }
        blocks.push({ t: 'html', html: '<hr class="separator">' });
      } else if (/^\s*$/.test(ln)) {
        if (para.length) {
          blocks.push({ t: 'text', html: `<p>${escapeHTML(para.join(' '))}</p>` });
          para = [];
        }
      } else {
        para.push(ln.trim());
      }
    }
    if (para.length) blocks.push({ t: 'text', html: `<p>${escapeHTML(para.join(' '))}</p>` });
  }
  return blocks;
}

function elPage(html = '') {
  const p = document.createElement('div'); p.className = 'page';
  const card = document.createElement('div'); card.className = 'page-card';
  const inner = document.createElement('div'); inner.className = 'page-inner';
  inner.innerHTML = html;
  card.appendChild(inner); p.appendChild(card);
  return { p, inner };
}

function paginate(blocks) {
  const track = $('#track');
  // measurer
  const meas = elPage('');
  meas.p.style.visibility = 'hidden';
  meas.p.style.position = 'absolute';
  meas.p.style.inset = '0';
  track.appendChild(meas.p);

  const lineH = parseFloat(getComputedStyle(meas.inner).lineHeight) || 28;
  const stage = $('#stage');
  const usableH = Math.max(220, stage.clientHeight - 20);
  const MAX_LINES = 17;                          // ~17 שורות לעמוד
  const MAX_H = Math.min(usableH, Math.round(lineH * MAX_LINES));

  const pages = [];
  let curHTML = '';

  const fits = html => {
    meas.inner.innerHTML = html || '';
    return meas.inner.scrollHeight <= MAX_H + 1;
  };

  const pushPage = () => {
    pages.push(curHTML || '<br>');
    curHTML = '';
  };

  const cap = 200; // הגנת חירום
  for (const b of blocks) {
    if (pages.length >= cap) break;

    if (b.t === 'html') {
      // תמונה/HR – דף נפרד
      if (curHTML.trim()) pushPage();
      curHTML = b.html;
      pushPage();
      continue;
    }

    // טקסט (פסקה) – נסה להוסיף כיחידה
    const tryAll = curHTML + b.html;
    if (fits(tryAll)) { curHTML = tryAll; continue; }

    // לא נכנס: חיפוש בינארי על מילות הפסקה
    const textOnly = b.html.replace(/^<p>|<\/p>$/g, '');
    const words = textOnly.split(/\s+/);
    let lo = 0, hi = words.length, best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = curHTML + `<p>${escapeHTML(words.slice(0, mid).join(' '))}</p>`;
      if (fits(candidate)) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best > 0) {
      curHTML += `<p>${escapeHTML(words.slice(0, best).join(' '))}</p>`;
      pushPage();
      // השארית לפסקה חדשה
      const rest = words.slice(best).join(' ');
      if (rest.trim()) {
        if (fits(`<p>${escapeHTML(rest)}</p>`)) curHTML = `<p>${escapeHTML(rest)}</p>`;
        else {
          // אם גם היא גדולה – שבר אותה לעמודים נוספים בלולאה
          let idx = best;
          while (idx < words.length && pages.length < cap) {
            let lo2 = idx + 1, hi2 = words.length, best2 = idx + 1;
            while (lo2 <= hi2) {
              const mid2 = Math.floor((lo2 + hi2) / 2);
              const cand = `<p>${escapeHTML(words.slice(idx, mid2).join(' '))}</p>`;
              if (fits(cand)) { best2 = mid2; lo2 = mid2 + 1; } else hi2 = mid2 - 1;
            }
            pages.push(`<p>${escapeHTML(words.slice(idx, best2).join(' '))}</p>`);
            idx = best2;
          }
          curHTML = '';
        }
      } else {
        curHTML = '';
      }
    } else {
      // אפילו מילה אחת לא נכנסת יחד עם התוכן הקיים
      if (curHTML.trim()) pushPage();
      // נסה את כל הפסקה בעמוד חדש
      if (fits(b.html)) { curHTML = b.html; }
      else {
        // פסקה ענקית – חתוך ישר לעמודים בלולאה בינארית
        const words2 = words;
        let i = 0;
        while (i < words2.length && pages.length < cap) {
          let lo3 = i + 1, hi3 = words2.length, best3 = i + 1;
          while (lo3 <= hi3) {
            const mid3 = Math.floor((lo3 + hi3) / 2);
            const cand = `<p>${escapeHTML(words2.slice(i, mid3).join(' '))}</p>`;
            if (fits(cand)) { best3 = mid3; lo3 = mid3 + 1; } else hi3 = mid3 - 1;
          }
          pages.push(`<p>${escapeHTML(words2.slice(i, best3).join(' '))}</p>`);
          i = best3;
        }
        curHTML = '';
      }
    }
  }
  if (curHTML.trim()) pushPage();

  // בנה DOM
  $('#track').innerHTML = '';
  for (const h of pages) {
    const { p, inner } = elPage(h);
    inner.style.overflow = 'hidden';
    $('#track').appendChild(p);
  }
  return Math.max(1, pages.length);
}

function enableSwipe(onLeft, onRight) {
  const el = $('#stage');
  let x0 = null, y0 = null, t0 = 0;
  const minDx = 40, maxDy = 60, maxT = 600;
  el.addEventListener('touchstart', e => {
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0), dt = Date.now() - t0;
    x0 = null;
    if (dy < maxDy && dt < maxT && Math.abs(dx) > minDx) dx < 0 ? onRight() : onLeft();
  }, { passive: true });
}

(async function init(){
  showLoading(true);
  const slug = qs('book');
  if (!slug) { $('#track').innerHTML = '<div class="page"><div class="page-card"><div class="page-inner">Missing ?book=</div></div></div>'; showLoading(false); return; }

  const txtURL = `books/${slug}/book.txt`;
  const imgDir = `books/${slug}/images`;

  try{
    let raw = await fetchText(txtURL);
    raw = await hydrateImages(raw, imgDir);

    // Place/Date (אופציונלי)
    let place = null, date = null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_, __, v) => { place = v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_, __, v) => { date  = v.trim(); return ''; });

    let html = '';
    const pills = [];
    if (date)  pills.push(`<span class="pill">Date: ${date}</span>`);
    if (place) pills.push(`<span class="pill">Place: ${place}</span>`);
    if (pills.length) html += `<div class="meta-pills">${pills.join(' ')}</div>`;

    html += raw; // יומר לבלוקים בהמשך
    const blocks = toBlocks(html);

    let total = paginate(blocks);
    let index = 0;

    const go = i => {
      index = Math.max(0, Math.min(total - 1, i));
      const w = $('#stage').clientWidth;
      const tr = $('#track');
      tr.style.transition = 'transform 260ms ease';
      tr.style.transform  = `translate3d(${-index * w}px,0,0)`;
      setCounter(index, total);
    };

    $('#prev').onclick = () => go(index - 1);
    $('#next').onclick = () => go(index + 1);
    enableSwipe(() => go(index - 1), () => go(index + 1));

    // ריסייז – עימוד מחדש, שמירה על העמוד
    let resizeTO = null;
    addEventListener('resize', () => {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(() => {
        const keep = index;
        total = paginate(blocks);
        go(Math.min(keep, total - 1));
      }, 120);
    });

    go(0);
    showLoading(false);
  }catch(err){
    console.error(err);
    showLoading(false);
    $('#track').innerHTML = `<div class="page"><div class="page-card"><div class="page-inner">Failed to load book.<br>${String(err)}</div></div></div>`;
  }
})();