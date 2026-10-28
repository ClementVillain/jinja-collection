// Tests des fonctions pures de geo.js (recherche par ville) : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../geo.js');

// Carré 0–10 avec un trou 4–6 ; deuxième île 20–22.
const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
const island = [[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]];

test('point dans un polygone (avec trou)', () => {
  assert.equal(geo.pointInRing(5, 5, square), true);
  assert.equal(geo.pointInRing(11, 5, square), false);
  const poly = { type: 'Polygon', coordinates: [square, hole] };
  assert.equal(geo.pointInGeometry(2, 2, poly), true);
  assert.equal(geo.pointInGeometry(5, 5, poly), false); // dans le trou
  assert.equal(geo.pointInGeometry(-1, 5, poly), false);
  // Polygone concave en « U » : le creux n'en fait pas partie.
  const u = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]];
  assert.equal(geo.pointInRing(1.5, 2, u), false);
  assert.equal(geo.pointInRing(0.5, 2, u), true);
});

test('point dans un MultiPolygon', () => {
  const multi = { type: 'MultiPolygon', coordinates: [[square, hole], [island]] };
  assert.equal(geo.pointInGeometry(21, 21, multi), true);
  assert.equal(geo.pointInGeometry(1, 1, multi), true);
  assert.equal(geo.pointInGeometry(5, 5, multi), false);
  assert.equal(geo.pointInGeometry(15, 15, multi), false);
  assert.equal(geo.pointInGeometry(1, 1, { type: 'Point', coordinates: [1, 1] }), false);
});

test('sanctuaires dans un lieu : contour, ou rectangle englobant à défaut', () => {
  const list = [{ id: 'a', lon: 1, lat: 1 }, { id: 'b', lon: 5, lat: 5 }, { id: 'c', lon: 21, lat: 21 }, { id: 'd', lon: 30, lat: 1 }];
  const withShape = { bbox: [0, 0, 22, 22], geometry: { type: 'MultiPolygon', coordinates: [[square, hole], [island]] } };
  assert.deepEqual(geo.shrinesIn(withShape, list).map((s) => s.id), ['a', 'c']);
  const bboxOnly = { bbox: [0, 0, 22, 22], geometry: null };
  assert.deepEqual(geo.shrinesIn(bboxOnly, list).map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(geo.inBbox(22, 22, [0, 0, 22, 22]), true);
  assert.equal(geo.inBbox(22.1, 22, [0, 0, 22, 22]), false);
});

test('choix des résultats Nominatim', () => {
  const kyotoShape = { type: 'Polygon', coordinates: [[[135.5, 34.8], [135.9, 34.8], [135.9, 35.3], [135.5, 35.3], [135.5, 34.8]]] };
  const results = [
    { osm_type: 'relation', osm_id: 357794, name: 'Kyoto', namedetails: { name: '京都市' }, addresstype: 'city', type: 'administrative',
      display_name: 'Kyoto, Préfecture de Kyoto, Japon', boundingbox: ['34.8', '35.3', '135.5', '135.9'], geojson: kyotoShape },
    { osm_type: 'relation', osm_id: 357794, name: 'Préfecture de Kyoto', namedetails: { name: '京都府' }, addresstype: 'province',
      display_name: 'Préfecture de Kyoto, Japon', boundingbox: ['34.7', '35.8', '134.8', '136.1'], geojson: kyotoShape },
    { osm_type: 'node', osm_id: 1, name: 'Kyoto', namedetails: { name: '京都市' }, addresstype: 'city', type: 'city',
      display_name: 'Kyoto, Préfecture de Kyoto, 604-8571, Japon', boundingbox: ['34.9', '35.1', '135.6', '135.8'], geojson: { type: 'Point', coordinates: [135.7, 35] } },
    { osm_type: 'way', osm_id: 2, name: 'Gare de Kyoto', addresstype: 'railway', display_name: 'Gare de Kyoto, Japon', boundingbox: ['34.98', '34.99', '135.75', '135.76'] },
    { osm_type: 'node', osm_id: 3, name: 'Nara', addresstype: 'town', display_name: 'Nara, 123-4567, Préfecture de Nara, Japon',
      boundingbox: ['34.6', '34.8', '135.7', '135.9'], geojson: { type: 'Point', coordinates: [135.8, 34.7] } },
  ];
  const places = geo.pickPlaces(results);
  assert.deepEqual(places.map((p) => p.label), ['Kyoto (京都市)', 'Nara']);
  assert.equal(places[0].region, 'Préfecture de Kyoto');
  assert.deepEqual(places[0].bbox, [135.5, 34.8, 135.9, 35.3]);
  assert.equal(places[0].geometry.type, 'Polygon'); // le contour l'emporte sur le point
  assert.equal(places[1].geometry, null);
  assert.equal(places[1].region, 'Préfecture de Nara');
  // Simple point listé en premier : remplacé par le contour arrivé ensuite.
  assert.equal(geo.pickPlaces([results[2], results[0]])[0].geometry.type, 'Polygon');
  assert.deepEqual(geo.pickPlaces(null), []);
  assert.deepEqual(geo.pickPlaces({ error: 'x' }), []);
});

test('requête de ville : longueur minimale et URL', () => {
  assert.equal(geo.isCityQuery('Na'), false);
  assert.equal(geo.isCityQuery('Nar'), true);
  assert.equal(geo.isCityQuery('京都'), true);
  assert.equal(geo.isCityQuery(' 京 '), false);
  const url = geo.searchUrl(' 京都 ');
  assert.ok(url.startsWith('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=jp&polygon_geojson=1'));
  assert.ok(url.endsWith('&q=%E4%BA%AC%E9%83%BD'));
});

test('recherche : cache par requête et espacement des appels', async () => {
  const calls = [];
  const saved = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, at: Date.now(), ua: opts.headers['User-Agent'] });
    return { ok: true, json: async () => [{ osm_type: 'relation', osm_id: 9, name: 'Test', addresstype: 'city', display_name: 'Test, Japon', boundingbox: ['0', '1', '0', '1'] }] };
  };
  try {
    const opts = { headers: { 'User-Agent': 'JinjaCollection/1.0' } };
    const [a, b] = await Promise.all([geo.findPlaces('Alpha', opts), geo.findPlaces('Beta', opts)]);
    assert.equal(a[0].label, 'Test');
    assert.equal(calls.length, 2);
    assert.ok(calls[1].at - calls[0].at >= 1000, calls[1].at - calls[0].at);
    assert.equal(calls[0].ua, 'JinjaCollection/1.0');
    assert.equal(await geo.findPlaces(' alpha '), a); // en cache
    assert.equal(geo.cached('ALPHA'), a);
    assert.equal(calls.length, 2);
    assert.ok(b);
    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(geo.findPlaces('Gamma'), /indisponible \(503\)/);
    global.fetch = async () => { throw new TypeError('Network request failed'); };
    await assert.rejects(geo.findPlaces('Delta'), /pas de connexion/);
  } finally {
    global.fetch = saved;
  }
});
