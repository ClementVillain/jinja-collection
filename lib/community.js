// Photos partagées par les visiteurs, stockées dans Vercel Blob sous
// community/<idSanctuaire>/<horodatage>-<suffixe>.jpg
// Pas d'index à tenir à jour : la liste des fichiers fait foi (aucun conflit entre deux envois).
const { list } = require('@vercel/blob');

const PREFIX = 'community/';

// { "<idSanctuaire>": "<url de la photo la plus récente>" }
async function latestPhotos() {
  const latest = {};
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const [, id, file] = blob.pathname.split('/');
      if (!id || !file?.endsWith('.jpg')) continue;
      const prev = latest[id];
      if (!prev || blob.uploadedAt > prev.uploadedAt) latest[id] = blob;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return Object.fromEntries(Object.entries(latest).map(([id, blob]) => [id, blob.url]));
}

module.exports = { PREFIX, latestPhotos };
