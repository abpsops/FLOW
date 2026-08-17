// /api/debug-weather.js
// TEMPORARY diagnostic endpoint — delete this file once the weather
// feature is confirmed working. It never returns the full key value.
//
// Usage:
//   /api/debug-weather              -> tests whatever WEATHERSTACK_API_KEY
//                                       is currently set in Vercel
//   /api/debug-weather?debugKey=XXX -> tests the literal key XXX instead,
//                                       bypassing the env var entirely

module.exports = async function handler(req, res) {
  const envKey = process.env.WEATHERSTACK_API_KEY || '';
  const overrideKey = (req.query && req.query.debugKey) ? String(req.query.debugKey).trim() : '';
  const keyUsed = overrideKey || envKey;
  const source = overrideKey ? 'debugKey query param' : 'WEATHERSTACK_API_KEY env var';

  const report = {
    env_var_present: !!envKey,
    env_var_length: envKey.length,
    env_var_preview: envKey ? `${envKey.slice(0, 3)}...${envKey.slice(-3)}` : null,
    key_source_used_for_test: source,
  };

  if (!keyUsed) {
    return res.status(200).json({ ...report, test_result: 'no key available to test' });
  }

  try {
    const url = `http://api.weatherstack.com/current?access_key=${encodeURIComponent(keyUsed)}&query=Dubai`;
    const wsRes = await fetch(url);
    const data = await wsRes.json();
    return res.status(200).json({ ...report, weatherstack_response: data });
  } catch (err) {
    return res.status(200).json({ ...report, fetch_error: err.message });
  }
};
