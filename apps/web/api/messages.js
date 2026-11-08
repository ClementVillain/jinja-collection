// Sanctuaires envoyés entre amis (réservé aux comptes connectés qui ont un nom d'utilisateur) :
// GET  /api/messages              → { unread: { nom: nombre } } : envois non lus, par ami
// GET  /api/messages?user=<nom>   → { username, messages: [{ shrine, date, mine }] } (plus ancien
//                                   d'abord, 100 derniers) ; les envois de cet ami deviennent lus
// POST /api/messages { username, shrine } → { ok, message } : envoie le sanctuaire à cet ami
// Seulement entre amis (demande acceptée dans les deux sens) : ancien ami = conversation masquée.
// Seuls les noms d'utilisateur circulent : ni e-mail, ni identifiant Google.
const { verifyGoogleUser } = require('../lib/auth');
const { publicId, allNames, uidOfName, normalizeName } = require('../lib/profiles');
const { relations } = require('../lib/friends');
const { shrineCoords } = require('../lib/proximity');
const { send, conversation, unreadCounts, markRead } = require('../lib/messages');
const { isShrineId } = require('../../../packages/shared/messages');

const fail = (status, message) => Object.assign(new Error(message), { status });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await verifyGoogleUser(req);
    const me = publicId(user.sub);
    const { nameOf } = await allNames();
    if (!nameOf.has(me)) throw fail(403, "Choisis d'abord ton nom d'utilisateur");

    // Ami désigné par son nom : 404 s'il n'existe pas, 403 si vous n'êtes pas (ou plus) amis.
    const friendOf = async (name) => {
      const other = await uidOfName(normalizeName(name));
      if (!other) throw fail(404, 'Aucun utilisateur avec ce nom');
      if (other === me) throw fail(400, "Tu ne peux pas t'envoyer un sanctuaire");
      if (!(await relations(me)).friends.includes(other)) throw fail(403, "Ce n'est pas (ou plus) ton ami");
      return other;
    };

    if (req.method === 'GET' && req.query.user) {
      const other = await friendOf(req.query.user);
      const messages = await conversation(me, other);
      await markRead(me, other).catch(() => {}); // réessayé à la prochaine ouverture
      return res.status(200).json({ username: nameOf.get(other), messages });
    }
    if (req.method === 'GET') {
      const [counts, rel] = await Promise.all([unreadCounts(me), relations(me)]);
      const friends = new Set(rel.friends);
      const unread = {};
      for (const [uid, n] of Object.entries(counts)) if (friends.has(uid) && nameOf.has(uid)) unread[nameOf.get(uid)] = n;
      return res.status(200).json({ unread });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      if (!isShrineId(body.shrine) || !shrineCoords(body.shrine)) throw fail(400, 'Sanctuaire inconnu');
      const other = await friendOf(body.username);
      const message = await send(me, other, body.shrine);
      return res.status(200).json({ ok: true, message });
    }
    return res.status(405).json({ error: 'GET ou POST uniquement' });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};
