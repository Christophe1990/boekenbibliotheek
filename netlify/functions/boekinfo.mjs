export default async (request) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const url = new URL(request.url);
  const isbn = (url.searchParams.get('isbn') || '').replace(/[\s\-]/g, '');
  const titel = url.searchParams.get('titel') || '';
  const auteur = url.searchParams.get('auteur') || '';

  if (!isbn && !titel) {
    return new Response(JSON.stringify({ error: 'isbn of titel vereist' }), { status: 400, headers });
  }

  const API_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';
  const keyParam = API_KEY ? `&key=${API_KEY}` : '';
  const result = {};

  // ── Bron 1: Google Books ──────────────────────────────────────
  try {
    const q = isbn ? `isbn:${isbn}` : encodeURIComponent(`intitle:${titel} inauthor:${auteur}`);
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&country=BE&maxResults=5${keyParam}`, {
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    if (d.items?.length) {
      const item = isbn
        ? (d.items.find(it => it.volumeInfo?.industryIdentifiers?.some(id => id.identifier === isbn)) || d.items[0])
        : d.items[0];
      const vi = item?.volumeInfo;
      if (vi) {
        if (vi.title)              result.title       = vi.title;
        if (vi.authors?.length)    result.author      = vi.authors.join(', ');
        if (vi.publishedDate)      result.year        = vi.publishedDate.substring(0, 4);
        if (vi.pageCount)          result.pages       = vi.pageCount;
        if (vi.language)           result.language    = vi.language;
        if (vi.publisher)          result.publisher   = vi.publisher;
        if (vi.categories?.length) result.subjects    = vi.categories.slice(0, 5).join(', ');
        if (vi.description)        result.description = vi.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (item?.id)              result.coverUrl    = `https://books.google.com/books/content?id=${item.id}&printsec=frontcover&img=1&zoom=0&source=gbs_api`;
        result.source = 'Google Books';
      }
    }
  } catch (e) {}

  // ── Bron 2: Open Library ─────────────────────────────────────
  if (isbn) {
    try {
      const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      const ol = d[`ISBN:${isbn}`];
      if (ol) {
        if (!result.title  && ol.title)           result.title  = ol.title;
        if (!result.author && ol.authors?.length) result.author = ol.authors.map(a => a.name).join(', ');
        if (!result.year   && ol.publish_date)    result.year   = ol.publish_date.replace(/\D.*$/, '');
        if (!result.pages  && ol.number_of_pages) result.pages  = ol.number_of_pages;
        if (!result.publisher && ol.publishers?.length) result.publisher = ol.publishers.map(p => p.name).join(', ');
        if (!result.description && ol.description) result.description = typeof ol.description === 'string' ? ol.description : ol.description?.value || '';
        if (!result.coverUrl && ol.cover?.large)  result.coverUrl = ol.cover.large;
        else if (!result.coverUrl && ol.cover?.medium) result.coverUrl = ol.cover.medium;
        if (!result.source && result.title) result.source = 'Open Library';
      }
    } catch (e) {}

    // ── Bron 3: KB Nationale Bibliotheek ─────────────────────
    try {
      const r = await fetch(`https://jsru.kb.nl/sru/sru?operation=searchRetrieve&version=1.2&x-collection=GGC&maximumRecords=1&recordSchema=dcx&query=isbn+%3D+${isbn}`, { signal: AbortSignal.timeout(8000) });
      const xml = await r.text();
      const getTag = (tag) => { for (const ns of ['dc:', 'dcterms:']) { const m = xml.match(new RegExp(`<${ns}${tag}[^>]*>([\\s\\S]*?)<\\/${ns}${tag}>`, 'i')); if (m?.[1]?.trim()) return m[1].trim(); } return ''; };
      const getAllTag = (tag) => [...xml.matchAll(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, 'gi'))].map(m => m[1].trim()).filter(Boolean);
      const kbTitle = getTag('title');
      if (kbTitle) {
        if (!result.title)       result.title     = kbTitle;
        if (!result.author)      result.author    = getAllTag('creator').join(', ');
        if (!result.year)        { const d = getTag('date'); if (d) result.year = d.substring(0, 4); }
        if (!result.publisher)   result.publisher = getTag('publisher');
        if (!result.description) result.description = getTag('description');
        if (!result.source)      result.source    = 'KB Nationale Bibliotheek';
        const fmt = getTag('format'); const pm = fmt.match(/(\d+)\s*p(ag|\.)/i);
        if (!result.pages && pm) result.pages = parseInt(pm[1]);
        const subjects = getAllTag('subject');
        if (!result.subjects && subjects.length) result.subjects = subjects.slice(0, 5).join(', ');
      }
    } catch (e) {}

    // ── Bron 4: Vlaamse Bibliotheekscatalogus ────────────────
    try {
      const r = await fetch(`https://data.bibliotheken.nl/doc/isbn/${isbn}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const d = await r.json();
        const graph = d['@graph'] || [];
        for (const node of graph) {
          if (!result.title && node['schema:name']) result.title = Array.isArray(node['schema:name']) ? node['schema:name'][0] : node['schema:name'];
          if (!result.description && node['schema:description']) result.description = Array.isArray(node['schema:description']) ? node['schema:description'][0] : node['schema:description'];
          if (!result.author && node['schema:author']) {
            const a = Array.isArray(node['schema:author']) ? node['schema:author'][0] : node['schema:author'];
            result.author = a?.['schema:name'] || '';
          }
        }
        if (!result.source && result.title) result.source = 'Bibliotheken.nl';
      }
    } catch(e) {}

    // ── Bron 5: WorldCat via Open Library Search ─────────────
    if (!result.description) {
      try {
        const r = await fetch(`https://openlibrary.org/search.json?isbn=${isbn}&fields=title,author_name,first_publish_year,number_of_pages_median,cover_i,publisher&limit=1`, { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        const doc = d.docs?.[0];
        if (doc) {
          if (!result.title  && doc.title)              result.title  = doc.title;
          if (!result.author && doc.author_name?.[0])   result.author = doc.author_name.join(', ');
          if (!result.year   && doc.first_publish_year) result.year   = String(doc.first_publish_year);
          if (!result.pages  && doc.number_of_pages_median) result.pages = doc.number_of_pages_median;
          if (!result.coverUrl && doc.cover_i) result.coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
          if (!result.source) result.source = 'Open Library';
        }
      } catch (e) {}
    }
  }

  // ── Cover fallback ────────────────────────────────────────────
  if (!result.coverUrl && isbn) {
    result.coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  }

  if (!result.title && !result.author) {
    return new Response(JSON.stringify({ error: 'Boek niet gevonden', isbn, titel }), { status: 404, headers });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...headers, 'Cache-Control': 'public, max-age=86400' }
  });
};

export const config = { path: '/api/boekinfo' };
