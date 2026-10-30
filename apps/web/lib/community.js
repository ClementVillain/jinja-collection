// Photos partagées par les visiteurs, stockées dans Vercel Blob sous
// community/<idSanctuaire>/<horodatage>-<aléa>.jpg (+ .json du même nom : auteur de la photo)
// Pas d'index à tenir à jour : la liste des fichiers fait foi (aucun conflit entre deux envois).
const { list } = require('@vercel/blob');

const PREFIX = 'community/';

const MAX_PER_SHRINE = 12;

// { "<idSanctuaire>": [{ url, meta }, …] } : photos de la plus récente à la plus ancienne,
// meta = URL du .json de l'auteur.
async function shrinePhotos() {
  const photos = {};
  const metas = {};
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const [, id, file] = blob.pathname.split('/');
      if (!id || !file) continue;
      if (file.endsWith('.json')) metas[blob.pathname.slice(0, -5)] = blob.url;
      else if (file.endsWith('.jpg')) (photos[id] ||= []).push(blob);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return Object.fromEntries(Object.entries(photos).map(([id, blobs]) => [
    id,
    blobs
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(0, MAX_PER_SHRINE)
      .map((blob) => ({ url: blob.url, meta: metas[blob.pathname.slice(0, -4)] || null })),
  ]));
}

module.exports = { PREFIX, shrinePhotos };
