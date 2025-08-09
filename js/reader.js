// Reader – loads books/<slug>/book.txt , injects images, draws separators,
// paginates by actual viewport height, supports arrows + swipe.

const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function qs(name) {
  const m = new URLSearchParams(location.search).get(name);
  return m ? decodeURIComponent(m) : null;
}

function setCounter(i, total) {
  document.getElementById('counter').textContent = `${i + 1}/${total}`;
  document.getElementById('prev').disabled = (i === 0);
  document.getElementById('next').disabled = (i === total - 1);
}

async function fetchText(url) {
  const res = await fetch(url + `?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function probeImage(srcBase) {
  // try all extensions, resolve first that loads
  for (const ext of EXTENSIONS) {
    const src = `${srcBase}${ext}`;
    const ok = await new Promise(r => {
      const im = new Image();
      im.onload = () => r(true);
      im.onerror = () => r(false);
      im.src = src;
    });
    if (ok) return src;
  }
  return null;
}

async function hydrateImages(raw, imgDir) {
  const jobs = [];
  const withPh = raw.replace(/\{image-(\d+)\}/g, (m, num) => {
    const ph = `@@IMG_${num}@@`;
    jobs.push((async () => {
      const src = await probeImage(`${imgDir}/image-${num}`);
      const html = src
        ? `<img src="${src}" alt="image-${num}">`
        : `<div class="pill">Missing image ${num}</div>`;
      return { ph, html };
    })());
    return ph;
  });

  const resolved = await Promise.all(jobs);
  let out = withPh;
  for (const { ph, html } of resolved) out = out.replaceAll(ph, html);
  return out;
}

function toHTML(text) {
  // turn ****** lines to separators, keep paragraphs
  const lines = text.split(/\r?\n/);
  const html = lines.map(l => {
    if (/^\*{6,}\s*$/.test(l)) return '<hr class="separator">';
    if (/^\s*$/.test(l)) return '<br>';
    return l
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }).join('\n');
  return html;
}

/** paginate by height: measure text using an offscreen page that mimics layout */
function paginate(html) {
  const track = document.getElementById('track');
  track.innerHTML = '';

  // temp measurer that matches real layout
  const tempPage = document.createElement('div');
  tempPage.className = 'page';
  const card = document.createElement('div');
  card.className = 'page-card';
  const inner = document.createElement('div');
  inner.className = 'page-inner';
  card.appendChild(inner);
  tempPage.appendChild(card);
  tempPage.style.visibility = 'hidden';
  document.body.appendChild(tempPage);

  const maxH = card.clientHeight; // usable height for inner content

  // tokenization: don't split <img> or <hr>
  const tokens = [];
  html.split(/(<img[^>]+>|<hr class="separator">)/g).forEach(part => {
    if (!part) return;
    if (part.startsWith('<img') || part.startsWith('<hr')) tokens.push({ type: 'html', html: part });
    else tokens.push({ type: 'text', text: part });
  });

  const pages = [];
  let curHTML = '';

  const measure = (h) => {
    inner.innerHTML = h;
    return inner.scrollHeight;
  };

  const flush = () => {
    if (curHTML.trim()) {
      pages.push(curHTML);
      curHTML = '';
    }
  };

  for (const tk of tokens) {
    if (tk.type === 'html') {
      const tryHTML = curHTML + tk.html;
      if (measure(tryHTML) <= maxH) {
        curHTML = tryHTML;
      } else {
        flush();
        if (measure(tk.html) > maxH) {
          // oversize block (very tall image) – place alone
          pages.push(tk.html);
        } else {
          curHTML = tk.html;
        }
      }
    } else {
      // text: add piece by piece while it fits
      const chunks = tk.text.split(/(\s+)/); // keep spaces
      for (let i = 0; i < chunks.length; i++) {
        const next = curHTML + chunks[i];
        if (measure(next) <= maxH) {
          curHTML = next;
        } else {
          flush();
          curHTML = chunks[i].trimStart();
          if (measure(curHTML) > maxH) {
            // pathological very long token – hard cut
            let cut = chunks[i];
            while (cut && measure(cut) > maxH) {
              cut = cut.slice(0, Math.max(1, Math.floor(cut.length * 0.9)));
            }
            if (cut) pages.push(cut);
            curHTML = chunks[i].slice(cut.length);
          }
        }
      }
    }
  }
  flush();

  // build DOM
  pages.forEach(h => {
    const p = document.createElement('div');
    p.className = 'page';
    const c = document.createElement('div');
    c.className = 'page-card';
    const inner = document.createElement('div');
    inner.className = 'page-inner';
    inner.innerHTML = h;
    c.appendChild(inner);
    p.appendChild(c);
    track.appendChild(p);
  });

  tempPage.remove();
  return pages.length;
}

function enableSwipe(cbLeft, cbRight) {
  let x0 = null, y0 = null, t0 = 0;
  const minDx = 40, maxDy = 60, maxT = 600;
  const el = document.getElementById('stage');
  el.addEventListener('touchstart', e => {
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = Math.abs(t.clientY - y0);
    const dt = Date.now() - t0;
    x0 = null;
    if (dy < maxDy && dt < maxT && Math.abs(dx) > minDx) {
      if (dx < 0) cbRight(); else cbLeft();
    }
  }, { passive: true });
}

(async function main() {
  const slug = qs('book');
  const track = document.getElementById('track');

  if (!slug) {
    track.innerHTML = `<div class="error">Missing ?book= slug</div>`;
    return;
  }

  const txtURL = `books/${slug}/book.txt`;
  const imgDir = `books/${slug}/images`;

  try {
    let raw = await fetchText(txtURL);
    if (!raw || !raw.trim()) {
      track.innerHTML = `<div class="error">Empty book.txt</div>`;
      return;
    }

    // Replace {image-N} and turn ****** to <hr>
    raw = await hydrateImages(raw, imgDir);

    // Extract leading Place/Date (optional – shown as pills on first page)
    let place = null, date = null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_, p, v) => { place = v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_, p, v) => { date  = v.trim(); return ''; });

    let html = toHTML(raw);

    // Insert pills at very top (first page)
    const pills = [];
    if (date)  pills.push(`<span class="pill">Date: ${date}</span>`);
    if (place) pills.push(`<span class="pill">Place: ${place}</span>`);
    if (pills.length) html = `<div class="meta-pills">${pills.join(' ')}</div>` + html;

    // Paginate & render
    let total = paginate(html);
    let index = 0;
    setCounter(index, total);

    const trackEl = document.getElementById('track');
    function go(i) {
      index = Math.max(0, Math.min(total - 1, i));
      const x = -index * trackEl.clientWidth;
      trackEl.style.transition = 'transform 260ms ease';
      trackEl.style.transform = `translate3d(${x}px,0,0)`;
      setCounter(index, total);
    }

    document.getElementById('prev').onclick = () => go(index - 1);
    document.getElementById('next').onclick = () => go(index + 1);
    enableSwipe(() => go(index - 1), () => go(index + 1));

    // Reflow on resize/rotation
    addEventListener('resize', () => {
      const cur = index;
      total = paginate(html);
      go(Math.min(cur, total - 1));
    });

  } catch (err) {
    track.innerHTML = `<div class="error">Failed to load book.txt (${txtURL}).<br>${String(err)}</div>`;
    console.error(err);
  }
})();