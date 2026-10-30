// Règle de proximité : une visite ne compte que si l'on est passé à moins de 1 km du
// sanctuaire dans les 48 heures qui précèdent. Le navigateur / l'app gardent localement les
// positions GPS récentes (« passages ») ; seule la position qui sert de preuve est envoyée
// au serveur avec la visite, qui refait la vérification (voir lib/proximity.js).
(function (root) {
  const RADIUS_M = 1000;
  const WINDOW_MS = 48 * 3600 * 1000;
  const MAX_ACCURACY_M = 500; // position trop imprécise : ignorée
  const MAX_SIGHTINGS = 400;

  function distance(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(a));
  }

  const round = (x) => Math.round(x * 1e5) / 1e5;

  // Ajoute un passage { lat, lon, at, acc } à la liste, en oubliant ceux de plus de 48 h.
  // Deux positions proches (< 150 m) à moins de 10 min d'intervalle : on garde la plus récente.
  function addSighting(list, pos, now = Date.now()) {
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return list || [];
    if (pos.acc > MAX_ACCURACY_M) return list || [];
    const at = pos.at || new Date(now).toISOString();
    const kept = (list || []).filter((p) => now - Date.parse(p.at) < WINDOW_MS);
    const last = kept[kept.length - 1];
    if (last && distance(last.lat, last.lon, pos.lat, pos.lon) < 150 && Date.parse(at) - Date.parse(last.at) < 10 * 60 * 1000) kept.pop();
    kept.push({ lat: round(pos.lat), lon: round(pos.lon), at, ...(Number.isFinite(pos.acc) ? { acc: Math.round(pos.acc) } : {}) });
    return kept.slice(-MAX_SIGHTINGS);
  }

  // Preuve valable pour une visite à la date `at` : passage à moins de 1 km du sanctuaire
  // dans les 48 h qui précèdent (5 min de tolérance d'horloge). Le plus récent d'abord.
  function isProof(p, shrine, at) {
    if (!p || !shrine || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
    const t = Date.parse(p.at), visit = Date.parse(at);
    if (Number.isNaN(t) || Number.isNaN(visit)) return false;
    if (t > visit + 5 * 60 * 1000 || visit - t > WINDOW_MS) return false;
    return distance(p.lat, p.lon, shrine.lat, shrine.lon) <= RADIUS_M;
  }

  function findProof(list, shrine, at = new Date().toISOString()) {
    const p = [...(list || [])].reverse().find((x) => isProof(x, shrine, at));
    return p ? { lat: p.lat, lon: p.lon, at: p.at } : null;
  }

  const api = { RADIUS_M, WINDOW_MS, distance, addSighting, isProof, findProof };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JinjaProximity = api;
})(this);
