// Navigation intégrée, étape par étape (portage de navigation.js du site) : position suivie
// en direct, prochaine manœuvre, recalcul quand on s'écarte du tracé, arrivée sur chaque
// sanctuaire, écran maintenu allumé. Les étapes viennent d'OSRM (steps=true), les textes
// français sont générés par navcore.js. En mode simulation, la position avance seule le long
// du tracé (avec un détour pour déclencher le recalcul).
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import JinjaRoute from '../shared/route';
import Nav from '../shared/navcore';

const { haversine, bearing, offsetPoint, project, pointAt, remainingCoords, prepareRoute, durationBetween, nextManeuver, hasArrived, createOffRouteDetector } = Nav;
const SPEED = { foot: 1.4, car: 11 }; // m/s, pour la simulation
const ROUTE_RETRY = 15000;
const KEEP_AWAKE_TAG = 'jinja-navigation';
const now = () => Date.now();

export default function useNavigation({ onFollow, onStart, onStop, onGps }) {
  const navRef = useRef(null);
  const session = useRef(0);
  const [snapshot, setSnapshot] = useState(null);
  const callbacks = useRef({ onFollow, onStart, onStop, onGps });
  callbacks.current = { onFollow, onStart, onStop, onGps };

  // ---------- Rendu : instantané lisible par l'interface ----------
  const render = useCallback(() => {
    const nav = navRef.current;
    if (!nav) { setSnapshot(null); return; }
    const snap = {
      stops: nav.stops, target: nav.target, mode: nav.mode, circuit: nav.circuit, simulate: nav.simulate,
      pos: nav.pos, following: nav.following, finished: nav.finished, fatal: nav.fatal,
      message: nav.message, arrived: nav.arrived, routing: nav.routing, remaining: null,
    };
    if (nav.route && !nav.finished) {
      const leg = Math.max(0, nav.target - nav.route.stopOffset);
      const m = nextManeuver(nav.route, nav.along, leg);
      const legEnd = nav.route.legEnds[leg] ?? nav.route.distance;
      snap.maneuver = m;
      snap.remaining = remainingCoords(nav.route.coords, nav.route.cum, nav.along);
      snap.leftToStop = Math.max(0, legEnd - nav.along);
      snap.durationToStop = durationBetween(nav.route, nav.along, legEnd);
      snap.leftTotal = Math.max(0, nav.route.distance - nav.along);
      snap.durationTotal = durationBetween(nav.route, nav.along, nav.route.distance);
    }
    setSnapshot(snap);
  }, []);

  const setMessage = (message) => { if (navRef.current) navRef.current.message = message; };

  // ---------- Arrêt ----------
  const stopTracking = (nav) => {
    nav.watch?.remove?.();
    nav.watch = null;
    clearInterval(nav.simTimer);
    nav.simTimer = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch?.(() => {});
  };

  const stop = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    stopTracking(nav);
    navRef.current = null;
    session.current++;
    render();
    callbacks.current.onStop?.();
  }, [render]);

  useEffect(() => () => { if (navRef.current) stopTracking(navRef.current); }, []);

  // ---------- Itinéraire ----------
  const requestRoute = async (reroute) => {
    const nav = navRef.current;
    if (!nav?.pos) return;
    const { id } = nav;
    const from = nav.pos.point;
    const offset = nav.target;
    const targets = nav.stops.slice(offset);
    const { mode } = nav;
    const req = nav.req = (nav.req || 0) + 1;
    nav.routing = true;
    nav.retryAt = 0;
    setMessage({ kind: 'info', text: reroute ? "Tu t'es écarté du tracé : recalcul de l'itinéraire…" : "Calcul de l'itinéraire…" });
    render();
    try {
      const coords = [from, ...targets.map((s) => [s.lon, s.lat])].map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
      const data = await JinjaRoute.osrm(`${JinjaRoute.SERVERS[mode] || JinjaRoute.SERVERS.foot}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`);
      const cur = navRef.current;
      if (!cur || cur.id !== id || cur.finished) return;
      const route = prepareRoute(data.routes[0], { origin: from, stopNames: targets.map((s) => s.name) });
      route.stopOffset = offset;
      cur.route = route;
      cur.along = project(route.coords, route.cum, cur.pos.point).along;
      cur.detector.routed(now());
      setMessage(null);
    } catch (err) {
      const cur = navRef.current;
      if (!cur || cur.id !== id) return;
      cur.detector.routed(now());
      cur.retryAt = now() + ROUTE_RETRY;
      const why = err.code === 'NoRoute' || err.code === 'NoSegment' ? "aucun chemin trouvé jusqu'au sanctuaire"
        : err instanceof TypeError ? 'pas de connexion au service' : err.message;
      setMessage({ kind: 'error', text: `Impossible de calculer l'itinéraire : ${why}. Nouvel essai dans 15 s…` });
      setTimeout(() => {
        const c = navRef.current;
        if (c && c.id === id && !c.routing && c.pos && c.retryAt && now() >= c.retryAt) requestRoute(!!c.route);
      }, ROUTE_RETRY + 100);
    } finally {
      const cur = navRef.current;
      if (cur && cur.id === id && cur.req === req) { cur.routing = false; render(); }
    }
  };

  // ---------- Arrivée ----------
  const arrive = () => {
    const nav = navRef.current;
    const s = nav.stops[nav.target];
    nav.arrived.push(s);
    nav.target++;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (nav.target >= nav.stops.length) {
      nav.finished = true;
      stopTracking(nav);
      setMessage(null);
    } else {
      setMessage({ kind: 'arrive', stop: s });
    }
  };

  // ---------- Position ----------
  const onPosition = (p) => {
    const nav = navRef.current;
    if (!nav || nav.finished) return;
    if (nav.message?.kind === 'error' && /GPS/.test(nav.message.text)) setMessage(null);
    const first = !nav.pos;
    nav.pos = p;
    if (nav.following) callbacks.current.onFollow?.(p.point, first);
    if (!nav.route) {
      if (!nav.routing && now() >= nav.retryAt) requestRoute(false);
      render();
      return;
    }
    const pr = project(nav.route.coords, nav.route.cum, p.point, nav.along);
    nav.along = pr.along;
    const stopObj = nav.stops[nav.target];
    const leg = nav.target - nav.route.stopOffset;
    const remainingOnLeg = (nav.route.legEnds[leg] ?? nav.route.distance) - nav.along;
    if (hasArrived({ distance: haversine(p.point, [stopObj.lon, stopObj.lat]), accuracy: p.accuracy, remainingOnLeg })) {
      arrive();
      if (!navRef.current || navRef.current.finished) { render(); return; }
    }
    if (nav.detector.update(pr.distance, p.accuracy, now()) && !nav.routing) requestRoute(true);
    else if (!nav.routing && nav.retryAt && now() >= nav.retryAt) requestRoute(true);
    render();
  };

  const startGps = async (nav) => {
    const { id } = nav;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (!navRef.current || navRef.current.id !== id) return;
    if (status !== 'granted') {
      nav.finished = true;
      nav.fatal = "Localisation refusée. Autorise l'accès à ta position dans Réglages › Jinja Collection, puis relance la navigation.";
      stopTracking(nav);
      render();
      return;
    }
    let previous = null;
    nav.watch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 },
      (pos) => {
        const cur = navRef.current;
        if (!cur || cur.id !== id) return;
        const c = pos.coords;
        const pt = [c.longitude, c.latitude];
        // Cap fourni par le GPS quand on bouge, sinon déduit des deux dernières positions.
        let heading = Number.isFinite(c.heading) && c.heading >= 0 && (c.speed == null || c.speed > 0.5) ? c.heading : null;
        if (heading == null && previous && haversine(previous, pt) > 5) heading = bearing(previous, pt);
        if (!previous || haversine(previous, pt) > 5) previous = pt;
        onPosition({ point: pt, accuracy: c.accuracy || 0, heading: heading ?? cur.pos?.heading ?? null });
        // Vraies positions GPS seulement (jamais la simulation) : passages près des sanctuaires.
        callbacks.current.onGps?.({ lat: c.latitude, lon: c.longitude, acc: c.accuracy });
      },
    );
    if (!navRef.current || navRef.current.id !== id) nav.watch?.remove();
  };

  // ---------- Simulation ----------
  const startSimulation = (nav, factor = 1) => {
    const { id } = nav;
    const first = nav.stops[0];
    // Départ fixe à ~300 m au sud-ouest du premier sanctuaire.
    const sim = { point: offsetPoint([first.lon, first.lat], 225, 300), route: null, along: 0, detour: null, detourDone: false, pause: 0, target: 0 };
    const emit = (heading = null) => {
      onPosition({ point: offsetPoint(sim.point, Math.random() * 360, Math.random() * 3), accuracy: 5 + Math.random() * 4, heading });
    };
    const tick = () => {
      const cur = navRef.current;
      if (!cur || cur.id !== id || cur.finished) return;
      const { route } = cur;
      if (!route || cur.routing) { emit(); return; }
      if (route !== sim.route) { sim.route = route; sim.along = project(route.coords, route.cum, sim.point).along; sim.detour = null; }
      if (cur.target !== sim.target) { sim.target = cur.target; sim.pause = 3; }
      if (sim.pause > 0) { sim.pause--; emit(); return; }
      if (sim.detour) {
        sim.detour.n++;
        sim.point = offsetPoint(sim.detour.base, sim.detour.heading, Math.min(sim.detour.n * 15, 90));
        if (sim.detour.n > 30) { sim.detour = null; sim.point = pointAt(route.coords, route.cum, sim.along).point; }
        emit(sim.detour?.heading ?? null);
        return;
      }
      sim.along = Math.min(route.distance, sim.along + (SPEED[cur.mode] || SPEED.foot) * factor);
      const at = pointAt(route.coords, route.cum, sim.along);
      sim.point = at.point;
      if (!sim.detourDone && route.distance > 150 && sim.along > Math.min(200, route.distance * 0.3)) {
        sim.detourDone = true;
        sim.detour = { base: at.point, heading: (at.heading + 90) % 360, n: 0 };
      }
      emit(at.heading);
    };
    emit();
    nav.simTimer = setInterval(tick, 1000);
  };

  // stops : [{ id, name, lat, lon }] ; mode : 'foot' | 'car' ; circuit : plusieurs étapes.
  const start = useCallback(({ stops, mode = 'foot', circuit = false, simulate = false, speed = 1 }) => {
    if (navRef.current) stop();
    const pending = stops.filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (!pending.length) return;
    const nav = {
      id: ++session.current, stops: pending, target: 0, mode, circuit, simulate,
      pos: null, along: 0, route: null, routing: false, retryAt: 0,
      following: true, finished: false, message: null, arrived: [],
      detector: createOffRouteDetector(), watch: null, simTimer: null,
    };
    navRef.current = nav;
    callbacks.current.onStart?.();
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    render();
    if (simulate) startSimulation(nav, speed); else startGps(nav);
  }, [render, stop]);

  const setFollowing = useCallback((following) => {
    const nav = navRef.current;
    if (!nav || nav.following === following) return;
    nav.following = following;
    if (following && nav.pos) callbacks.current.onFollow?.(nav.pos.point, false);
    render();
  }, [render]);

  const dismissMessage = useCallback(() => { setMessage(null); render(); }, [render]);

  return { nav: snapshot, start, stop, setFollowing, dismissMessage };
}
