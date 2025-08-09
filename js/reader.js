const qs = (s, el = document) => el.querySelector(s);
const track = qs('#track');
const pager = qs('#pager');
const prevBtn = qs('#prevBtn');
const nextBtn = qs('#nextBtn');
const stage = qs('#stage');

const url = new URL(location.href);
const slug = url.searchParams.get('slug') || 'europe-roots-1993';
const TXT_URL = `books/${slug}/book.txt`;
const IMG_DIR = `books/${slug}/images/`;
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

let pages = [];
let idx = 0;
let PAGE_W = 0;
let startX = 0, curX = 0, dragging = false;

const LINES_PER_PAGE = 20; // כמות שורות קבועה לעמוד

function setDisabled(btn, val) { btn.disabled = !!val; }

async function headExists(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; }
  catch { return false; }
}

async function resolveImageTag(num) {
  const base = IMG_DIR + `image-${num}`;
  for (const ext of IMG_EXTS) {
    const u = base + ext;
    if (await headExists(u)) return `<img src="${u}" alt="image-${num}">`;
  }
  return `<div class="pill">Missing image-${num}</div>`;
}

async function loadBook() {
  let raw;
  try {
    const res = await fetch(TXT_URL);
    if (!res.ok) throw new Error(`book.txt not found at ${TXT_URL}`);
    raw = await res.text();
  } catch (err) {
    showSingle(`Error loading book: ${err.message}`);
    return;
  }

  // {image-N} -> IMG
  const tasks = [];
  raw = raw.replace(/\{image-(\d+)\}/g, (m, num) => {
    const ph = `@@IMG_${num}@@`;
    tasks.push((async () => ({ ph, html: await resolveImageTag(num) }))());
    return ph;
  });
  const repl = await Promise.all(tasks);
  for (const r of repl) raw = raw.replaceAll(r.ph, r.html);

  // כוכביות => קו מפריד
  raw = raw.replace(/\r?\n\s*\*{2,}\s*\r?\n/g, '\n<hr class="separator">\n');

  // חלוקה לפי כמות שורות
  const lines = raw.split(/\r?\n/);
  let currentPage = [];
  pages = [];
  for (let i = 0; i < lines.length; i++) {
    currentPage.push(lines[i]);
    if (currentPage.length >= LINES_PER_PAGE) {
      pages.push(currentPage.join('\n'));
      currentPage = [];
    }
  }
  if (currentPage.length > 0) pages.push(currentPage.join('\n'));

  if (!pages.length) pages = [raw.trim()];

  buildSlides();
  layout();
  go(0, true);
}

function showSingle(html) {
  track.innerHTML = `<div class="page"><div class="page-inner"><div class="content">${html}</div></div></div>`;
  pages = [html];
  idx = 0;
  layout();
  go(0, true);
}

function buildSlides() {
  track.innerHTML = '';
  pages.forEach(part => {
    const page = document.createElement('div');
    page.className = 'page';
    page.innerHTML = `
      <article class="page-inner">
        <div class="content">${part}</div>
      </article>
    `;
    track.appendChild(page);
  });
}

function layout() {
  PAGE_W = Math.floor(stage.clientWidth);
  [...track.children].forEach(p => { p.style.width = PAGE_W + 'px'; });
  track.style.width = (PAGE_W * pages.length) + 'px';
  snap(true);
  updateUI();
}

function snap(instant = false) {
  track.style.transition = instant ? 'none' : 'transform .35s ease';
  track.style.transform = `translateX(${-idx * PAGE_W}px)`;
  if (instant) requestAnimationFrame(() => { track.style.transition = 'transform .35s ease'; });
}

function go(i, instant = false) {
  idx = Math.max(0, Math.min(pages.length - 1, i));
  snap(instant);
  updateUI();
}

function updateUI() {
  pager.textContent = `${idx + 1}/${pages.length}`;
  setDisabled(prevBtn, idx === 0);
  setDisabled(nextBtn, idx === pages.length - 1);
}

// --- SWIPE ---
function onDown(e) {
  dragging = true;
  startX = (e.touches ? e.touches[0].clientX : e.clientX);
  curX = startX;
  track.style.transition = 'none';
}
function onMove(e) {
  if (!dragging) return;
  curX = (e.touches ? e.touches[0].clientX : e.clientX);
  const dx = curX - startX;
  track.style.transform = `translateX(${(-idx * PAGE_W) + dx}px)`;
}
function onUp() {
  if (!dragging) return;
  dragging = false;
  const dx = curX - startX;
  const TH = Math.min(140, PAGE_W * 0.18);
  if (dx < -TH) go(idx + 1);
  else if (dx > TH) go(idx - 1);
  else snap();
}

stage.addEventListener('touchstart', onDown, { passive: true });
stage.addEventListener('touchmove', onMove, { passive: true });
stage.addEventListener('touchend', onUp);
stage.addEventListener('mousedown', onDown);
window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);
window.addEventListener('resize', () => layout());

prevBtn.addEventListener('click', () => go(idx - 1));
nextBtn.addEventListener('click', () => go(idx + 1));

loadBook();