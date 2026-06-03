// Netlify Function: /netlify/functions/boekinfo
// Zoekt boekinfo op via ISBN — draait op de server, dus geen CORS-problemen

export default async (request) => {
  const url = new URL(request.url);
  const isbn = url.searchParams.get('isbn')?.replace(/[\s\-]/g, '');
  const titel = url.searchParams.get('titel') || '';
  const auteur = url.searchParams.get('auteur') || '';

  if (!isbn && !titel) {
    return new Response(JSON.stringify({ error: 'isbn of titel vereist' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const result = {};

  // ── Google Books ──────────────────────────────────────────────
  try {
    const q = isbn ? `isbn:${isbn}` : encodeURIComponent(`${titel} ${auteur}`);
    const gbRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&country=BE&maxResults=3`);
    const gb = await gbRes.json();
    const item = isbn
      ? gb.items?.find(it => it.volumeInfo?.industryIdentifiers?.some(id => id.identifier === isbn))
      : gb.items?.[0];
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
  } catch (e) {}

  // ── Open Library Data API ─────────────────────────────────────
  if (isbn) {
    try {
      const olRes = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const olData = await olRes.json();
      const ol = olData[`ISBN:${isbn}`];
      if (ol) {
        if (!result.title  && ol.title)             result.title    = ol.title;
        if (!result.author && ol.authors?.length)   result.author   = ol.authors.map(a => a.name).join(', ');
        if (!result.year   && ol.publish_date)      result.year     = ol.publish_date.replace(/\D.*$/, '');
        if (!result.pages  && ol.number_of_pages)   result.pages    = ol.number_of_pages;
        if (!result.publisher && ol.publishers?.length) result.publisher = ol.publishers.map(p => p.name).join(', ');
        if (!result.subjects  && ol.subjects?.length)   result.subjects  = ol.subjects.slice(0, 5).map(s => typeof s === 'string' ? s : s.name).join(', ');
        if (!result.description && ol.description) {
          result.description = typeof ol.description === 'string' ? ol.description : ol.description?.value || '';
        }
        if (ol.cover?.large)       result.coverUrl = ol.cover.large;
        else if (ol.cover?.medium) result.coverUrl = ol.cover.medium;
        if (!result.source && result.title) result.source = 'Open Library';
      }
    } catch (e) {}

    // Open Library ISBN + Works endpoint
    try {
      const isbnRes = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
      if (isbnRes.ok) {
        const olIsbn = await isbnRes.json();
        if (!result.title && olIsbn.title) result.title = olIsbn.title;
        const desc = typeof olIsbn.description === 'string' ? olIsbn.description : olIsbn.description?.value || '';
        if (!result.description && desc) result.description = desc;
        if (!result.coverUrl && olIsbn.covers?.[0]) result.coverUrl = `https://covers.openlibrary.org/b/id/${olIsbn.covers[0]}-L.jpg`;

        // Works — heeft soms uitgebreidere beschrijving
        if (!result.description && olIsbn.works?.[0]?.key) {
          const workRes = await fetch(`https://openlibrary.org${olIsbn.works[0].key}.json`);
          const work = await workRes.json();
          const wd = typeof work.description === 'string' ? work.description : work.description?.value || '';
          if (wd) result.description = wd;
        }
      }
    } catch (e) {}

    // ── KB Nationale Bibliotheek (SRU) ────────────────────────
    try {
      const kbRes = await fetch(`https://jsru.kb.nl/sru/sru?operation=searchRetrieve&version=1.2&x-collection=GGC&maximumRecords=1&recordSchema=dcx&query=isbn+%3D+${isbn}`);
      const kbXml = await kbRes.text();
      // Simpele XML-parsing zonder DOMParser (die werkt niet in Node)
      const getTag = (xml, tag) => {
        const ns = ['dc:', 'dcterms:'];
        for (const n of ns) {
          const m = xml.match(new RegExp(`<${n}${tag}[^>]*>([\\s\\S]*?)<\\/${n}${tag}>`, 'i'));
          if (m) return m[1].trim();
        }
        return '';
      };
      const getAllTag = (xml, tag) => {
        const ns = 'dc:';
        const matches = [...xml.matchAll(new RegExp(`<${ns}${tag}[^>]*>([\\s\\S]*?)<\\/${ns}${tag}>`, 'gi'))];
        return matches.map(m => m[1].trim()).filter(Boolean);
      };

      const kbTitle = getTag(kbXml, 'title');
      if (kbTitle) {
        if (!result.title)       result.title    = kbTitle;
        if (!result.author)      result.author   = getAllTag(kbXml, 'creator').join(', ');
        if (!result.year)        result.year     = getTag(kbXml, 'date').substring(0, 4);
        if (!result.publisher)   result.publisher = getTag(kbXml, 'publisher');
        if (!result.description) result.description = getTag(kbXml, 'description');
        if (!result.source)      result.source   = 'KB Nationale Bibliotheek';
        const fmt = getTag(kbXml, 'format');
        const pm = fmt.match(/(\d+)\s*p(ag|\.)/i);
        if (!result.pages && pm) result.pages = parseInt(pm[1]);
      }
    } catch (e) {}
  }

  // Cover fallback
  if (!result.coverUrl && isbn) {
    result.coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  }

  if (!result.title && !result.author) {
    return new Response(JSON.stringify({ error: 'Boek niet gevonden', isbn, titel }), {
      status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400' // 24u cache
    }
  });
};

export const config = { path: '/api/boekinfo' };
