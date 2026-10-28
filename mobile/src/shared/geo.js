// Recherche par ville : géocodage avec Nominatim (OpenStreetMap), puis sanctuaires situés dans
// le contour de la ville (point dans polygone, ou dans son rectangle englobant à défaut).
// Politique d'usage de Nominatim : au plus 1 requête par seconde, résultats mis en cache.
// https://operations.osmfoundation.org/policies/nominatim/
(function (root) {
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  // Types de lieux gardés : villes, communes, arrondissements, quartiers (pas les préfectures).
  const PLACE_TYPES = new Set([
    'city', 'town', 'village', 'municipality', 'city_district', 'district', 'borough', 'suburb', 'quarter', 'hamlet',
  ]);
  const MIN_INTERVAL = 1100; // ms entre deux requêtes
  const CACHE_SIZE = 40;

  // Au moins 3 caractères (2 suffisent en japonais : « 京都 », « 奈良 »).
  function isCityQuery(query) {
    const q = String(query || '').trim();
    return q.length >= 3 || (q.length >= 2 && /[぀-ヿ㐀-鿿]/.test(q));
  }

  function searchUrl(query) {
    return `${NOMINATIM}?format=jsonv2&countrycodes=jp&polygon_geojson=1&namedetails=1&limit=5&accept-language=fr`
      + `&q=${encodeURIComponent(String(query).trim())}`;
  }

  // Rayon horizontal (« ray casting ») : nombre impair de croisements = point à l'intérieur.
  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Polygone GeoJSON : dans l'anneau extérieur et hors des trous.
  function pointInPolygon(lon, lat, rings) {
    if (!rings?.length || !pointInRing(lon, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(lon, lat, rings[i])) return false;
    return true;
  }

  function pointInGeometry(lon, lat, geometry) {
    if (geometry?.type === 'Polygon') return pointInPolygon(lon, lat, geometry.coordinates);
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some((p) => pointInPolygon(lon, lat, p));
    return false;
  }

  // bbox = [ouest, sud, est, nord]
  const inBbox = (lon, lat, [w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n;
  const hasArea = (geometry) => geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';

  // Lieu contenant le point : contour s'il existe, sinon rectangle englobant.
  function contains(place, lon, lat) {
    if (!inBbox(lon, lat, place.bbox)) return false;
    return hasArea(place.geometry) ? pointInGeometry(lon, lat, place.geometry) : true;
  }

  // Sanctuaires ({ lat, lon }) situés dans le lieu.
  function shrinesIn(place, list) {
    return list.filter((s) => contains(place, s.lon, s.lat));
  }

  // Région affichée sous le nom : la préfecture, en général dernier élément avant le code postal et le pays.
  function regionOf(r) {
    const parts = String(r.display_name || '').split(',').map((p) => p.trim()).slice(1)
      .filter((p) => p && !/^\d[\d-]*$/.test(p) && p !== 'Japon' && p !== '日本');
    return parts.length ? parts[parts.length - 1] : '';
  }

  // Résultats Nominatim → lieux de type ville, sans doublon (un contour l'emporte sur un simple point).
  function pickPlaces(results) {
    const out = [];
    for (const r of Array.isArray(results) ? results : []) {
      const type = r.addresstype || r.type;
      if (!PLACE_TYPES.has(type) || !Array.isArray(r.boundingbox)) continue;
      const [s, n, w, e] = r.boundingbox.map(Number);
      if (![s, n, w, e].every(Number.isFinite)) continue;
      const name = r.name || r.namedetails?.name || String(r.display_name || '').split(',')[0];
      const local = r.namedetails?.name && r.namedetails.name !== name ? r.namedetails.name : '';
      const place = {
        key: `${r.osm_type || ''}${r.osm_id || out.length}`,
        name,
        local,
        label: local ? `${name} (${local})` : name,
        region: regionOf(r),
        type,
        bbox: [w, s, e, n],
        geometry: hasArea(r.geojson) ? r.geojson : null,
      };
      const twin = out.findIndex((p) => p.label === place.label && p.region === place.region);
      if (twin === -1) out.push(place);
      else if (!out[twin].geometry && place.geometry) out[twin] = place;
    }
    return out;
  }

  // Requêtes espacées d'au moins MIN_INTERVAL, même lancées en même temps.
  const cache = new Map();
  let nextSlot = 0;
  const cacheKey = (query) => String(query).trim().toLowerCase();
  const cached = (query) => cache.get(cacheKey(query));

  // En japonais, « 京都 » désigne surtout la gare et « 奈良 » de petits quartiers : la ville
  // s'écrit 京都市, 奈良市. Pour un nom sans suffixe de commune, on cherche aussi « nom + 市 »
  // (puis « nom + 町 » si rien) et la commune passe en premier.
  const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/;
  const MUNICIPAL = /[市町村区]$/;

  async function findPlaces(query, { headers } = {}) {
    const key = cacheKey(query);
    if (cache.has(key)) return cache.get(key);
    const q = String(query).trim();
    let places = [];
    if (JAPANESE.test(q) && !MUNICIPAL.test(q)) {
      for (const suffix of ['市', '町']) {
        places = await fetchPlaces(q + suffix, headers);
        if (places.length) break;
      }
    }
    const seen = new Set(places.map((p) => p.key));
    places = [...places, ...(await fetchPlaces(query, headers)).filter((p) => !seen.has(p.key))];
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
    cache.set(key, places);
    return places;
  }

  async function fetchPlaces(query, headers) {
    const at = Math.max(Date.now(), nextSlot);
    nextSlot = at + MIN_INTERVAL;
    if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
    let res;
    try {
      res = await fetch(searchUrl(query), { headers: { Accept: 'application/json', ...headers } });
    } catch {
      throw new Error('pas de connexion au service de recherche de lieux');
    }
    if (!res.ok) throw new Error(`service de recherche de lieux indisponible (${res.status})`);
    return pickPlaces(await res.json());
  }

  const api = {
    isCityQuery, searchUrl, pointInRing, pointInPolygon, pointInGeometry, inBbox, contains, shrinesIn,
    pickPlaces, findPlaces, cached, PLACE_TYPES,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JinjaGeo = api;
})(this);
