(async function init(){
  const mount = document.getElementById('books');
  try{
    const res = await fetch('books/books.json');
    if(!res.ok) throw new Error('Missing books.json');
    const books = await res.json();

    mount.innerHTML = '';
    books.forEach(b => mount.appendChild(card(b)));
  }catch(e){
    console.error(e);
    mount.innerHTML = '<div class="pill">שגיאה בטעינת רשימת הספרים</div>';
  }
})();

function card(b){
  const aThumb = el('a','book-thumb');
  aThumb.href = `reader.html?book=${encodeURIComponent(b.slug)}`;
  const img = new Image();
  img.alt = b.title || b.slug;
  img.loading = 'lazy';
  img.src = b.cover || `books/${b.slug}/images/image-1.jpg`;
  aThumb.appendChild(img);

  const open = el('a','book-open');
  open.href = `reader.html?book=${encodeURIComponent(b.slug)}`;
  open.textContent = 'פתח';

  const info = el('div','book-info');
  info.append(
    h('h2','book-title', b.title || b.slug),
    h('div','book-sub', b.subtitle || ''),
    h('p','book-desc', b.description || ''),
    open
  );

  const card = el('article','book-card');
  card.append(info, aThumb); // תמונה מימין, טקסט משמאל (RTL)
  return card;
}

function el(t,c){ const d=document.createElement(t); if(c) d.className=c; return d; }
function h(t,c,txt){ const d=el(t,c); d.textContent=txt; return d; }