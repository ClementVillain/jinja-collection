// Photos de couverture d'un sanctuaire, dans le même ordre que sur le site :
// Google Maps (si la clé est configurée côté serveur), photo liée dans OpenStreetMap
// (Commons, Wikidata P18, URL), photo Commons géolocalisée à moins de 500 m dont le titre
// évoque le sanctuaire, recherche Commons par nom à moins de 1,5 km. S'y ajoutent les photos
// partagées par les visiteurs. Les résultats Wikimedia sont gardés 30 jours sur le téléphone.
import { API_BASE } from './api';
import { KEYS, loadJson, saveJson } from './store';
import { normalize } from './text';

const PHOTO_TTL = 30 * 24 * 3600 * 1000;
// Wikimedia ne sert que des largeurs de miniature standard (500, 960…).
const THUMB_WIDTH = 960;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php?format=json';
const IMAGE_INFO = `prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_WIDTH}`;
const SHRINE_WORDS = /神社|神宮|大社|宮|社|鳥居|稲荷|八幡|天満|天神|権現|jinja|jingu|jingū|shrine|taisha|torii|inari|hachiman|tenmang|tenjin|gongen/i;
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
// Wikimedia demande d'identifier les applications qui l'interrogent.
const HEADERS = { 'User-Agent': 'JinjaCollection/1.0 (application iOS ; https://jinja-collection.vercel.app)' };

let store = null;
const memory = new Map();

async function photoStore() {
  if (!store) store = await loadJson(KEYS.photos, {});
  return store;
}
function remember(id, photo) {
  store[id] = { photo, t: Date.now() };
  saveJson(KEYS.photos, store);
}
export function forgetPhoto(id) {
  memory.delete(id);
  if (store) { delete store[id]; saveJson(KEYS.photos, store); }
}
// Déconnexion : les photos gardées pour les cartes postales du compte quittent le téléphone.
export function clearPhotoCache() {
  memory.clear();
  store = {};
  saveJson(KEYS.photos, null);
}

// Wikimedia limite le nombre de requêtes : en cas de 429, on attend puis on réessaie.
async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res.json();
    if (res.status !== 429 || i === tries - 1) throw new Error(`HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * (i + 1) ** 2));
  }
  return null;
}

const fromPage = (p, nearby) => ({ src: p.imageinfo[0].thumburl || p.imageinfo[0].url, href: p.imageinfo[0].descriptionurl, nearby });

async function commonsFile(title) {
  const data = await getJson(`${COMMONS_API}&action=query&${IMAGE_INFO}&titles=${encodeURIComponent(title)}`);
  const page = Object.values(data?.query?.pages || {})[0];
  return page?.imageinfo?.[0] ? fromPage(page, false) : null;
}

async function wikidataImage(qid) {
  const data = await getJson(`https://www.wikidata.org/w/api.php?format=json&action=wbgetclaims&property=P18&entity=${qid}`);
  const file = data?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return file ? commonsFile(`File:${file}`) : null;
}

