// Profils publics et « Découvert par », dans Vercel Blob, sans index à tenir à jour :
// uniquement des petits fichiers immuables, et list() fait foi (comme lib/community.js).
// Deux écritures simultanées ne s'écrasent jamais : c'est l'ordre d'arrivée qui décide.
//
//   names/<nom>/<uid>           revendication d'un nom d'utilisateur ; le nom appartient
//                               à la plus ancienne revendication (les autres sont refusées)
//   discoveries/<sanctuaire>/<uid>  visite vérifiée ; le plus ancien fichier = découvreur
//
// <uid> est une empreinte de l'identifiant Google, différente de celle du dossier users/ :
// elle ne révèle ni le compte Google ni l'e-mail, et ne sort jamais du serveur.
const crypto = require('node:crypto');
const { list, put, del } = require('@vercel/blob');

const USERNAME = /^[a-z0-9_]{3,20}$/;
const NAMES = 'names/';
const DISCOVERIES = 'discoveries/';

const publicId = (sub) => crypto.createHash('sha256').update(`jinja-collection:public:${sub}`).digest('hex').slice(0, 32);
const normalizeName = (name) => String(name || '').trim().toLowerCase();

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const byAge = (a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt) || a.pathname.localeCompare(b.pathname);

// { nameOf: uid → nom, uidOf: nom → uid } à partir de toutes les revendications.
function resolveNames(claims) {
  const uidOf = new Map(), nameOf = new Map();
  for (const b of [...claims].sort(byAge)) {
    const [, name, uid] = b.pathname.split('/');
    if (name && uid && !uidOf.has(name)) uidOf.set(name, uid);
  }
  // Nom actuel d'un compte : sa revendication gagnante la plus récente.
  for (const b of [...claims].sort(byAge)) {
    const [, name, uid] = b.pathname.split('/');
    if (uidOf.get(name) === uid) nameOf.set(uid, name);
  }
  return { uidOf, nameOf };
}

const allNames = async () => resolveNames(await listAll(NAMES));

async function usernameOf(uid) {
  return (await allNames()).nameOf.get(uid) || null;
}

async function uidOfName(name) {
  const claims = await listAll(`${NAMES}${normalizeName(name)}/`);
  return resolveNames(claims).uidOf.get(normalizeName(name)) || null;
}

// Choisit ou change le nom d'utilisateur. Erreur 409 si le nom est déjà pris.
async function claimUsername(uid, wanted) {
  const name = normalizeName(wanted);
  if (!USERNAME.test(name)) {
    throw Object.assign(new Error('Nom invalide : 3 à 20 caractères, lettres minuscules, chiffres ou _'), { status: 400 });
  }
  const prefix = `${NAMES}${name}/`;
  let claims = await listAll(prefix);
  const owner = resolveNames(claims).uidOf.get(name);
  if (owner && owner !== uid) throw Object.assign(new Error('Ce nom est déjà pris'), { status: 409 });
  if (!owner) {
    try {
      await put(`${prefix}${uid}`, '{}', { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    } catch (err) {
      if (!/already exists/i.test(err.message)) throw err;
    }
    // Quelqu'un a pu revendiquer le même nom au même moment : le plus ancien gagne.
    claims = await listAll(prefix);
    if (resolveNames(claims).uidOf.get(name) !== uid) {
      const mine = claims.find((b) => b.pathname === `${prefix}${uid}`);
      if (mine) await del(mine.url);
      throw Object.assign(new Error('Ce nom est déjà pris'), { status: 409 });
    }
  }
  // Libère les anciens noms du compte.
  const old = (await listAll(NAMES)).filter((b) => b.pathname.endsWith(`/${uid}`) && b.pathname !== `${prefix}${uid}`);
  if (old.length) await del(old.map((b) => b.url));
  return name;
}

// Enregistre les visites vérifiées comme candidates à la découverte (fichier déjà présent : rien à faire).
async function recordDiscoveries(uid, shrineIds) {
  await Promise.all(shrineIds.map((id) => put(`${DISCOVERIES}${id}/${uid}`, '{}', {
    access: 'public', contentType: 'application/json', addRandomSuffix: false,
  }).catch((err) => { if (!/already exists/i.test(err.message)) throw err; })));
}

// { "<idSanctuaire>": "<nom du découvreur>" } : premier visiteur vérifié qui a un nom.
async function discoverers() {
  const [found, { nameOf }] = await Promise.all([listAll(DISCOVERIES), allNames()]);
  const out = {};
  for (const b of found.sort(byAge)) {
    const [, id, uid] = b.pathname.split('/');
    if (!id || !uid || out[id]) continue;
    const name = nameOf.get(uid);
    if (name) out[id] = name;
  }
  return out;
}

module.exports = { USERNAME, publicId, normalizeName, listAll, allNames, usernameOf, uidOfName, claimUsername, recordDiscoveries, discoverers };
