// /api/weather.js
// Vercel serverless function — relays weather requests to Weatherstack.
// Two reasons this can't just be called directly from the browser:
//   1. The API key must never be visible in client-side code.
//   2. Weatherstack's FREE plan only supports plain http:// — a browser on
//      an https:// page (like this app) blocks that as mixed content. A
//      server-to-server call has no such restriction.
//
// Configure in Vercel → Project → Settings → Environment Variables:
//   WEATHERSTACK_API_KEY   your Weatherstack access key

module.exports = async function handler(req, res) {
  const API_KEY = process.env.WEATHERSTACK_API_KEY;
  if (!API_KEY) {
    res.status(500).json({ error: 'Weather is not configured yet — set WEATHERSTACK_API_KEY in Vercel → Settings → Environment Variables, then redeploy.' });
    return;
  }

  const query = (req.query && req.query.query) ? String(req.query.query).trim() : '';
  if (!query) {
    res.status(400).json({ error: 'Missing "query" parameter (a city or port name).' });
    return;
  }

  try {
    const url = `http://api.weatherstack.com/current?access_key=${encodeURIComponent(API_KEY)}&query=${encodeURIComponent(query)}`;
    const wsRes = await fetch(url);
    const data = await wsRes.json();

    if (data.error) {
      // Weatherstack returns 200 with an "error" object on failure (bad
      // query, invalid key, etc.) rather than a normal HTTP error status.
      res.status(400).json({ error: data.error.info || 'Weatherstack could not find that location.' });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
