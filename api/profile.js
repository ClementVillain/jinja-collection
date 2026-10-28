// GET /api/profile → { username, since, friends } du compte connecté : nom public (null tant qu'il
//                    n'en a pas choisi), date d'inscription, nombre d'amis
// PUT /api/profile { username } → choisit ou change le nom d'utilisateur public (unique)
const { verifyGoogleUser } = require('../lib/auth');
const { publicId, usernameOf, claimUsername, memberSince } = require('../lib/profiles');
const { loadState } = require('../lib/userdata');
const { relations } = require('../lib/friends');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await verifyGoogleUser(req);
    const uid = publicId(user.sub);
    if (req.method === 'GET') {
      // Première visite connue : sert de date d'inscription aux comptes plus anciens que « members/ ».
      const saved = await loadState(user.sub).catch(() => null);
      const firstVisit = Object.values(saved?.state?.visits || {}).map((v) => v.date).sort()[0];
      const [username, since, rel] = await Promise.all([
        usernameOf(uid), memberSince(uid, firstVisit ? [firstVisit] : []), relations(uid).catch(() => ({ friends: [] })),
      ]);
      return res.status(200).json({ username, since, friends: rel.friends.length });
    }
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      return res.status(200).json({ username: await claimUsername(uid, body.username) });
    }
    return res.status(405).json({ error: 'GET ou PUT uniquement' });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};
