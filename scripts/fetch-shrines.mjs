// Télécharge tous les sanctuaires shintō (jinja) du Japon depuis OpenStreetMap
// via l'API Overpass et écrit un fichier compact dans data/shrines.json.
// Usage : node scripts/fetch-shrines.mjs
import { writeFile } from 'node:fs/promises';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const QUERY = `
[out:json][timeout:300];
area["ISO3166-1"="JP"]->.jp;
nwr["amenity"="place_of_worship"]["religion"="shinto"](area.jp);
out center tags;
`;

async function query() {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const endpoint of ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'jinja-collection/1.0 (personal project)',
          },
          body: 'data=' + encodeURIComponent(QUERY),
        });
        if (res.ok) return await res.json();
        console.warn(`${endpoint} a répondu ${res.status}, on essaie le suivant…`);
      } catch (err) {
        console.warn(`${endpoint} : ${err.message}, on essaie le suivant…`);
      }
    }
  }
  throw new Error('Aucun serveur Overpass n\'a répondu correctement.');
}

const { elements } = await query();

const round = (n) => Math.round(n * 1e5) / 1e5;

// Référence vers une photo : fichier Wikimedia Commons, entité Wikidata (propriété P18),
// ou URL directe d'image. Sinon chaîne vide (l'appli cherchera une photo à proximité).
function photoRef(t) {
  const commons = t.wikimedia_commons || '';
  if (commons.startsWith('File:')) return commons;
  if (/^File:/i.test(t.image || '')) return 'File:' + t.image.slice(5);
  if (/^https?:\/\/.+\.(jpe?g|png|webp)$/i.test(t.image || '')) return t.image;
  if (/^Q\d+$/.test(t.wikidata || '')) return t.wikidata;
  return '';
}
const shrines = [];
for (const el of elements) {
  const t = el.tags || {};
  const name = t.name || t['name:ja'];
  if (!name) continue; // les petits hokora sans nom ne sont pas collectionnables
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) continue;
  shrines.push([
    el.type[0] + el.id,                                   // id stable : n123 / w456 / r789
    name,                                                  // nom japonais
    t['name:en'] || t['name:ja-Latn'] || t['name:ja_rm'] || '', // nom latin
    round(lat),
    round(lon),
    photoRef(t),                                           // source de la photo de couverture
  ]);
}

await writeFile(new URL('../data/shrines.json', import.meta.url), JSON.stringify({
  source: 'OpenStreetMap contributors (ODbL)',
  fetchedAt: new Date().toISOString(),
  fields: ['id', 'name', 'nameLatin', 'lat', 'lon', 'photo'],
  shrines,
}));
console.log(`${shrines.length} sanctuaires nommés écrits (sur ${elements.length} trouvés).`);
