module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    const email = ((body && body.email) || '').toString().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: 'Invalid email' }); return; }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) { res.status(500).json({ error: 'Server not configured' }); return; }
    const r = await fetch(url + '/rest/v1/leads', {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ email: email, source: 'automateiq-landing' })
    });
    if (!r.ok) { const detail = await r.text(); res.status(502).json({ error: 'Store failed', detail: detail }); return; }
    res.status(200).json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
};

