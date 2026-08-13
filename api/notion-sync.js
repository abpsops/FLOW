// /api/notion-sync.js
// Vercel serverless function — the ONLY thing allowed to hold the Notion
// integration token. The browser (index.html) never sees it: it just POSTs
// record data here, and this relays it to Notion's REST API server-side.
// This is required, not optional — Notion's API does not support direct
// browser-to-Notion calls (no CORS), so even a "just call Notion from JS"
// approach would fail regardless of the token.
//
// Configure in Vercel → Project → Settings → Environment Variables:
//   NOTION_TOKEN         the "Internal Integration Secret" from
//                        notion.so/my-integrations
//   NOTION_DATABASE_ID   the database ID from your Notion database's URL

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    res.status(500).json({
      error: 'Notion is not configured yet — set NOTION_TOKEN and NOTION_DATABASE_ID in Vercel → Settings → Environment Variables, then redeploy.'
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { pageId, properties } = body || {};

  if (!properties) {
    res.status(400).json({ error: 'Missing properties in request body.' });
    return;
  }

  try {
    const notionRes = await fetch(
      pageId ? `https://api.notion.com/v1/pages/${pageId}` : 'https://api.notion.com/v1/pages',
      {
        method: pageId ? 'PATCH' : 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          pageId
            ? { properties }
            : { parent: { database_id: NOTION_DATABASE_ID }, properties }
        )
      }
    );

    const data = await notionRes.json();
    if (!notionRes.ok) {
      res.status(notionRes.status).json({ error: data.message || 'Notion API error', details: data });
      return;
    }
    res.status(200).json({ pageId: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
