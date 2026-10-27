// GET /api/profile → { username } du compte connecté (null tant qu'il n'en a pas choisi)
// PUT /api/profile { username } → choisit ou change le nom d'utilisateur public (unique)
const { verifyGoogleUser } = require('../lib/auth');
const { publicId, usernameOf, claimUsername } = require('../lib/profiles');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await verifyGoogleUser(req);
    const uid = publicId(user.sub);
    if (req.method === 'GET') return res.status(200).json({ username: await usernameOf(uid) });
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      return res.status(200).json({ username: await claimUsername(uid, body.username) });
    }
    return res.status(405).json({ error: 'GET ou PUT uniquement' });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};
