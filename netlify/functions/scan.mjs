// Netlify Function: /api/scan
// Leest tekst van een foto (achterkant boek) via Claude Vision API

export default async (request) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST vereist' }), { status: 405, headers });
  }

  const CLAUDE_KEY = process.env.CLAUDE_API_KEY || '';
  if (!CLAUDE_KEY) {
    return new Response(JSON.stringify({ error: 'CLAUDE_API_KEY niet ingesteld' }), { status: 500, headers });
  }

  try {
    const body = await request.json();
    const { image, mediaType = 'image/jpeg' } = body;

    if (!image) {
      return new Response(JSON.stringify({ error: 'image (base64) vereist' }), { status: 400, headers });
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image }
            },
            {
              type: 'text',
              text: 'Dit is de achterkant van een boek. Lees de korte inhoud/flaptekst die erop staat. Geef ENKEL de beschrijving/samenvatting terug in lopende tekst. Verwijder: prijs, ISBN-nummer, barcode, naam van uitgeverij, website-adressen, auteursbiografie, recensiequotes en andere niet-inhoudelijke tekst. Geef alleen de samenvatting van het verhaal of de inhoud van het boek. Antwoord in het Nederlands.'
            }
          ]
        }]
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: 'Claude API fout: ' + resp.status, detail: err }), { status: 502, headers });
    }

    const data = await resp.json();
    const tekst = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    if (!tekst || tekst.length < 20) {
      return new Response(JSON.stringify({ error: 'Geen tekst herkend op de foto' }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ description: tekst }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Fout: ' + e.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/scan' };
