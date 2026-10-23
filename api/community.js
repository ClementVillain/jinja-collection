// GET /api/community : { "<idSanctuaire>": "<url de la photo la plus récente>" }
const { latestPhotos } = require('../lib/community');

module.exports = async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Stockage non configuré' });
  try {
    const latest = await latestPhotos();
    // Cache CDN court : une photo partagée apparaît chez tout le monde en moins d'une minute.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
    return res.status(200).json(latest);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
