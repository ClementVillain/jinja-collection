// Données de chaque compte (visites), dans Vercel Blob sous users/<empreinte>/state-<suffixe>.json.
// Chaque sauvegarde crée un nouveau fichier (URL unique, jamais servie périmée par le CDN) ;
// la liste des fichiers donne la plus récente, et on ne garde que les dernières versions.
const crypto = require('node:crypto');
const { list, put, del } = require('@vercel/blob');

const KEEP_VERSIONS = 3;

// Empreinte de l'identifiant Google : le dossier ne révèle pas le compte et ne se devine pas.
const userPrefix = (sub) => `users/${crypto.createHash('sha256').update(`jinja-collection:${sub}`).digest('hex')}/`;

async function versions(sub) {
  const { blobs } = await list({ prefix: userPrefix(sub), limit: 100 });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

async function loadState(sub) {
  const [latest] = await versions(sub);
  if (!latest) return null;
  const res = await fetch(latest.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Lecture des données : ${res.status}`);
  return { state: await res.json(), savedAt: latest.uploadedAt };
}

async function saveState(sub, state) {
  const blob = await put(`${userPrefix(sub)}state.json`, JSON.stringify(state), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: true,
  });
  const old = (await versions(sub)).filter((b) => b.url !== blob.url).slice(KEEP_VERSIONS - 1);
  if (old.length) await del(old.map((b) => b.url));
  return blob.uploadedAt || new Date().toISOString();
}

module.exports = { loadState, saveState };
