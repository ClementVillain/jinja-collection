// Profils publics et « Découvert par », dans Vercel Blob, sans index à tenir à jour :
// uniquement des petits fichiers immuables, et list() fait foi (comme lib/community.js).
// Deux écritures simultanées ne s'écrasent jamais : c'est l'ordre d'arrivée qui décide.
//
//   names/<nom>/<uid>           revendication d'un nom d'utilisateur ; le nom appartient
//                               à la plus ancienne revendication (les autres sont refusées)
//   discoveries/<sanctuaire>/<uid>  visite vérifiée ; le plus ancien fichier = découvreur
//   members/<uid>               date d'inscription { since }, écrite une seule fois
//   profiles/<uid>/<avatar|banner>-<horodatage>.jpg   photo de profil et bannière choisies
//
// <uid> est une empreinte de l'identifiant Google, différente de celle du dossier users/ :
// elle ne révèle ni le compte Google ni l'e-mail, et ne sort jamais du serveur.
const crypto = require('node:crypto');
const { list, put, del } = require('@vercel/blob');

const USERNAME = /^[a-z0-9_]{3,20}$/;
const NAMES = 'names/';
const DISCOVERIES = 'discoveries/';
const MEMBERS = 'members/';
const IMAGES = 'profiles/';
const IMAGE_KINDS = ['avatar', 'banner'];

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

// « Membre depuis » : enregistrée à la première consultation du profil. Pour un compte plus
// ancien que cette fonction, on reprend la date la plus ancienne connue (première visite,
// nom choisi, découverte), passée par l'appelant dans `known` : un tableau, ou une fonction
// qui le renvoie (appelée seulement si la date n'est pas encore enregistrée).
async function memberSince(uid, known = []) {
  const [file] = await listAll(`${MEMBERS}${uid}`);
  if (file) {
    const res = await fetch(file.url);
    if (res.ok) { const { since } = await res.json(); if (since) return since; }
  }
  if (typeof known === 'function') known = await known();
  const mine = (await Promise.all([listAll(NAMES), listAll(DISCOVERIES)]))
    .flat().filter((b) => b.pathname.endsWith(`/${uid}`)).map((b) => new Date(b.uploadedAt).toISOString());
  const since = [...known, ...mine, new Date().toISOString()].filter((d) => !Number.isNaN(Date.parse(d))).sort()[0];
  try {
    await put(`${MEMBERS}${uid}`, JSON.stringify({ since }), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
  } catch (err) {
    if (!/already exists/i.test(err.message)) throw err;
  }
  return since;
}

// uid → { avatar, banner } d'après une liste de fichiers profiles/<uid>/… (la plus récente l'emporte).
function imagesByUid(files) {
  const out = new Map();
  for (const b of [...files].sort(byAge)) {
    const [, uid, file] = b.pathname.split('/');
    const kind = file?.split('-')[0];
    if (!uid || !IMAGE_KINDS.includes(kind)) continue;
    if (!out.has(uid)) out.set(uid, { avatar: null, banner: null });
    out.get(uid)[kind] = b.url;
  }
  return out;
}

// { avatar, banner } : URL de la photo de profil et de la bannière choisies (null sinon).
async function profileImages(uid) {
  return imagesByUid(await listAll(`${IMAGES}${uid}/`)).get(uid) || { avatar: null, banner: null };
}

// Images de tous les comptes en une seule liste (liste d'amis) : uid → { avatar, banner }.
const allProfileImages = async () => imagesByUid(await listAll(IMAGES));

// Une URL d'image change à chaque modification : le navigateur et l'app peuvent la garder un an.
const IMAGE_MAX_AGE = 365 * 24 * 3600;

// Enregistre une nouvelle image (JPEG déjà vérifié) et supprime les précédentes du même type.
async function setProfileImage(uid, kind, jpeg) {
  if (!IMAGE_KINDS.includes(kind)) throw Object.assign(new Error('Type d\'image inconnu'), { status: 400 });
  const blob = await put(`${IMAGES}${uid}/${kind}-${Date.now()}.jpg`, jpeg, {
    access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, cacheControlMaxAge: IMAGE_MAX_AGE,
  });
  await removeProfileImage(uid, kind, blob.url);
  return blob.url;
}

async function removeProfileImage(uid, kind, keepUrl = null) {
  if (!IMAGE_KINDS.includes(kind)) throw Object.assign(new Error('Type d\'image inconnu'), { status: 400 });
  const old = (await listAll(`${IMAGES}${uid}/${kind}-`)).filter((b) => b.url !== keepUrl);
  if (old.length) await del(old.map((b) => b.url));
}

module.exports = { profileImages, allProfileImages, setProfileImage, removeProfileImage, memberSince, USERNAME, publicId, normalizeName, listAll, allNames, usernameOf, uidOfName, claimUsername, recordDiscoveries, discoverers };
