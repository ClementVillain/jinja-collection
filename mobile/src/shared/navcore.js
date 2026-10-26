// Fonctions pures de la navigation (géométrie, textes d'instruction, progression),
// reprises de navigation.js du site web : même logique, mêmes résultats.
(function (root) {
  // ---------- Géométrie ----------
  // Points en [lon, lat] (ordre GeoJSON), distances en mètres.
  const EARTH = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  function haversine(a, b) {
    const dLat = rad(b[1] - a[1]);
    const dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Cap de a vers b, en degrés (0 = nord, 90 = est).
  function bearing(a, b) {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  // Point à `meters` de p dans la direction `heading` (approximation locale, suffisante à quelques km).
  function offsetPoint(p, heading, meters) {
    const dLat = (meters * Math.cos(rad(heading))) / EARTH;
    const dLon = (meters * Math.sin(rad(heading))) / (EARTH * Math.cos(rad(p[1])));
    return [p[0] + deg(dLon), p[1] + deg(dLat)];
  }

  // Distances cumulées le long d'une polyligne.
  function cumulative(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    return cum;
  }

  // Projection de p sur le segment [a, b], dans un repère plan local centré sur p.
  function projectOnSegment(p, a, b) {
    const k = Math.cos(rad(p[1]));
    const ax = rad(a[0] - p[0]) * k * EARTH, ay = rad(a[1] - p[1]) * EARTH;
    const bx = rad(b[0] - p[0]) * k * EARTH, by = rad(b[1] - p[1]) * EARTH;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    return { t, distance: Math.hypot(ax + t * dx, ay + t * dy) };
  }

  // Point le plus proche de p sur la polyligne : distance au tracé et position le long du tracé.
  // `near` (facultatif) limite la recherche autour d'une position déjà connue, pour ne pas sauter
  // sur un autre passage du tracé (aller-retour, boucle) ; on cherche partout si rien n'est proche.
  function project(coords, cum, p, near = null) {
    let best = null;
    const scan = (lo, hi) => {
      for (let i = 0; i < coords.length - 1; i++) {
        if (cum[i + 1] < lo || cum[i] > hi) continue;
        const { t, distance } = projectOnSegment(p, coords[i], coords[i + 1]);
        if (!best || distance < best.distance - 0.01) {
          best = { distance, along: cum[i] + t * (cum[i + 1] - cum[i]), index: i };
        }
      }
    };
    if (coords.length < 2) return { distance: coords.length ? haversine(p, coords[0]) : Infinity, along: 0, index: 0 };
    if (near != null) scan(near - 100, near + 1000);
    if (!best || best.distance > 60) scan(-Infinity, Infinity);
    return best;
  }

  // Position (et cap) à la distance `along` du début du tracé.
  function pointAt(coords, cum, along) {
    if (coords.length < 2) return { point: coords[0], heading: 0, index: 0 };
    const s = Math.max(0, Math.min(along, cum[cum.length - 1]));
    let i = 0;
    while (i < coords.length - 2 && cum[i + 1] < s) i++;
    const seg = cum[i + 1] - cum[i];
    const t = seg ? (s - cum[i]) / seg : 0;
    const a = coords[i], b = coords[i + 1];
    return { point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], heading: bearing(a, b), index: i };
  }

  // Partie du tracé qui reste à parcourir depuis `along`.
  function remainingCoords(coords, cum, along) {
    const { point, index } = pointAt(coords, cum, along);
    return [point, ...coords.slice(index + 1)];
  }

  // ---------- Texte des instructions ----------
  const DIRECTION = {
    uturn: 'demi-tour',
    'sharp right': 'franchement à droite',
    right: 'à droite',
    'slight right': 'légèrement à droite',
    straight: 'tout droit',
    'slight left': 'légèrement à gauche',
    left: 'à gauche',
    'sharp left': 'franchement à gauche',
  };
  const CARDINALS = ['le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest'];
  const cardinal = (b) => CARDINALS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
  const ordinal = (n) => (n === 1 ? '1re' : `${n}e`);
  const lcFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  const side = (mod = '') => (mod.includes('left') ? 'gauche' : mod.includes('right') ? 'droite' : '');

  function wayName(step) {
    const name = (step.name || '').trim();
    const ref = (step.ref || '').trim();
    if (name && ref && !name.includes(ref)) return `${name} (${ref})`;
    return name || ref;
  }
  const onto = (step) => (wayName(step) ? ` sur ${wayName(step)}` : '');
  const toward = (step) => (step.destinations ? ` en direction de ${step.destinations}` : onto(step));

  function turn(mod) {
    if (mod === 'uturn') return 'Faites demi-tour';
    if (!mod || mod === 'straight') return 'Continuez tout droit';
    return `Tournez ${DIRECTION[mod] || ''}`.trim();
  }

  // step : étape OSRM ({ maneuver: { type, modifier, exit, bearing_after }, name, ref, … }).
  // stopName : nom du sanctuaire pour l'arrivée.
  function instructionText(step, { stopName = '' } = {}) {
    const m = step.maneuver || {};
    const mod = m.modifier;
    const s = side(mod);
    const where = s ? ` à ${s}` : '';
    switch (m.type) {
      case 'depart':
        return `Partez vers ${cardinal(m.bearing_after || 0)}${onto(step)}`;
      case 'arrive': {
        const name = stopName || 'destination';
        return s ? `Arrivée : ${name}, sur votre ${s}` : `Arrivée : ${name}`;
      }
      case 'turn':
        return turn(mod) + onto(step);
      case 'new name':
        if (!wayName(step)) return 'Continuez tout droit';
        return `Continuez${mod && mod !== 'straight' ? ' ' + DIRECTION[mod] : ''} sur ${wayName(step)}`;
      case 'continue':
        if (!mod || mod === 'straight') return 'Continuez tout droit' + onto(step);
        if (mod === 'uturn') return 'Faites demi-tour' + onto(step);
        return turn(mod) + (wayName(step) ? ` pour rester sur ${wayName(step)}` : '');
      case 'merge':
        return `Insérez-vous${where}${onto(step)}`;
      case 'on ramp':
        return `Prenez la bretelle${where}${toward(step)}`;
      case 'off ramp':
        return `Prenez la sortie${where}${toward(step)}`;
      case 'fork':
        return s ? `À l'embranchement, restez à ${s}${onto(step)}` : `À l'embranchement, continuez tout droit${onto(step)}`;
      case 'end of road':
        return `Au bout de la route, ${lcFirst(turn(mod))}${onto(step)}`;
      case 'roundabout':
      case 'rotary': {
        const at = step.rotary_name ? `Au rond-point ${step.rotary_name}` : 'Au rond-point';
        return m.exit ? `${at}, prenez la ${ordinal(m.exit)} sortie${onto(step)}` : `Entrez dans le rond-point${onto(step)}`;
      }
      case 'roundabout turn':
        return `Au rond-point, ${lcFirst(turn(mod))}${onto(step)}`;
      case 'exit roundabout':
      case 'exit rotary':
        return `Sortez du rond-point${onto(step)}`;
      default:
        // « notification » et types inconnus : on se fie à la direction.
        if (mod && mod !== 'straight') return turn(mod) + onto(step);
        return wayName(step) ? `Continuez sur ${wayName(step)}` : 'Continuez tout droit';
    }
  }

  // Pictogramme de la manœuvre (voir arrowSvg).
  function maneuverIcon(step) {
    const { type, modifier } = step.maneuver || {};
    if (type === 'arrive') return 'arrive';
    if (/roundabout|rotary/.test(type || '')) return 'roundabout';
    if (type === 'depart' || !modifier) return 'straight';
    return modifier.replace(' ', '-');
  }

  // Distance affichée dans le bandeau : arrondie davantage quand elle est grande.
  function fmtNavDistance(m) {
    if (m < 1000) {
      const step = m < 100 ? 5 : m < 300 ? 10 : 50;
      return `${Math.max(0, Math.round(m / step) * step)} m`;
    }
    return `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;
  }

  // ---------- Itinéraire préparé ----------
  // osrmRoute : route OSRM (overview=full, geometries=geojson, steps=true).
  // origin : position de départ [lon, lat] (raccordée au tracé s'il commence plus loin).
  // stopNames : nom du sanctuaire au bout de chaque tronçon (leg).
  function prepareRoute(osrmRoute, { origin = null, stopNames = [] } = {}) {
    let coords = osrmRoute.geometry.coordinates.slice();
    if (origin && coords.length && haversine(origin, coords[0]) > 3) coords = [origin, ...coords];
    const cum = cumulative(coords);
    const steps = [];
    const legEnds = [];
    let from = 0;
    osrmRoute.legs.forEach((leg, li) => {
      for (const raw of leg.steps) {
        const loc = raw.maneuver.location;
        // Les manœuvres tombent sur des sommets du tracé : on prend le premier qui colle,
        // en avançant toujours (le tracé peut repasser au même endroit).
        let hit = null, best = null;
        for (let i = from; i < coords.length - 1 && !hit; i++) {
          const { t, distance } = projectOnSegment(loc, coords[i], coords[i + 1]);
          const cand = { i, along: cum[i] + t * (cum[i + 1] - cum[i]), distance };
          if (distance < 2) hit = cand;
          else if (!best || distance < best.distance) best = cand;
        }
        const found = hit || best || { i: from, along: cum[from] };
        const prev = steps.length ? steps[steps.length - 1].along : 0;
        from = found.i;
        steps.push({
          leg: li,
          type: raw.maneuver.type,
          modifier: raw.maneuver.modifier,
          along: Math.max(prev, found.along),
          distance: raw.distance,
          duration: raw.duration,
          text: instructionText(raw, { stopName: stopNames[li] }),
          icon: maneuverIcon(raw),
        });
      }
      legEnds.push(steps[steps.length - 1].along);
    });
    legEnds[legEnds.length - 1] = cum[cum.length - 1];
    if (steps.length) steps[steps.length - 1].along = cum[cum.length - 1];
    return { coords, cum, steps, legEnds, distance: cum[cum.length - 1], duration: osrmRoute.duration };
  }

  // Durée estimée entre deux positions le long du tracé (au prorata de chaque étape).
  function durationBetween(route, from, to) {
    let total = 0;
    route.steps.forEach((s, i) => {
      const end = i + 1 < route.steps.length ? route.steps[i + 1].along : route.distance;
      const len = end - s.along;
      if (len <= 0) return;
      const overlap = Math.min(end, to) - Math.max(s.along, from);
      if (overlap > 0) total += (s.duration || 0) * (overlap / len);
    });
    return total;
  }

  // Où en est-on : prochaine manœuvre, distance avant elle, et celle d'après si elle suit de près.
  // fromLeg : premier tronçon encore à faire (un sanctuaire atteint un peu avant le bout de son
  // tronçon ne doit plus être annoncé).
  function nextManeuver(route, along, fromLeg = 0) {
    const steps = route.steps;
    let cur = 0;
    for (let i = 0; i < steps.length; i++) if (steps[i].along <= along + 1) cur = i;
    const after = (i) => {
      for (let j = i + 1; j < steps.length; j++) if (steps[j].type !== 'depart' && steps[j].leg >= fromLeg) return j;
      return -1;
    };
    const n = after(cur);
    const next = n >= 0 ? steps[n] : steps[steps.length - 1];
    const t = n >= 0 ? after(n) : -1;
    const then = t >= 0 && steps[t].along - next.along < 150 ? steps[t] : null;
    return { current: steps[cur], next, distance: Math.max(0, next.along - along), then };
  }

  // Arrivée sur un sanctuaire : à moins de ~30 m (un peu plus si le GPS est imprécis),
  // au bout du tronçon quand le sanctuaire est un peu à l'écart de la route, ou déjà dépassé
  // le long du tracé (positions espacées, en voiture).
  function hasArrived({ distance, accuracy = 0, remainingOnLeg = Infinity }) {
    const radius = 30 + Math.min(Math.max(accuracy, 0), 40) / 2;
    return distance <= radius || (remainingOnLeg <= 25 && distance <= 150) || remainingOnLeg < -30;
  }

  // Écart au tracé : au moins `needed` positions successives trop loin du tracé (marge selon la
  // précision GPS), et au plus un recalcul toutes les `minInterval` ms.
  function createOffRouteDetector({ threshold = 40, needed = 2, minInterval = 15000 } = {}) {
    let count = 0;
    let last = -Infinity;
    const tolerance = (accuracy = 0) => threshold + Math.min(Math.max(accuracy, 0), 60) / 2;
    return {
      tolerance,
      update(distance, accuracy, now) {
        if (accuracy > 100) return false; // position trop imprécise : ignorée
        count = distance > tolerance(accuracy) ? count + 1 : 0;
        if (count >= needed && now - last >= minInterval) { count = 0; last = now; return true; }
        return false;
      },
      routed(now) { count = 0; last = now; },
      get count() { return count; },
    };
  }

  module.exports = {
    haversine, bearing, offsetPoint, cumulative, project, pointAt, remainingCoords,
    instructionText, maneuverIcon, fmtNavDistance, prepareRoute, durationBetween, nextManeuver,
    hasArrived, createOffRouteDetector,
  };
})(this);
