// Navigation intégrée, étape par étape, sans Google Maps : position suivie en direct,
// bandeau avec la prochaine manœuvre, recalcul quand on s'écarte du tracé, arrivée sur
// chaque sanctuaire. Les étapes viennent d'OSRM (steps=true) ; OSRM ne donne pas de texte,
// les instructions françaises sont générées ici à partir du type de manœuvre.
// Les fonctions de géométrie et de texte sont pures (testées sous Node, voir tests/).
// ?simulate=1 dans l'URL remplace le GPS par un déplacement simulé le long du tracé.
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

  // ---------- Navigateur ----------
  const SPEED = { foot: 1.4, car: 11 }; // m/s, pour la simulation
  const ROUTE_RETRY = 15000;
  let ctx = null; // fourni par app.js : { map, isVisited, markVisited, onStart, onStop, onGps }
  let nav = null;
  let session = 0;
  let ui = null;

  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const simulated = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('simulate') === '1';
  const now = () => Date.now();

  function arrowSvg(icon) {
    const svg = (body) => `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    const head = (x, y, a) => {
      const p = (da) => `${(x - 11 * Math.sin(rad(a + da))).toFixed(1)},${(y + 11 * Math.cos(rad(a + da))).toFixed(1)}`;
      return `<polyline points="${p(-40)} ${x.toFixed(1)},${y.toFixed(1)} ${p(40)}"/>`;
    };
    if (icon === 'arrive') return '<span class="nav-arrive-icon">⛩</span>';
    if (icon === 'roundabout') return svg(`<circle cx="24" cy="20" r="9"/><path d="M24 44V29"/><path d="M30.4 13.6L38 6"/>${head(38, 6, 45)}`);
    if (icon === 'uturn') return svg(`<path d="M32 44V20a8 8 0 0 0-16 0v14"/>${head(16, 36, 180)}`);
    const angles = { straight: 0, 'slight-right': 45, right: 90, 'sharp-right': 135, 'slight-left': -45, left: -90, 'sharp-left': -135 };
    const a = angles[icon] ?? 0;
    const x = 24 + 15 * Math.sin(rad(a)), y = 24 - 15 * Math.cos(rad(a));
    return svg(`<path d="M24 44V24L${x.toFixed(1)} ${y.toFixed(1)}"/>${head(x, y, a)}`);
  }

  function setup(context) { ctx = context; }
  const isActive = () => !!nav;

  // stops : [{ id, name, lat, lon }] ; mode : 'foot' | 'car' ; circuit : plusieurs étapes.
  function start({ stops, mode = 'foot', circuit = false }) {
    if (nav) stop();
    const pending = stops.filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (!pending.length) return;
    const id = ++session;
    nav = {
      id, stops: pending, target: 0, mode, circuit,
      pos: null, along: 0, route: null, routing: false, retryAt: 0,
      following: true, finished: false, message: null, arrived: [],
      detector: createOffRouteDetector(), watchId: null, simTimer: null, wakeLock: null,
      simulate: simulated(),
    };
    ctx?.onStart?.();
    buildUi();
    document.body.classList.add('navigating');
    ui.root.hidden = false;
    ui.recenter.hidden = true;
    nav.layer = L.layerGroup().addTo(ctx.map);
    drawStops();
    lockScreen();
    render();
    if (nav.simulate) startSimulation();
    else startGps();
  }

  function stop() {
    if (!nav) return;
    stopTracking();
    nav.layer?.remove();
    nav = null;
    session++;
    if (ui) ui.root.hidden = true;
    if (ui) ui.recenter.hidden = true;
    document.body.classList.remove('navigating');
    ctx?.onStop?.();
  }

  function stopTracking() {
    if (nav.watchId != null) navigator.geolocation.clearWatch(nav.watchId);
    clearInterval(nav.simTimer);
    nav.watchId = null;
    nav.simTimer = null;
    releaseScreen();
  }

  // ---------- Écran allumé ----------
  async function lockScreen() {
    if (!nav || nav.finished || nav.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!nav || nav.finished) { lock.release().catch(() => {}); return; }
      nav.wakeLock = lock;
      lock.addEventListener('release', () => { if (nav?.wakeLock === lock) nav.wakeLock = null; });
    } catch { /* non supporté ou refusé : tant pis */ }
  }
  function releaseScreen() {
    const lock = nav?.wakeLock;
    if (nav) nav.wakeLock = null;
    lock?.release().catch(() => {});
  }
  if (typeof document !== 'undefined') {
    // Le verrou est perdu quand la page passe en arrière-plan : on le reprend au retour.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lockScreen(); });
  }

  // ---------- Position ----------
  function startGps() {
    if (!navigator.geolocation || (typeof isSecureContext !== 'undefined' && !isSecureContext)) {
      fatal("La localisation n'est pas disponible sur ce navigateur : impossible de te guider.");
      return;
    }
    const id = nav.id;
    let previous = null;
    nav.watchId = navigator.geolocation.watchPosition((pos) => {
      if (!nav || nav.id !== id) return;
      const c = pos.coords;
      const point = [c.longitude, c.latitude];
      // Cap fourni par le GPS quand on bouge, sinon déduit des deux dernières positions.
      let heading = Number.isFinite(c.heading) && (c.speed == null || c.speed > 0.5) ? c.heading : null;
      if (heading == null && previous && haversine(previous, point) > 5) heading = bearing(previous, point);
      if (!previous || haversine(previous, point) > 5) previous = point;
      onPosition({ point, accuracy: c.accuracy || 0, heading: heading ?? nav.pos?.heading ?? null });
      // Vraies positions GPS seulement (jamais la simulation) : passages près des sanctuaires.
      ctx.onGps?.({ lat: c.latitude, lon: c.longitude, acc: c.accuracy });
    }, (err) => {
      if (!nav || nav.id !== id) return;
      if (err.code === 1) fatal("Localisation refusée. Autorise l'accès à ta position dans les réglages du navigateur, puis relance la navigation.");
      else setMessage('Signal GPS introuvable pour le moment… (reste à découvert si possible)', 'error');
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }

  function onPosition(p) {
    if (!nav || nav.finished) return;
    if (nav.message?.kind === 'error' && /GPS/.test(nav.message.text)) setMessage(null);
    nav.pos = p;
    drawMe();
    if (!nav.route) {
      if (!nav.routing && now() >= nav.retryAt) requestRoute(false);
      render();
      return;
    }
    const pr = project(nav.route.coords, nav.route.cum, p.point, nav.along);
    nav.along = pr.along;
    nav.offDistance = pr.distance;
    // Arrivée sur le sanctuaire visé.
    const stopObj = nav.stops[nav.target];
    const leg = nav.target - nav.route.stopOffset;
    const remainingOnLeg = (nav.route.legEnds[leg] ?? nav.route.distance) - nav.along;
    if (hasArrived({ distance: haversine(p.point, [stopObj.lon, stopObj.lat]), accuracy: p.accuracy, remainingOnLeg })) {
      arrive();
      if (!nav || nav.finished) return;
    }
    if (nav.detector.update(pr.distance, p.accuracy, now()) && !nav.routing) requestRoute(true);
    else if (!nav.routing && nav.retryAt && now() >= nav.retryAt) requestRoute(true);
    drawRemaining();
    render();
  }

  // ---------- Calcul de l'itinéraire ----------
  async function requestRoute(reroute) {
    const id = nav.id;
    const from = nav.pos.point;
    const offset = nav.target;
    const targets = nav.stops.slice(offset);
    const mode = nav.mode;
    const req = nav.req = (nav.req || 0) + 1;
    nav.routing = true;
    nav.retryAt = 0;
    setMessage(reroute ? "Tu t'es écarté du tracé : recalcul de l'itinéraire…" : "Calcul de l'itinéraire…", 'info');
    render();
    try {
      const { SERVERS, osrm } = root.JinjaRoute;
      const coords = [from, ...targets.map((s) => [s.lon, s.lat])].map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
      const data = await osrm(`${SERVERS[mode] || SERVERS.foot}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`);
      if (!nav || nav.id !== id || nav.finished) return;
      if (nav.mode !== mode) { requestRoute(false); return; }
      const route = prepareRoute(data.routes[0], { origin: from, stopNames: targets.map((s) => s.name) });
      route.stopOffset = offset;
      nav.route = route;
      nav.along = project(route.coords, route.cum, nav.pos.point).along;
      nav.detector.routed(now());
      setMessage(null);
      drawRemaining();
    } catch (err) {
      if (!nav || nav.id !== id) return;
      nav.detector.routed(now());
      nav.retryAt = now() + ROUTE_RETRY;
      const why = err.code === 'NoRoute' || err.code === 'NoSegment' ? "aucun chemin trouvé jusqu'au sanctuaire"
        : err instanceof TypeError ? 'pas de connexion au service' : err.message;
      setMessage(`Impossible de calculer l'itinéraire : ${why}. Nouvel essai dans 15 s…`, 'error');
      // Sans GPS qui bouge (immobile), on relance quand même.
      setTimeout(() => { if (nav && nav.id === id && !nav.routing && nav.pos && nav.retryAt && now() >= nav.retryAt) requestRoute(!!nav.route); }, ROUTE_RETRY + 100);
    } finally {
      if (nav && nav.id === id && nav.req === req) { nav.routing = false; render(); }
    }
  }

  // ---------- Arrivée ----------
  function arrive() {
    const s = nav.stops[nav.target];
    nav.arrived.push(s);
    nav.target++;
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
    if (nav.target >= nav.stops.length) {
      nav.finished = true;
      stopTracking();
      nav.routeLine?.remove();
      nav.routeCasing?.remove();
      setMessage(null);
    } else {
      setMessage({ kind: 'arrive', stop: s });
      drawStops();
    }
    render();
  }

  function fatal(text) {
    nav.finished = true;
    nav.fatal = text;
    stopTracking();
    render();
  }

  function setMessage(text, kind = 'info') {
    if (!nav) return;
    if (text && typeof text === 'object') nav.message = text;
    else nav.message = text ? { kind, text } : null;
  }

  // ---------- Carte ----------
  function drawMe() {
    const { point, accuracy, heading } = nav.pos;
    const ll = [point[1], point[0]];
    if (!nav.me) {
      const icon = L.divIcon({ className: 'nav-me-icon', html: '<div class="nav-me"><div class="nav-me-cone"></div><div class="nav-me-dot"></div></div>', iconSize: [64, 64], iconAnchor: [32, 32] });
      nav.accuracyCircle = L.circle(ll, { radius: accuracy, interactive: false, stroke: false, fillColor: '#2f7cf6', fillOpacity: 0.12 }).addTo(nav.layer);
      nav.me = L.marker(ll, { icon, interactive: false, keyboard: false, zIndexOffset: 3000 }).addTo(nav.layer);
      ctx.map.setView(ll, Math.max(ctx.map.getZoom(), 17));
    } else {
      nav.me.setLatLng(ll);
      nav.accuracyCircle.setLatLng(ll).setRadius(accuracy);
      if (nav.following) ctx.map.panTo(ll, { animate: true, duration: 0.6 });
    }
    const el = nav.me.getElement()?.querySelector('.nav-me');
    if (el) {
      el.classList.toggle('no-heading', heading == null);
      if (heading != null) el.querySelector('.nav-me-cone').style.transform = `rotate(${heading}deg)`;
    }
  }

  function drawRemaining() {
    if (!nav.route) return;
    const latlngs = remainingCoords(nav.route.coords, nav.route.cum, nav.along).map(([lon, lat]) => [lat, lon]);
    if (!nav.routeLine) {
      nav.routeCasing = L.polyline(latlngs, { color: '#fff', weight: 9, opacity: 0.9, lineCap: 'round', interactive: false }).addTo(nav.layer);
      nav.routeLine = L.polyline(latlngs, { color: '#4f6e55', weight: 6, opacity: 0.9, lineCap: 'round', interactive: false }).addTo(nav.layer);
    } else {
      nav.routeCasing.setLatLngs(latlngs);
      nav.routeLine.setLatLngs(latlngs);
    }
    nav.routeLine.setStyle({ dashArray: nav.mode === 'foot' ? '2 10' : null });
  }

  function drawStops() {
    nav.pins?.forEach((m) => m.remove());
    nav.pins = nav.stops.map((s, i) => {
      if (i < nav.target) return null;
      const label = nav.circuit ? String(i + 1) : '⛩';
      const icon = L.divIcon({ className: 'route-pin', html: `<span>${label}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      return L.marker([s.lat, s.lon], { icon, zIndexOffset: 2000, title: s.name, interactive: false }).addTo(nav.layer);
    }).filter(Boolean);
  }

  // ---------- Simulation (?simulate=1) ----------
  // La position avance le long du tracé à la vitesse de marche (ou de voiture), avec un léger
  // bruit, et fait une fois un détour pour déclencher le recalcul. &vitesse=5 accélère.
  function startSimulation() {
    const id = nav.id;
    const factor = Math.max(0.1, Number(new URLSearchParams(location.search).get('vitesse')) || 1);
    const first = nav.stops[0];
    // Départ fixe à ~300 m au sud-ouest du premier sanctuaire, sauf si la vraie position est proche.
    const fallback = offsetPoint([first.lon, first.lat], 225, 300);
    const sim = { point: fallback, route: null, along: 0, detour: null, detourDone: false, pause: 0, target: 0 };
    const begin = (point) => {
      if (!nav || nav.id !== id) return;
      sim.point = point;
      emit();
      nav.simTimer = setInterval(tick, 1000);
    };
    const emit = (heading = null) => {
      const noisy = offsetPoint(sim.point, Math.random() * 360, Math.random() * 3);
      onPosition({ point: noisy, accuracy: 5 + Math.random() * 4, heading });
    };
    const tick = () => {
      if (!nav || nav.id !== id || nav.finished) return;
      const route = nav.route;
      if (!route || nav.routing) { emit(); return; }
      if (route !== sim.route) {
        // Nouveau tracé (départ ou recalcul) : on le suit depuis la position actuelle.
        sim.route = route;
        sim.along = project(route.coords, route.cum, sim.point).along;
        sim.detour = null;
      }
      if (nav.target !== sim.target) { sim.target = nav.target; sim.pause = 3; }
      if (sim.pause > 0) { sim.pause--; emit(); return; }
      if (sim.detour) {
        sim.detour.n++;
        sim.point = offsetPoint(sim.detour.base, sim.detour.heading, Math.min(sim.detour.n * 15, 90));
        // On reste à l'écart jusqu'au recalcul (au plus 15 s après le précédent), puis on suit le nouveau tracé.
        if (sim.detour.n > 30) { sim.detour = null; sim.point = pointAt(route.coords, route.cum, sim.along).point; }
        emit(sim.detour?.heading ?? null);
        return;
      }
      sim.along = Math.min(route.distance, sim.along + (SPEED[nav.mode] || SPEED.foot) * factor);
      const at = pointAt(route.coords, route.cum, sim.along);
      sim.point = at.point;
      if (!sim.detourDone && route.distance > 150 && sim.along > Math.min(200, route.distance * 0.3)) {
        sim.detourDone = true;
        sim.detour = { base: at.point, heading: (at.heading + 90) % 360, n: 0 };
      }
      emit(at.heading);
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const real = [pos.coords.longitude, pos.coords.latitude];
          begin(haversine(real, [first.lon, first.lat]) < 30000 ? real : fallback);
        },
        () => begin(fallback),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 60000 },
      );
    } else begin(fallback);
  }

  // ---------- Bandeau ----------
  function buildUi() {
    if (ui) return;
    const root = document.createElement('div');
    root.className = 'nav-ui';
    root.hidden = true;
    root.innerHTML = `
      <div class="nav-banner" role="status" aria-live="polite">
        <div class="nav-main">
          <div class="nav-arrow" data-nav-arrow></div>
          <div class="nav-text">
            <div class="nav-dist" data-nav-dist></div>
            <div class="nav-instr" data-nav-instr></div>
            <div class="nav-sub" data-nav-sub></div>
          </div>
        </div>
        <div class="nav-msg" data-nav-msg hidden></div>
        <div class="nav-foot">
          <div class="nav-eta" data-nav-eta></div>
          <div class="nav-modes" role="group" aria-label="Mode de déplacement">
            <button type="button" data-nav-mode="foot" title="À pied">🚶</button>
            <button type="button" data-nav-mode="car" title="En voiture">🚗</button>
          </div>
          <button type="button" class="nav-stop" data-nav="stop">Arrêter</button>
        </div>
      </div>`;
    const recenter = document.createElement('button');
    recenter.type = 'button';
    recenter.className = 'nav-recenter';
    recenter.hidden = true;
    recenter.innerHTML = '<span aria-hidden="true">◎</span> Recentrer';
    document.body.append(root, recenter);
    ui = {
      root, recenter,
      banner: root.querySelector('.nav-banner'),
      arrow: root.querySelector('[data-nav-arrow]'),
      dist: root.querySelector('[data-nav-dist]'),
      instr: root.querySelector('[data-nav-instr]'),
      sub: root.querySelector('[data-nav-sub]'),
      msg: root.querySelector('[data-nav-msg]'),
      eta: root.querySelector('[data-nav-eta]'),
    };
    root.addEventListener('click', onUiClick);
    recenter.addEventListener('click', () => {
      if (!nav) return;
      nav.following = true;
      recenter.hidden = true;
      if (nav.pos) ctx.map.setView([nav.pos.point[1], nav.pos.point[0]], Math.max(ctx.map.getZoom(), 16));
    });
    // Déplacer la carte à la main suspend le suivi : un bouton permet de recentrer.
    ctx.map.on('dragstart', () => {
      if (!nav || nav.finished) return;
      nav.following = false;
      ui.recenter.hidden = false;
    });
    // Les boutons de la carte (zoom, localisation) passent sous le bandeau.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => document.documentElement.style.setProperty('--nav-h', `${ui.banner.offsetHeight}px`)).observe(ui.banner);
    }
  }

  function onUiClick(e) {
    if (!nav) return;
    const modeBtn = e.target.closest('[data-nav-mode]');
    if (modeBtn) {
      const mode = modeBtn.dataset.navMode;
      if (mode === nav.mode || nav.finished) return;
      nav.mode = mode;
      if (nav.pos && !nav.routing) requestRoute(false);
      else nav.route = null;
      render();
      return;
    }
    const action = e.target.closest('[data-nav]')?.dataset.nav;
    if (action === 'stop') stop();
    else if (action === 'visit') {
      const id = e.target.closest('[data-nav]').dataset.id;
      ctx.markVisited(id);
      render();
    } else if (action === 'dismiss') { setMessage(null); render(); }
  }

  function clock(sec) {
    return new Date(now() + sec * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDuration(sec) {
    const min = Math.max(1, Math.round(sec / 60));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }

  const visitButton = (s) => (ctx.isVisited(s.id)
    ? '<span class="nav-visited">✓ Dans tes visites</span>'
    : `<button type="button" class="nav-visit" data-nav="visit" data-id="${escHtml(s.id)}">J'y suis allé ⛩</button>`);

  function render() {
    if (!nav || !ui) return;
    ui.root.querySelectorAll('[data-nav-mode]').forEach((b) => b.classList.toggle('on', b.dataset.navMode === nav.mode));
    ui.root.classList.toggle('finished', nav.finished);
    ui.root.classList.toggle('simulated', nav.simulate);
    const target = nav.stops[nav.target];

    // Ligne principale.
    let arrow = '', dist = '', instr = '', sub = '';
    if (nav.fatal) {
      arrow = '<span class="nav-arrive-icon">!</span>'; instr = 'Navigation impossible'; sub = nav.fatal;
    } else if (nav.finished) {
      const last = nav.arrived[nav.arrived.length - 1];
      arrow = arrowSvg('arrive');
      instr = nav.circuit ? 'Circuit terminé !' : `Tu es arrivé à ${last.name}`;
      sub = nav.circuit ? `${nav.arrived.length} sanctuaire${nav.arrived.length > 1 ? 's' : ''} sur ton chemin. Otsukaresama ! 🎉` : 'Bonne visite !';
    } else if (!nav.pos) {
      arrow = '<span class="nav-wait"></span>'; instr = nav.simulate ? 'Simulation : préparation du départ…' : 'Recherche de ta position…';
    } else if (!nav.route) {
      arrow = '<span class="nav-wait"></span>'; instr = "Calcul de l'itinéraire…";
    } else {
      const m = nextManeuver(nav.route, nav.along, nav.target - nav.route.stopOffset);
      arrow = arrowSvg(m.next.icon);
      dist = fmtNavDistance(m.distance);
      instr = m.next.text;
      if (m.current.type === 'depart' && m.current.leg === 0 && nav.along < 30) sub = m.current.text;
      else if (m.then) sub = `Puis : ${lcFirst(m.then.text)}`;
    }
    ui.arrow.innerHTML = arrow;
    ui.dist.textContent = dist;
    ui.dist.hidden = !dist;
    ui.instr.textContent = instr;
    ui.sub.textContent = sub;
    ui.sub.hidden = !sub;

    // Message (recalcul, erreur, arrivée).
    const msg = nav.message;
    let msgHtml = '';
    let msgKind = '';
    if (nav.finished && !nav.fatal) {
      msgKind = 'arrive';
      const todo = nav.arrived.filter((s) => !ctx.isVisited(s.id));
      msgHtml = todo.length
        ? `<span class="nav-msg-text">Coche ta visite pour obtenir la carte postale :</span>${todo.map((s) => `<span class="nav-msg-stop">${escHtml(s.name)} ${visitButton(s)}</span>`).join('')}`
        : '<span class="nav-msg-text">✓ Visite enregistrée dans ta collection.</span>';
      msgHtml += '<button type="button" class="nav-done" data-nav="stop">Terminer</button>';
    } else if (nav.fatal) {
      msgKind = 'error';
      msgHtml = '<button type="button" class="nav-done" data-nav="stop">Fermer</button>';
    } else if (msg?.kind === 'arrive') {
      msgKind = 'arrive';
      msgHtml = `<span class="nav-msg-text">⛩ Arrivé à <b>${escHtml(msg.stop.name)}</b></span>${visitButton(msg.stop)}
        <button type="button" class="nav-msg-close" data-nav="dismiss" aria-label="Masquer">✕</button>`;
    } else if (msg) {
      msgKind = msg.kind;
      msgHtml = `<span class="nav-msg-text">${escHtml(msg.text)}</span>`;
    }
    ui.msg.hidden = !msgHtml;
    ui.msg.className = `nav-msg ${msgKind}`;
    if (ui.msg.innerHTML !== msgHtml) ui.msg.innerHTML = msgHtml;

    // Pied : arrivée prévue, temps et distance restants jusqu'au prochain sanctuaire.
    let eta = '';
    if (!nav.finished && target) {
      const label = nav.circuit ? `Étape ${nav.target + 1}/${nav.stops.length} · ${escHtml(target.name)}` : escHtml(target.name);
      if (nav.route) {
        const end = nav.route.legEnds[nav.target - nav.route.stopOffset] ?? nav.route.distance;
        const left = Math.max(0, end - nav.along);
        const secs = durationBetween(nav.route, nav.along, end);
        eta = `<div class="nav-eta-main"><strong>${clock(secs)}</strong> <span>${fmtDuration(secs)} · ${fmtNavDistance(left)}</span></div>`;
        if (nav.circuit && nav.target < nav.stops.length - 1) {
          const total = Math.max(0, nav.route.distance - nav.along);
          eta += `<div class="nav-eta-sub">Fin du circuit vers ${clock(durationBetween(nav.route, nav.along, nav.route.distance))} · ${fmtNavDistance(total)}</div>`;
        }
      }
      eta += `<div class="nav-eta-target">${label}${nav.simulate ? ' <em>· simulation</em>' : ''}</div>`;
    } else if (nav.simulate) eta = '<div class="nav-eta-target"><em>simulation</em></div>';
    ui.eta.innerHTML = eta;
  }

  const api = {
    haversine, bearing, offsetPoint, cumulative, project, pointAt, remainingCoords,
    instructionText, maneuverIcon, fmtNavDistance, prepareRoute, durationBetween, nextManeuver,
    hasArrived, createOffRouteDetector,
    setup, start, stop, isActive,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JinjaNav = api;
})(this);
