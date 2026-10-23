// Tests des fonctions pures de navigation.js : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const nav = require('../navigation.js');

const step = (type, modifier, name = '', extra = {}) => ({ maneuver: { type, modifier, ...extra }, name, ...extra.step });

test('distance entre deux points (haversine)', () => {
  // Meiji-jingū → Hie-jinja : ~3,65 km à vol d'oiseau.
  const d = nav.haversine([139.69948, 35.67505], [139.73993, 35.67465]);
  assert.ok(d > 3600 && d < 3700, d);
  assert.equal(Math.round(nav.bearing([139.7, 35.6], [139.7, 35.7])), 0);
  assert.equal(Math.round(nav.bearing([139.7, 35.6], [139.8, 35.6])), 90);
});

test('distance point–polyligne et progression le long du tracé', () => {
  const start = [139.7, 35.68];
  const east = nav.offsetPoint(start, 90, 200);
  const corner = nav.offsetPoint(east, 0, 100);
  const coords = [start, east, corner];
  const cum = nav.cumulative(coords);
  assert.ok(Math.abs(cum[2] - 300) < 0.5);
  // 30 m au sud du milieu du premier segment.
  const p = nav.offsetPoint(nav.offsetPoint(start, 90, 100), 180, 30);
  const pr = nav.project(coords, cum, p);
  assert.ok(Math.abs(pr.distance - 30) < 0.5, pr.distance);
  assert.ok(Math.abs(pr.along - 100) < 0.5, pr.along);
  // Au-delà de l'extrémité : distance au dernier point.
  const beyond = nav.offsetPoint(corner, 0, 50);
  const pb = nav.project(coords, cum, beyond);
  assert.ok(Math.abs(pb.distance - 50) < 0.5);
  assert.ok(Math.abs(pb.along - 300) < 0.5);
  // Position le long du tracé et reste à parcourir.
  const at = nav.pointAt(coords, cum, 250);
  assert.ok(nav.haversine(at.point, nav.offsetPoint(east, 0, 50)) < 0.5);
  assert.equal(Math.round(at.heading), 0);
  const rest = nav.remainingCoords(coords, cum, 250);
  assert.equal(rest.length, 2);
  assert.deepEqual(rest[1], corner);
});

test('projection : reste près de la position connue sur un aller-retour', () => {
  const a = [139.7, 35.68];
  const b = nav.offsetPoint(a, 90, 300);
  const coords = [a, b, nav.offsetPoint(a, 90, 2)]; // aller puis retour par la même rue
  const cum = nav.cumulative(coords);
  const p = nav.offsetPoint(a, 90, 100);
  assert.ok(nav.project(coords, cum, p, 80).along < 150);
  assert.ok(nav.project(coords, cum, p, 480).along > 450);
});

