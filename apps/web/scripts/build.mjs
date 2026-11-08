// Copie dans public/ le code et les données partagés avec l'app (packages/shared) :
// le site n'a pas de bundler, il charge ces fichiers tels quels. Lancé par Vercel et par npm run dev.
import { copyFile, mkdir } from 'node:fs/promises';

const shared = new URL('../../../packages/shared/', import.meta.url);
const pub = new URL('../public/', import.meta.url);

await mkdir(new URL('shared/', pub), { recursive: true });
await mkdir(new URL('data/', pub), { recursive: true });
for (const f of ['merge.js', 'proximity.js', 'route.js', 'geo.js', 'card.js', 'friendvisits.js', 'messages.js']) {
  await copyFile(new URL(f, shared), new URL(`shared/${f}`, pub));
}
await copyFile(new URL('data/shrines.json', shared), new URL('data/shrines.json', pub));
console.log('public/shared/ et public/data/ à jour');
