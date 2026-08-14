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
//
// IMPORTANT — Notion API version: as of 2025-09-03, Notion databases can
// hold multiple "data sources", and creating a page now requires the
// specific data_source_id, not just the database_id (a plain database_id
// is no longer enough to resolve which property schema to validate
// against — this is exactly what caused "X is not a property that exists"
// errors for every property when this was first wired up against the
// older 2022-06-28 shape). This function looks up the data source id from
// the database id on every CREATE so it always stays correct even if the
// database is restructured later. Updates (PATCH) don't need a parent at
// all, so they're unaffected.

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

  const NOTION_VERSION = '2025-09-03';
  const headers = {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };

  try {
    let notionRes;

    if (pageId) {
      // Updating an existing page targets it directly — no parent/data
      // source reference needed at all.
      notionRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties })
      });
    } else {
      // Creating a new page needs the DATA SOURCE id, not the database id.
      // Resolve it from the database id first.
      const dbRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}`, { headers });
      const dbData = await dbRes.json();
      if (!dbRes.ok) {
        res.status(dbRes.status).json({ error: dbData.message || 'Could not look up the Notion database — check NOTION_DATABASE_ID and that it is shared with your integration.', details: dbData });
        return;
      }
      const dataSourceId = dbData.data_sources && dbData.data_sources[0] && dbData.data_sources[0].id;
      if (!dataSourceId) {
        res.status(500).json({ error: 'This Notion database has no data source — unexpected. Check the database in Notion directly.' });
        return;
      }

      notionRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { type: 'data_source_id', data_source_id: dataSourceId },
          properties
        })
      });
    }

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