test('textes des instructions en français', () => {
  const t = (s, o) => nav.instructionText(s, o);
  assert.equal(t(step('depart', undefined, '表参道', { bearing_after: 92 })), "Partez vers l'est sur 表参道");
  assert.equal(t(step('depart', undefined, '', { bearing_after: 0 })), 'Partez vers le nord');
  assert.equal(t(step('turn', 'left', '本町通り')), 'Tournez à gauche sur 本町通り');
  assert.equal(t(step('turn', 'sharp right', '')), 'Tournez franchement à droite');
  assert.equal(t(step('turn', 'slight left', '外堀通り')), 'Tournez légèrement à gauche sur 外堀通り');
  assert.equal(t(step('turn', 'uturn', '')), 'Faites demi-tour');
  assert.equal(t(step('turn', 'straight', '青山通り')), 'Continuez tout droit sur 青山通り');
  assert.equal(t(step('new name', 'straight', '六本木通り')), 'Continuez sur 六本木通り');
  assert.equal(t(step('new name', 'straight', '')), 'Continuez tout droit');
  assert.equal(t(step('continue', 'straight', '')), 'Continuez tout droit');
  assert.equal(t(step('continue', 'slight right', '国道246号')), 'Tournez légèrement à droite pour rester sur 国道246号');
  assert.equal(t(step('merge', 'slight left', '首都高速')), 'Insérez-vous à gauche sur 首都高速');
  assert.equal(t({ maneuver: { type: 'on ramp', modifier: 'right' }, name: '', destinations: '新宿' }), 'Prenez la bretelle à droite en direction de 新宿');
  assert.equal(t(step('off ramp', 'left', '')), 'Prenez la sortie à gauche');
  assert.equal(t(step('fork', 'slight right', '')), "À l'embranchement, restez à droite");
  assert.equal(t(step('fork', 'straight', '')), "À l'embranchement, continuez tout droit");
  assert.equal(t(step('end of road', 'left', '山手通り')), 'Au bout de la route, tournez à gauche sur 山手通り');
  assert.equal(t(step('roundabout', 'right', '駅前通り', { exit: 2 })), 'Au rond-point, prenez la 2e sortie sur 駅前通り');
  assert.equal(t(step('roundabout', 'right', '', { exit: 1 })), 'Au rond-point, prenez la 1re sortie');
  assert.equal(t({ maneuver: { type: 'rotary', exit: 3 }, name: '', rotary_name: '渋谷ロータリー' }), 'Au rond-point 渋谷ロータリー, prenez la 3e sortie');
  assert.equal(t(step('roundabout turn', 'left', '')), 'Au rond-point, tournez à gauche');
  assert.equal(t(step('exit roundabout', 'right', '中央通り')), 'Sortez du rond-point sur 中央通り');
  assert.equal(t(step('arrive', 'left', ''), { stopName: '日枝神社' }), 'Arrivée : 日枝神社, sur votre gauche');
  assert.equal(t(step('arrive', undefined, ''), { stopName: '日枝神社' }), 'Arrivée : 日枝神社');
  assert.equal(t(step('notification', 'right', 'X')), 'Tournez à droite sur X');
  assert.equal(t({ maneuver: { type: 'turn', modifier: 'left' }, name: '', ref: 'R20' }), 'Tournez à gauche sur R20');
  assert.equal(t({ maneuver: { type: 'turn', modifier: 'left' }, name: '甲州街道', ref: '20' }), 'Tournez à gauche sur 甲州街道 (20)');
});

test('pictogrammes et distances affichées', () => {
  assert.equal(nav.maneuverIcon(step('turn', 'slight left')), 'slight-left');
  assert.equal(nav.maneuverIcon(step('roundabout', 'right', '', { exit: 2 })), 'roundabout');
  assert.equal(nav.maneuverIcon(step('arrive')), 'arrive');
  assert.equal(nav.maneuverIcon(step('depart')), 'straight');
  assert.equal(nav.fmtNavDistance(42), '40 m');
  assert.equal(nav.fmtNavDistance(237), '240 m');
  assert.equal(nav.fmtNavDistance(640), '650 m');
  assert.equal(nav.fmtNavDistance(1530), '1,5 km');
  assert.equal(nav.fmtNavDistance(12400), '12 km');
});

// Tracé en L avec deux tronçons (circuit à 2 sanctuaires), au format OSRM v5.
function fixture() {
  const A = [139.7, 35.68];
  const B = nav.offsetPoint(A, 90, 200); // virage à gauche
  const C = nav.offsetPoint(B, 0, 150); // 1er sanctuaire
  const D = nav.offsetPoint(C, 0, 100); // 2e sanctuaire
  const coords = [A, nav.offsetPoint(A, 90, 100), B, C, D];
  const route = {
    distance: 450, duration: 324,
    geometry: { type: 'LineString', coordinates: coords },
    legs: [
      { distance: 350, duration: 252, steps: [
        { maneuver: { type: 'depart', location: A, bearing_after: 90 }, name: '本町通り', distance: 200, duration: 144 },
        { maneuver: { type: 'turn', modifier: 'left', location: B }, name: '外苑西通り', distance: 150, duration: 108 },
        { maneuver: { type: 'arrive', modifier: 'right', location: C }, name: '外苑西通り', distance: 0, duration: 0 },
      ] },
      { distance: 100, duration: 72, steps: [
        { maneuver: { type: 'depart', location: C, bearing_after: 0 }, name: '外苑西通り', distance: 100, duration: 72 },
        { maneuver: { type: 'arrive', location: D }, name: '外苑西通り', distance: 0, duration: 0 },
      ] },
    ],
  };
  return { A, B, C, D, route };
}

