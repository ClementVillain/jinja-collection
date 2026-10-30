// Modération : supprime des photos partagées par les visiteurs.
//   node apps/web/scripts/remove-photo.mjs w561378888        → toutes les photos de ce sanctuaire
//   node apps/web/scripts/remove-photo.mjs <url de la photo>  → une seule photo
// Nécessite BLOB_READ_WRITE_TOKEN (fichier .env.local créé par `vercel env pull` à la racine du dépôt).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

try {
  for (const line of readFileSync(new URL('../../../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* variables déjà dans l'environnement */ }

const require = createRequire(import.meta.url);
const { del, list } = require('@vercel/blob');
const { PREFIX } = require('../lib/community.js');

const target = process.argv[2];
if (!target) {
  console.error('Usage : node scripts/remove-photo.mjs <idSanctuaire | url>');
  process.exit(1);
}

let urls;
if (target.startsWith('https://')) {
  // La photo et le fichier de son auteur (.json du même nom).
  urls = [target, target.replace(/\.jpg$/, '.json')];
} else {
  urls = [];
  let cursor;
  do {
    const page = await list({ prefix: `${PREFIX}${target}/`, cursor });
    urls.push(...page.blobs.map((b) => b.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
if (!urls.length) {
  console.log('Aucune photo trouvée pour', target);
  process.exit(0);
}
await del(urls);
console.log(`${urls.length} photo(s) supprimée(s) :\n${urls.join('\n')}`);
