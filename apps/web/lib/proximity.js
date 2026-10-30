// Vérification serveur de la règle de proximité (packages/shared/proximity.js) : chaque nouvelle visite doit
// arriver avec une position horodatée (« preuve ») à moins de 1 km du sanctuaire, prise dans
// les 48 h qui précèdent la visite. Le résultat est stocké avec la visite :
//   verified: true  → preuve valable (la position est gardée comme justificatif)
//   verified: false → pas de preuve valable : la visite reste dans la collection, marquée
//                     « non vérifiée », et ne compte pas pour « Découvert par »
//   (absent)        → visite antérieure à la règle : reste valide
// Limite : la position vient du téléphone ; un GPS falsifié passe la vérification.
const { isProof } = require('../../../packages/shared/proximity');

// Les visites datées d'avant la mise en service de la règle restent valides sans preuve.
const RULE_START = process.env.PROXIMITY_RULE_START || '2026-10-28T00:00:00Z';
// Une visite faite hors ligne doit être synchronisée dans ce délai pour être vérifiée.
const MAX_SYNC_DELAY_MS = 30 * 24 * 3600 * 1000;

let coords;
function shrineCoords(id) {
  if (!coords) {
    coords = new Map(require('../../../packages/shared/data/shrines.json').shrines.map(([sid, , , lat, lon]) => [sid, { lat, lon }]));
  }
  return coords.get(id);
}

function cleanProof(p) {
  if (!p || typeof p !== 'object') return null;
  const lat = Number(p.lat), lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof p.at !== 'string' || Number.isNaN(Date.parse(p.at))) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, at: new Date(p.at).toISOString() };
}

// Statut d'une visite reçue. `previous` : la même visite déjà enregistrée (même date) ;
// son statut est conservé, sinon une preuve vieillie ferait « dé-vérifier » la visite.
function judgeVisit(id, visit, previous, now = Date.now()) {
  if (previous && previous.date === visit.date) {
    if (previous.verified === true) return { verified: true, proof: previous.proof };
    if (previous.verified === undefined) return {};
    // Une visite non vérifiée peut l'être plus tard si une preuve valable arrive.
  }
  const t = Date.parse(visit.date);
  const proof = cleanProof(visit.proof);
  const shrine = shrineCoords(id);
  if (proof && shrine && t <= now + 5 * 60 * 1000 && now - t <= MAX_SYNC_DELAY_MS && isProof(proof, shrine, visit.date)) {
    return { verified: true, proof };
  }
  if (t < Date.parse(RULE_START)) return {};
  return { verified: false };
}

module.exports = { judgeVisit, shrineCoords, RULE_START };
