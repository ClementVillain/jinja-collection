// Photos partagées par les visiteurs, stockées dans Vercel Blob sous
// community/<idSanctuaire>/<horodatage>-<aléa>.jpg (+ .json du même nom : auteur de la photo)
// Pas d'index à tenir à jour : la liste des fichiers fait foi (aucun conflit entre deux envois).
const { list } = require('@vercel/blob');

const PREFIX = 'community/';

// { "<idSanctuaire>": { url, meta } } : photo la plus récente et URL du .json de son auteur.
async function latestPhotos() {
  const latest = {};
  const metas = {};
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const [, id, file] = blob.pathname.split('/');
      if (!id || !file) continue;
      if (file.endsWith('.json')) { metas[blob.pathname.slice(0, -5)] = blob.url; continue; }
      if (!file.endsWith('.jpg')) continue;
      const prev = latest[id];
      if (!prev || blob.uploadedAt > prev.uploadedAt) latest[id] = blob;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return Object.fromEntries(Object.entries(latest).map(([id, blob]) => [
    id, { url: blob.url, meta: metas[blob.pathname.slice(0, -4)] || null },
  ]));
}

module.exports = { PREFIX, latestPhotos };