test('itinéraire préparé : position des manœuvres et fins de tronçon', () => {
  const { A, route } = fixture();
  const origin = nav.offsetPoint(A, 180, 20); // départ 20 m à côté de la route
  const r = nav.prepareRoute(route, { origin, stopNames: ['乃木神社', '日枝神社'] });
  assert.equal(r.coords.length, 6, 'raccord depuis la position de départ');
  assert.ok(Math.abs(r.distance - 470) < 1);
  assert.deepEqual(r.steps.map((s) => Math.round(s.along)), [20, 220, 370, 370, 470]);
  assert.deepEqual(r.legEnds.map(Math.round), [370, 470]);
  assert.equal(r.steps[1].text, 'Tournez à gauche sur 外苑西通り');
  assert.equal(r.steps[2].text, 'Arrivée : 乃木神社, sur votre droite');
  assert.equal(r.steps[4].text, 'Arrivée : 日枝神社');
  assert.ok(Math.abs(nav.durationBetween(r, 20, 370) - 252) < 1);
  assert.ok(Math.abs(nav.durationBetween(r, 120, 370) - 180) < 1);
});

test('choix de la prochaine manœuvre', () => {
  const { route } = fixture();
  const r = nav.prepareRoute(route, { stopNames: ['乃木神社', '日枝神社'] });
  let m = nav.nextManeuver(r, 0);
  assert.equal(m.current.type, 'depart');
  assert.equal(m.next.text, 'Tournez à gauche sur 外苑西通り');
  assert.equal(Math.round(m.distance), 200);
  m = nav.nextManeuver(r, 150);
  assert.equal(Math.round(m.distance), 50);
  m = nav.nextManeuver(r, 210);
  assert.equal(m.next.type, 'arrive');
  assert.equal(m.next.text, 'Arrivée : 乃木神社, sur votre droite');
  assert.equal(m.then?.text, 'Arrivée : 日枝神社', 'manœuvre suivante à moins de 150 m : « puis »');
  // Juste après le 1er sanctuaire : le départ du tronçon suivant est sauté.
  m = nav.nextManeuver(r, 355);
  assert.equal(m.next.text, 'Arrivée : 日枝神社');
  assert.equal(Math.round(m.distance), 95);
  // 1er sanctuaire atteint 15 m avant le bout de son tronçon : on annonce déjà le suivant.
  m = nav.nextManeuver(r, 335, 1);
  assert.equal(m.next.text, 'Arrivée : 日枝神社');
  assert.equal(Math.round(m.distance), 115);
  m = nav.nextManeuver(r, 450);
  assert.equal(m.next.text, 'Arrivée : 日枝神社');
});

test("détection d'arrivée", () => {
  assert.equal(nav.hasArrived({ distance: 25, accuracy: 5 }), true);
  assert.equal(nav.hasArrived({ distance: 45, accuracy: 5 }), false);
  assert.equal(nav.hasArrived({ distance: 45, accuracy: 40 }), true, 'GPS imprécis : rayon élargi');
  assert.equal(nav.hasArrived({ distance: 60, accuracy: 100 }), false, 'rayon plafonné à 50 m');
  assert.equal(nav.hasArrived({ distance: 90, accuracy: 5, remainingOnLeg: 10 }), true, 'sanctuaire en retrait de la route');
  assert.equal(nav.hasArrived({ distance: 90, accuracy: 5, remainingOnLeg: 200 }), false);
  assert.equal(nav.hasArrived({ distance: 300, accuracy: 5, remainingOnLeg: -80 }), true, 'sanctuaire dépassé sur le tracé');
});

test("détection d'écart au tracé", () => {
  const d = nav.createOffRouteDetector();
  d.routed(0);
  assert.equal(d.update(60, 5, 20000), false, 'une seule position loin ne suffit pas');
  assert.equal(d.update(20, 5, 21000), false);
  assert.equal(d.update(60, 5, 22000), false);
  assert.equal(d.update(60, 5, 23000), true, 'deux positions successives au-delà de 40 m');
  assert.equal(d.update(80, 5, 24000), false);
  assert.equal(d.update(80, 5, 25000), false, 'pas plus d’un recalcul toutes les 15 s');
  assert.equal(d.update(80, 5, 38000), true);
  // Marge selon la précision du GPS.
  const e = nav.createOffRouteDetector();
  assert.equal(e.update(50, 30, 100000), false);
  assert.equal(e.update(50, 30, 101000), false, 'précision 30 m : tolérance 55 m');
  assert.equal(e.update(500, 150, 102000), false, 'position trop imprécise ignorée');
  assert.equal(e.count, 0);
  // Juste après un calcul d'itinéraire : on attend 15 s.
  const f = nav.createOffRouteDetector();
  f.routed(50000);
  f.update(90, 5, 51000);
  assert.equal(f.update(90, 5, 52000), false);
});
