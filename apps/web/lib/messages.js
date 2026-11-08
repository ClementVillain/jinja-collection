// Sanctuaires envoyés entre amis, dans Vercel Blob, en petits fichiers immuables (aucun index
// partagé à réécrire, comme lib/friends.js) :
//   messages/<uidA>_<uidB>/<horodatage>-<expéditeur>-<sanctuaire>-<aléa>
//       un envoi ; <uidA>_<uidB> = les deux comptes triés, donc un seul dossier par conversation
//   unread/<destinataire>/<expéditeur>/<horodatage>-<sanctuaire>-<aléa>
//       marqueur « non lu », supprimé quand le destinataire ouvre la conversation
// Tout est dans le chemin : lire une conversation = un seul list(), compter ses non-lus = un list().
const crypto = require('node:crypto');
const { put, del } = require('@vercel/blob');
const { listAll } = require('./profiles');

const MESSAGES = 'messages/';
const UNREAD = 'unread/';
// Conversation affichée : les derniers envois seulement (pas de limite d'envoi).
const MAX_SHOWN = 100;
const opts = { access: 'public', contentType: 'application/json', addRandomSuffix: false };

const pairOf = (a, b) => [a, b].sort().join('_');
// Horodatage à largeur fixe : l'ordre alphabétique des fichiers est l'ordre chronologique.
const stamp = (ms) => String(ms).padStart(15, '0');

// Deux envois dans la même milliseconde (même instance) restent dans leur ordre d'arrivée.
let lastSent = 0;

async function send(from, to, shrine, at = Date.now()) {
  const now = lastSent = Math.max(at, lastSent + 1);
  const t = stamp(now);
  const rand = crypto.randomBytes(3).toString('hex'); // deux envois identiques = deux fichiers
  const date = new Date(now).toISOString();
  await Promise.all([
    put(`${MESSAGES}${pairOf(from, to)}/${t}-${from}-${shrine}-${rand}`, JSON.stringify({ shrine, date }), opts),
    put(`${UNREAD}${to}/${from}/${t}-${shrine}-${rand}`, '{}', opts),
  ]);
  return { shrine, date, mine: true };
}

// Conversation de `me` avec `other`, plus ancien d'abord : [{ shrine, date, mine }].
async function conversation(me, other) {
  // Un seul appel list() tant que la conversation a moins de 1000 envois.
  return (await listAll(`${MESSAGES}${pairOf(me, other)}/`))
    .map((b) => b.pathname.split('/')[2].split('-'))
    .filter(([t, from, shrine]) => t && from && shrine)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-MAX_SHOWN)
    .map(([t, from, shrine]) => ({ shrine, date: new Date(Number(t)).toISOString(), mine: from === me }));
}

// Non-lus de `me` : { uidExpéditeur: nombre } (un seul list pour tous les amis).
async function unreadCounts(me) {
  const out = {};
  for (const b of await listAll(`${UNREAD}${me}/`)) {
    const from = b.pathname.split('/')[2];
    if (from) out[from] = (out[from] || 0) + 1;
  }
  return out;
}

// Conversation ouverte : les envois de `other` sont lus.
async function markRead(me, other) {
  const found = await listAll(`${UNREAD}${me}/${other}/`);
  if (found.length) await del(found.map((b) => b.url));
}

module.exports = { send, conversation, unreadCounts, markRead, MAX_SHOWN };
