// Amis (réservé aux comptes connectés qui ont un nom d'utilisateur) :
// GET  /api/friends              → { friends: [{ username, count, last, avatar }], incoming: [nom], outgoing: [nom] }
// GET  /api/friends?user=<nom>   → profil d'un ami : { username, visits: { id: { date } }, since, friends,
//                                  avatar, banner } (même présentation que « Mon compte »)
// POST /api/friends { action: 'add' | 'remove', username }
//      add : demande (ou acceptation si l'autre a déjà demandé) ; remove : retire, annule ou refuse
// Seuls les noms d'utilisateur circulent : ni e-mail, ni identifiant Google.
const { verifyGoogleUser } = require('../lib/auth');
const { publicId, allNames, uidOfName, normalizeName, memberSince, profileImages, allProfileImages } = require('../lib/profiles');
const { relations, addFriend, removeFriend, readShared, summary } = require('../lib/friends');

const fail = (status, message) => Object.assign(new Error(message), { status });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await verifyGoogleUser(req);
    const me = publicId(user.sub);
    // Liste d'amis : relations et photos (une seule liste pour tous les amis, au lieu d'une
    // par ami) sont lues en même temps que les noms.
    const listing = req.method === 'GET' && !req.query.user
      ? Promise.all([relations(me), allProfileImages().catch(() => new Map())]) : null;
    listing?.catch(() => {}); // erreur traitée plus bas, si on va jusque-là
    const { nameOf } = await allNames();
    if (!nameOf.has(me)) throw fail(403, "Choisis d'abord ton nom d'utilisateur");
    const named = (uids) => uids.filter((u) => nameOf.has(u));

    if (req.method === 'GET' && req.query.user) {
      const other = await uidOfName(req.query.user);
      if (!other || !(await relations(me)).friends.includes(other)) throw fail(404, "Ce n'est pas (encore) ton ami");
      const { visits = {} } = await readShared(other);
      const firstVisit = Object.values(visits).map((v) => v.date).sort()[0];
      const [since, rel, images] = await Promise.all([
        memberSince(other, firstVisit ? [firstVisit] : []).catch(() => null),
        relations(other).catch(() => ({ friends: [] })),
        profileImages(other).catch(() => ({ avatar: null, banner: null })),
      ]);
      return res.status(200).json({ username: nameOf.get(other), visits, since, friends: rel.friends.length, ...images });
    }
    if (req.method === 'GET') {
      const [rel, images] = await listing;
      const friends = await Promise.all(named(rel.friends).map(async (u) => ({
        username: nameOf.get(u),
        ...summary(await readShared(u).catch(() => ({ visits: {} }))),
        avatar: images.get(u)?.avatar || null,
      })));
      return res.status(200).json({
        friends: friends.sort((a, b) => a.username.localeCompare(b.username)),
        incoming: named(rel.incoming).map((u) => nameOf.get(u)).sort(),
        outgoing: named(rel.outgoing).map((u) => nameOf.get(u)).sort(),
      });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const other = await uidOfName(normalizeName(body.username));
      if (!other) throw fail(404, 'Aucun utilisateur avec ce nom');
      if (other === me) throw fail(400, 'Tu ne peux pas être ton propre ami');
      if (body.action === 'add') await addFriend(me, other);
      else if (body.action === 'remove') await removeFriend(me, other);
      else throw fail(400, 'Action inconnue');
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'GET ou POST uniquement' });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};
