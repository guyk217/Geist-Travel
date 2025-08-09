// טוען books/books.json ומציג “כרטיס” לכל ספר: תמונה מימין, טקסט משמאל.
(async function init(){
  const mount = document.getElementById('books');
  try{
    const res = await fetch('books/books.json');
    if(!res.ok) throw new Error('books.json not found');
    const books = await res.json();

    mount.innerHTML = '';
    books.forEach(b => mount.appendChild(renderBook(b)));
  }catch(err){
    console.error(err);
    document.getElementById('books').innerHTML =
      '<div class="pill">בעיה בטעינת רשימת הספרים</div>';
  }
})();

function renderBook(book){
  const card = el('article','book-card');

  // תמונה מימין (קטנה)
  const imgWrap = el('a','book-thumb');
  imgWrap.href = `reader.html?book=${encodeURIComponent(book.slug)}`;
  const img = new Image();
  img.loading = 'lazy';
  img.alt = book.title || book.slug;
  img.src = book.cover || `books/${book.slug}/images/image-1.jpg`;
  imgWrap.appendChild(img);

  // טקסט משמאל
  const info = el('div','book-info');
  const h2 = el('h2','book-title'); h2.textContent = book.title || book.slug;
  const sub = el('div','book-sub'); sub.textContent = book.subtitle || '';
  const desc = el('p','book-desc'); desc.textContent = book.description || '';
  const open = el('a','book-open'); open.textContent = 'פתח';
  open.href = `reader.html?book=${encodeURIComponent(book.slug)}`;

  info.append(h2, sub, desc, open);
  // סדר “תמונה מימין, טקסט משמאל” (row-reverse ב־CSS)
  card.append(info, imgWrap);
  return card;
}

function el(t,c){ const d=document.createElement(t); if(c) d.className=c; return d; }