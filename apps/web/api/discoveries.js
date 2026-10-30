// GET /api/discoveries : { "<idSanctuaire>": "<nom d'utilisateur>" } — premier visiteur
// (visite vérifiée par la règle de proximité) de chaque sanctuaire.
const { discoverers } = require('../lib/profiles');

module.exports = async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Stockage non configuré' });
  try {
    const found = await discoverers();
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
    return res.status(200).json(found);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
