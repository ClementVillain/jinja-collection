// Ajoute à chaque sanctuaire de data/shrines.json sa préfecture (code JIS 1–47), à partir des
// contours de « Data of Japan » (dataofjapan/land, d'après 地球地図日本 / Global Map Japan du
// GSI — source à citer). Utilisé par fetch-shrines.mjs, ou seul : node packages/shared/scripts/prefectures.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { pointInGeometry } = createRequire(import.meta.url)('../geo.js');
const SOURCE = 'https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson';

function bboxOf(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) for (const [lon, lat] of poly[0]) {
    w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

// Distance (approchée) au sommet le plus proche : pour les sanctuaires sur la côte ou sur un îlot
// absent de ces contours simplifiés.
function nearestVertex(lon, lat, geometry) {
  let best = Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const poly of polys) for (const [x, y] of poly[0]) best = Math.min(best, ((x - lon) * k) ** 2 + (y - lat) ** 2);
  return best;
}

export async function prefectureAssigner() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`contours des préfectures indisponibles (${res.status})`);
  const features = (await res.json()).features.map((f) => ({
    id: f.properties.id, ja: f.properties.nam_ja, en: f.properties.nam, geometry: f.geometry, bbox: bboxOf(f.geometry),
  }));
  const table = features.map((f) => [f.id, f.ja, f.en]).sort((a, b) => a[0] - b[0]);
  const assign = (lat, lon) => {
    const hit = features.find((f) => lon >= f.bbox[0] && lon <= f.bbox[2] && lat >= f.bbox[1] && lat <= f.bbox[3]
      && pointInGeometry(lon, lat, f.geometry));
    if (hit) return hit.id;
    return features.reduce((a, b) => (nearestVertex(lon, lat, a.geometry) <= nearestVertex(lon, lat, b.geometry) ? a : b)).id;
  };
  return { table, assign };
}

// Champs : [id, name, nameLatin, lat, lon, photo, romaji, prefecture]
export async function addPrefectures(data) {
  const { table, assign } = await prefectureAssigner();
  data.shrines = data.shrines.map((s) => { const out = s.slice(0, 7); while (out.length < 7) out.push(''); out[7] = assign(s[3], s[4]); return out; });
  data.fields = ['id', 'name', 'nameLatin', 'lat', 'lon', 'photo', 'romaji', 'prefecture'];
  data.prefectures = table;
  data.prefectureSource = '地球地図日本 (Global Map Japan, GSI) via dataofjapan/land';
  return data;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = new URL('../data/shrines.json', import.meta.url);
  const data = await addPrefectures(JSON.parse(await readFile(file, 'utf8')));
  await writeFile(file, JSON.stringify(data));
  const counts = {};
  for (const s of data.shrines) counts[s[7]] = (counts[s[7]] || 0) + 1;
  console.log(`${data.shrines.length} sanctuaires, ${Object.keys(counts).length} préfectures.`);
}
