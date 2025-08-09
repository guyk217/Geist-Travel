// Reader – חיתוך לפי 16 שורות “בול”, תמונות .jpg, בלי מדידות גובה ובלי לופים כבדים.

const LINES_PER_PAGE = 16;                      // כמה שורות לעמוד
const IMG_EXT = '.jpg';                         // לפי הבקשה – JPG בלבד
const qs = (k) => new URLSearchParams(location.search).get(k);

const $ = (s) => document.querySelector(s);
const setCounter = (i,total) => {
  $('#counter').textContent = `${i+1}/${Math.max(total,1)}`;
  $('#prev').disabled = (i<=0);
  $('#next').disabled = (i>=total-1);
};
const showLoading = (on) => { $('#loadingOverlay').style.display = on ? 'grid' : 'none'; };

async function fetchText(url){
  const r = await fetch(url + `?v=${Date.now()}`, {cache:'no-store'});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
function escapeHTML(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* --- טוקניזציה: הופך טקסט לטוקנים (שורה/ריק/מפריד/תמונה) --- */
function tokenize(raw, slug){
  // תמונות – מכניס סימון בשורה נפרדת, כדי שתמיד יהיו עמוד נפרד
  const expanded = raw.replace(/\{image-(\d+)\}/g, '\n[IMG:$1]\n');
  const lines = expanded.split(/\r?\n/);

  const tokens = []; // {type:'line'|'blank'|'hr'|'image', html/text}
  for (const line of lines){
    if (/^\[IMG:(\d+)\]$/.test(line)){
      const n = line.match(/^\[IMG:(\d+)\]$/)[1];
      const url = `books/${slug}/images/image-${n}${IMG_EXT}`;
      tokens.push({type:'image', html:
        `<figure style="margin:0">
           <img src="${url}" alt="image-${n}" />
         </figure>`
      });
    } else if (/^\*{6,}\s*$/.test(line)){
      tokens.push({type:'hr'});
    } else if (/^\s*$/.test(line)){
      tokens.push({type:'blank'});
    } else {
      tokens.push({type:'line', text: line});
    }
  }
  return tokens;
}

/* --- עימוד קשיח לפי שורות --- */
function paginate(tokens, metaHTML){
  const pages = [];
  let buf = [];
  let used = 0;

  const flush = () => { pages.push(buf.join('\n')); buf=[]; used=0; };

  if (metaHTML){
    buf.push(`<div class="meta-pills">${metaHTML}</div>`);
    used += 1; // נספר כשורה אחת
  }

  for (const tk of tokens){
    if (tk.type === 'image'){
      if (buf.length) flush();
      pages.push(tk.html);         // תמונה – עמוד משלה
      continue;
    }
    if (tk.type === 'hr'){
      buf.push('<hr class="separator">');
      used += 1;
      if (used >= LINES_PER_PAGE) flush();
      continue;
    }

    const html = (tk.type==='blank')
      ? '<div class="ln">&nbsp;</div>'
      : `<div class="ln">${escapeHTML(tk.text)}</div>`;

    buf.push(html);
    used += 1;

    if (used >= LINES_PER_PAGE) flush();
  }
  if (buf.length) flush();

  return pages.length ? pages : [''];
}

/* --- רינדור + ניווט --- */
function clearTrack(){ const t=$('#track'); while(t.firstChild) t.removeChild(t.firstChild); }
function buildPage(html){
  const p = document.createElement('div'); p.className='page';
  p.innerHTML = `<div class="page-card"><div class="page-inner">${html}</div></div>`;
  return p;
}
function renderPages(pages){
  const track = $('#track');
  clearTrack();
  pages.forEach(h => track.appendChild(buildPage(h)));
}

function enableNav(pages){
  let idx=0;
  const go = (i)=>{
    idx = Math.max(0, Math.min(pages.length-1, i));
    const x = -idx * $('#stage').clientWidth;
    const tr = $('#track');
    tr.style.transition = 'transform 260ms ease';
    tr.style.transform  = `translate3d(${x}px,0,0)`;
    setCounter(idx, pages.length);
  };

  $('#prev').onclick = ()=>go(idx-1);
  $('#next').onclick = ()=>go(idx+1);

  const stage = $('#stage');
  let x0=null, y0=null, t0=0;
  stage.addEventListener('touchstart', e=>{
    const t=e.touches[0]; x0=t.clientX; y0=t.clientY; t0=Date.now();
  },{passive:true});
  stage.addEventListener('touchend', e=>{
    if(x0==null) return;
    const t=e.changedTouches[0];
    const dx=t.clientX-x0, dy=Math.abs(t.clientY-y0), dt=Date.now()-t0;
    x0=null;
    if(dy<60 && dt<600 && Math.abs(dx)>40){ if(dx<0) go(idx+1); else go(idx-1); }
  },{passive:true});

  // התאמה לרוחב כשמסובבים / משנים גודל
  addEventListener('resize', ()=>go(idx));

  go(0);
}

/* --- MAIN --- */
(async function init(){
  try{
    showLoading(true);

    const slug = qs('book');
    if(!slug){ renderPages(['Missing ?book=']); setCounter(0,1); showLoading(false); return; }

    const txtURL = `books/${slug}/book.txt`;
    let raw = await fetchText(txtURL);

    // חילוץ Place/Date מראש הטקסט (אם קיימים)
    let place=null, date=null;
    raw = raw.replace(/^(Place:\s*)(.+)\s*\r?\n/i, (_,p,v)=>{ place=v.trim(); return ''; });
    raw = raw.replace(/^(Date:\s*)(.+)\s*\r?\n/i,  (_,p,v)=>{ date =v.trim(); return ''; });

    const pills = [
      date  ? `<span class="pill">Date: ${escapeHTML(date)}</span>` : '',
      place ? `<span class="pill">Place: ${escapeHTML(place)}</span>`: ''
    ].filter(Boolean).join(' ');

    const tokens = tokenize(raw, slug);
    const pages  = paginate(tokens, pills);

    renderPages(pages);
    enableNav(pages);
    showLoading(false);
  }catch(err){
    console.error(err);
    renderPages([`<div class="ln">בעיה בטעינה</div><div class="ln">${escapeHTML(String(err))}</div>`]);
    setCounter(0,1);
    showLoading(false);
  }
})();