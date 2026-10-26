// Calcul de circuit : meilleur ordre de visite d'une liste de sanctuaires, puis tracé du parcours.
// Durées et tracés viennent des serveurs OSRM d'OpenStreetMap (FOSSGIS), à pied ou en voiture.
// L'ordre est calculé ici : plus proche voisin depuis chaque départ possible, puis amélioration
// « 2-opt » (inverser un morceau du parcours tant que ça raccourcit le total).
(function (root) {
  const SERVERS = {
    foot: 'https://routing.openstreetmap.de/routed-foot',
    car: 'https://routing.openstreetmap.de/routed-car',
  };
  const UNREACHABLE = 1e9;

  async function osrm(url, tries = 3) {
    for (let i = 0; i < tries; i++) {
      const res = await fetch(url);
      // OSRM répond 400 quand aucun chemin n'existe (code NoRoute, NoSegment…).
      if (res.ok || res.status === 400) {
        const data = await res.json().catch(() => null);
        if (data?.code === 'Ok') return data;
        if (data?.code) throw Object.assign(new Error(data.message || data.code), { code: data.code });
      }
      if (res.status !== 429 || i === tries - 1) throw new Error(`service d'itinéraire indisponible (${res.status})`);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }

  // Coût d'un parcours ouvert (sans retour au départ).
  function pathCost(D, path) {
    let cost = 0;
    for (let i = 1; i < path.length; i++) cost += D[path[i - 1]][path[i]];
    return cost;
  }

  function nearestNeighbor(D, start) {
    const path = [start];
    const left = new Set(D.map((_, i) => i).filter((i) => i !== start));
    while (left.size) {
      const last = path[path.length - 1];
      let best = null;
      for (const i of left) if (best === null || D[last][i] < D[last][best]) best = i;
      path.push(best);
      left.delete(best);
    }
    return path;
  }

  function twoOpt(D, path, fixedStart) {
    let best = path;
    let bestCost = pathCost(D, best);
    for (let improved = true; improved;) {
      improved = false;
      for (let i = fixedStart ? 1 : 0; i < best.length - 1; i++) {
        for (let j = i + 1; j < best.length; j++) {
          const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
          const cost = pathCost(D, candidate);
          if (cost + 1e-6 < bestCost) { best = candidate; bestCost = cost; improved = true; }
        }
      }
    }
    return best;
  }

  // D : matrice des durées (D[i][j] = trajet de i vers j). fixedStart : l'indice 0 est le départ imposé.
  function bestOrder(D, fixedStart = false) {
    const n = D.length;
    if (n <= 2) return D.map((_, i) => i);
    const starts = fixedStart ? [0] : D.map((_, i) => i);
    let best = null;
    let bestCost = Infinity;
    for (const start of starts) {
      const path = twoOpt(D, nearestNeighbor(D, start), fixedStart);
      const cost = pathCost(D, path);
      if (cost < bestCost) { best = path; bestCost = cost; }
    }
    return best;
  }

  // points : [{ lat, lon, … }]. Renvoie l'ordre retenu, le tracé GeoJSON, la distance (m),
  // la durée (s) et le détail de chaque étape.
  async function plan(points, { mode = 'foot', fixedStart = false } = {}) {
    const base = SERVERS[mode] || SERVERS.foot;
    const coords = (list) => list.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    const table = await osrm(`${base}/table/v1/driving/${coords(points)}?annotations=duration`);
    const D = table.durations.map((row) => row.map((d) => (d == null ? UNREACHABLE : d)));
    const order = bestOrder(D, fixedStart);
    const ordered = order.map((i) => points[i]);
    const { routes: [route] } = await osrm(`${base}/route/v1/driving/${coords(ordered)}?overview=full&geometries=geojson`);
    return {
      ordered,
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration,
      legs: route.legs.map((leg) => ({ distance: leg.distance, duration: leg.duration })),
    };
  }

  const api = { plan, bestOrder, pathCost, osrm, SERVERS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JinjaRoute = api;
})(this);