async function nearbyImage(s) {
  const data = await getJson(`${COMMONS_API}&action=query&generator=geosearch&ggsnamespace=6&ggsradius=500&ggslimit=40`
    + `&ggscoord=${s.lat}|${s.lon}&${IMAGE_INFO}`);
  const pages = Object.values(data?.query?.pages || {});
  const core = s.name.replace(/(神社|神宮|大社|天満宮|社|宮)$/, '');
  const latin = normalize(s.nameLatin || '');
  const scored = pages
    .filter((p) => p.imageinfo?.[0] && IMAGE_FILE.test(p.title))
    .map((p) => {
      let score = SHRINE_WORDS.test(p.title) ? 1 : 0;
      if (core.length >= 2 && p.title.includes(core)) score += 3;
      if (latin.length >= 4 && normalize(p.title).includes(latin)) score += 3;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.index - b.p.index);
  return scored[0] ? fromPage(scored[0].p, scored[0].score < 3) : null;
}

// Recherche plein texte : fichiers qui citent le nom, géolocalisés à moins de 1,5 km.
async function namedImage(s) {
  const query = `${s.name} nearcoord:1500m,${s.lat},${s.lon}`;
  const data = await getJson(`${COMMONS_API}&action=query&generator=search&gsrnamespace=6&gsrlimit=5`
    + `&gsrsearch=${encodeURIComponent(query)}&${IMAGE_INFO}`);
  const pages = Object.values(data?.query?.pages || {})
    .filter((p) => p.imageinfo?.[0] && IMAGE_FILE.test(p.title))
    .sort((a, b) => a.index - b.index);
  return pages[0] ? fromPage(pages[0], false) : null;
}

// Google Maps via la fonction serveur (clé cachée côté Vercel) ; sans clé, on n'insiste pas.
let googleAvailable = true;
async function googlePhoto(s) {
  if (!googleAvailable) return null;
  const res = await fetch(`${API_BASE}/api/photo?name=${encodeURIComponent(s.name)}&lat=${s.lat}&lon=${s.lon}`);
  if (res.status === 404 || res.status === 503) { googleAvailable = false; return null; }
  if (!res.ok) return null;
  const { photo } = await res.json();
  if (!photo) return null;
  return { src: photo.src, href: photo.authorUri || photo.mapsUri, credit: `${photo.author ? `${photo.author} · ` : ''}Google Maps`, mapsUri: photo.mapsUri };
}

async function findPhoto(s) {
  const google = await googlePhoto(s).catch(() => null);
  if (google) return google;
  const ref = s.photo || '';
  let photo = null;
  if (ref.startsWith('File:')) photo = await commonsFile(ref);
  else if (/^Q\d+$/.test(ref)) photo = await wikidataImage(ref);
  else if (ref.startsWith('https://')) photo = { src: ref, href: ref, nearby: false };
  return photo || (await nearbyImage(s)) || namedImage(s);
}

// Photo « Wikimedia » d'un sanctuaire (ou Google), mise en cache.
export function wikiPhoto(s) {
  if (!memory.has(s.id)) {
    const promise = photoStore().then((saved) => {
      const entry = saved[s.id];
      if (entry && Date.now() - entry.t < PHOTO_TTL) return entry.photo;
      return findPhoto(s).then((photo) => {
        // Les photos Google ne sont pas gardées : leurs URL expirent.
        if (!photo?.mapsUri) remember(s.id, photo);
        return photo;
      });
    });
    // Échec réseau : on ne mémorise rien, on réessaiera à la prochaine ouverture.
    memory.set(s.id, promise.catch((err) => { memory.delete(s.id); throw err; }));
  }
  return memory.get(s.id);
}

// ---------- Photos partagées par les visiteurs ----------
const authors = new Map();
function photoAuthor(metaUrl) {
  if (!metaUrl) return Promise.resolve(null);
  if (!authors.has(metaUrl)) authors.set(metaUrl, fetch(metaUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return authors.get(metaUrl);
}
export const rememberAuthor = (metaUrl, by) => authors.set(metaUrl, Promise.resolve(by));

export async function fetchCommunityPhotos() {
  const res = await fetch(`${API_BASE}/api/community`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

function communityEntries(community, id) {
  const entry = community?.[id];
  if (!entry) return [];
  if (typeof entry === 'string') return [{ url: entry, meta: null }];
  return Array.isArray(entry) ? entry : [entry];
}

// Photos du carrousel : photo Wikimedia sûre en premier, puis celles des visiteurs.
// Une photo Wikimedia « à proximité » ne sert que s'il n'y a rien d'autre.
export async function coverSlides(s, community) {
  const wiki = await wikiPhoto(s).catch(() => null);
  const shared = await Promise.all(communityEntries(community, s.id).map(async ({ url, meta }) => {
    const by = await photoAuthor(meta);
    return { src: url, href: url, credit: by?.name ? `Photo de ${by.name}` : 'Photo partagée par un visiteur', by };
  }));
  if (wiki && !wiki.nearby) return [wiki, ...shared];
  if (shared.length) return shared;
  return wiki ? [wiki] : [];
}

export const creditOf = (photo) => photo.credit || `${photo.nearby ? 'Photo prise à proximité · ' : ''}Wikimedia Commons`;
