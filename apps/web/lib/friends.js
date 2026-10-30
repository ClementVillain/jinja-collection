// Amis, dans Vercel Blob, en petits fichiers (aucun index partagé à réécrire) :
//   friends/<uid>/out/<autre>  <uid> demande / accepte <autre> comme ami
//   friends/<uid>/in/<autre>   copie côté destinataire (pour lister ses demandes reçues)
// Amis = demande dans les deux sens. Retirer / refuser supprime les fichiers des deux côtés.
//
//   shared/<uid>/collection-<suffixe>.json  collection visible par les amis : sanctuaires et
//   dates de visite seulement (ni notes, ni positions), réécrite à chaque synchronisation.
const { list, put, del } = require('@vercel/blob');
const { listAll } = require('./profiles');

const FRIENDS = 'friends/';
const SHARED = 'shared/';
const opts = { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true };

async function relations(uid) {
  const out = new Set(), inc = new Set();
  for (const b of await listAll(`${FRIENDS}${uid}/`)) {
    const [, , dir, other] = b.pathname.split('/');
    if (dir === 'out') out.add(other); else if (dir === 'in') inc.add(other);
  }
  return {
    friends: [...out].filter((u) => inc.has(u)),
    incoming: [...inc].filter((u) => !out.has(u)),
    outgoing: [...out].filter((u) => !inc.has(u)),
  };
}

// Demander quelqu'un en ami, ou accepter sa demande (même opération).
async function addFriend(uid, other) {
  await Promise.all([
    put(`${FRIENDS}${uid}/out/${other}`, '{}', opts),
    put(`${FRIENDS}${other}/in/${uid}`, '{}', opts),
  ]);
}

// Retirer un ami, annuler sa demande ou refuser celle reçue.
async function removeFriend(uid, other) {
  const paths = new Set([`${FRIENDS}${uid}/out/${other}`, `${FRIENDS}${uid}/in/${other}`, `${FRIENDS}${other}/out/${uid}`, `${FRIENDS}${other}/in/${uid}`]);
  const found = [...await listAll(`${FRIENDS}${uid}/`), ...await listAll(`${FRIENDS}${other}/`)].filter((b) => paths.has(b.pathname));
  if (found.length) await del(found.map((b) => b.url));
}

async function sharedVersions(uid) {
  const { blobs } = await list({ prefix: `${SHARED}${uid}/`, limit: 100 });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

async function writeShared(uid, visits) {
  const pub = {};
  for (const [id, v] of Object.entries(visits || {})) pub[id] = { date: v.date, ...(v.verified === false ? { verified: false } : {}) };
  const blob = await put(`${SHARED}${uid}/collection.json`, JSON.stringify({ visits: pub }), { ...opts, addRandomSuffix: true, allowOverwrite: false });
  const old = (await sharedVersions(uid)).filter((b) => b.url !== blob.url);
  if (old.length) await del(old.map((b) => b.url));
}

const hasShared = async (uid) => (await sharedVersions(uid)).length > 0;

async function readShared(uid) {
  const [latest] = await sharedVersions(uid);
  if (!latest) return { visits: {} };
  const res = await fetch(latest.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Lecture de la collection : ${res.status}`);
  return res.json();
}

// Dernier sanctuaire visité et nombre de visites, d'après la collection partagée.
function summary(shared) {
  const entries = Object.entries(shared.visits || {});
  const last = entries.sort((a, b) => b[1].date.localeCompare(a[1].date))[0];
  return { count: entries.length, last: last ? { id: last[0], date: last[1].date } : null };
}

module.exports = { relations, addFriend, removeFriend, writeShared, hasShared, readShared, summary };
