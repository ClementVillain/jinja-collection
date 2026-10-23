// GET /api/sync  → { state, savedAt } du compte connecté (state = { visits, deleted })
// PUT /api/sync  → enregistre l'état fusionné envoyé par le navigateur
const { verifyGoogleUser } = require('../lib/auth');
const { loadState, saveState } = require('../lib/userdata');

const MAX_BYTES = 1024 * 1024;
const ID = /^[nwr]\d{1,12}$/;
const isDate = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

// N'accepte que la forme attendue : protège le stockage contre des données arbitraires.
function cleanState(input) {
  const visits = {}, deleted = {};
  for (const [id, v] of Object.entries(input?.visits || {})) {
    if (!ID.test(id) || !v || !isDate(v.date)) continue;
    visits[id] = {
      date: v.date,
      note: typeof v.note === 'string' ? v.note.slice(0, 500) : '',
      ...(isDate(v.updatedAt) ? { updatedAt: v.updatedAt } : {}),
    };
  }
  for (const [id, d] of Object.entries(input?.deleted || {})) {
    if (ID.test(id) && isDate(d)) deleted[id] = d;
  }
  return { visits, deleted };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await verifyGoogleUser(req);
    if (req.method === 'GET') {
      const saved = await loadState(user.sub);
      return res.status(200).json(saved || { state: { visits: {}, deleted: {} }, savedAt: null });
    }
    if (req.method === 'PUT') {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      if (raw.length > MAX_BYTES) return res.status(413).json({ error: 'Données trop volumineuses' });
      const state = cleanState(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
      const savedAt = await saveState(user.sub, state);
      return res.status(200).json({ savedAt });
    }
    return res.status(405).json({ error: 'GET ou PUT uniquement' });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};
