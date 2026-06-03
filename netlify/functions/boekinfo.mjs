export default async (request) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const url = new URL(request.url);
  const isbn = (url.searchParams.get('isbn') || '').replace(/[\s\-]/g, '');
  
  const result = { isbn, tests: {} };

  // Test 1: Google Books
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`, {
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    result.tests.googleBooks = {
      status: r.status,
      totalItems: d.totalItems,
      hasItems: !!d.items?.length,
      firstTitle: d.items?.[0]?.volumeInfo?.title || null
    };
  } catch(e) {
    result.tests.googleBooks = { error: e.message };
  }

  // Test 2: Open Library
  try {
    const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, {
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    const key = `ISBN:${isbn}`;
    result.tests.openLibrary = {
      status: r.status,
      found: !!d[key],
      title: d[key]?.title || null
    };
  } catch(e) {
    result.tests.openLibrary = { error: e.message };
  }

  // Test 3: KB
  try {
    const r = await fetch(`https://jsru.kb.nl/sru/sru?operation=searchRetrieve&version=1.2&x-collection=GGC&maximumRecords=1&recordSchema=dcx&query=isbn+%3D+${isbn}`, {
      signal: AbortSignal.timeout(8000)
    });
    const text = await r.text();
    result.tests.kb = {
      status: r.status,
      hasTitle: text.includes('<dc:title>'),
      snippet: text.substring(0, 200)
    };
  } catch(e) {
    result.tests.kb = { error: e.message };
  }

  return new Response(JSON.stringify(result, null, 2), { status: 200, headers });
};

export const config = { path: '/api/boekinfo' };
