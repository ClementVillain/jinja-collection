// Carte native (MapLibre) : fond OpenStreetMap vectoriel (OpenFreeMap, gratuit, sans clé),
// ~30 000 sanctuaires regroupés en bulles par le téléphone, visités en rouge, « À visiter » en
// doré (regroupés aussi, en bulles de leur couleur), sanctuaire sélectionné, circuit et navigation.
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation } from '@maplibre/maplibre-react-native';
import { shrines, byId } from '../state/CollectionContext';
import { colors } from '../theme';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const FONT = ['Noto Sans Bold'];
// « 27k » au-delà de 1 000 (l'abréviation fournie par MapLibre s'affiche mal : « 26.954000k »).
const CLUSTER_LABEL = ['case',
  ['>=', ['get', 'point_count'], 10000], ['concat', ['to-string', ['round', ['/', ['get', 'point_count'], 1000]]], 'k'],
  ['>=', ['get', 'point_count'], 1000], ['concat', ['to-string', ['/', ['round', ['/', ['get', 'point_count'], 100]], 10]], 'k'],
  ['to-string', ['get', 'point_count']]];
// Vue de départ : tout le Japon, décalé vers le haut car le volet couvre le bas de l'écran.
const JAPAN = { center: [136.8, 33.2], zoom: 3.9 };
// Visités et « À visiter » : bulles plus petites, points séparés dès le zoom 13.
const OVERLAY_CLUSTER = { cluster: true, clusterRadius: 45, clusterMaxZoom: 12 };
const isCluster = ['has', 'point_count'];
const notCluster = ['!', isCluster];
const overlayRadius = ['step', ['get', 'point_count'], 14, 10, 17, 100, 21];

const point = (s, props = {}) => ({ type: 'Feature', id: s.id, properties: { id: s.id, ...props }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } });
const collection = (features) => ({ type: 'FeatureCollection', features });

// Tous les sanctuaires : source statique (les visités sont redessinés par-dessus).
const ALL = collection(shrines.map((s) => point(s)));

const ShrineMap = forwardRef(function ShrineMap({
  visits, wishlist, selectedId, onSelect, route, nav, showUser, onUserPan, getPadding,
}, ref) {
  const camera = useRef(null);
  const source = useRef(null);
  const wishedSource = useRef(null);
  const visitedSource = useRef(null);

  useImperativeHandle(ref, () => ({
    // padding : zone de la carte à viser (le volet du bas couvre une partie de l'écran).
    flyTo(lat, lon, zoom = 15, padding = getPadding?.()) { camera.current?.flyTo({ center: [lon, lat], zoom, padding, duration: 900 }); },
    easeTo(lat, lon, zoom) { camera.current?.easeTo({ center: [lon, lat], ...(zoom ? { zoom } : {}), duration: 600 }); },
    fitCoords(coords, padding = { top: 80, bottom: 260, left: 40, right: 40 }) {
      if (!coords?.length) return;
      const lons = coords.map((c) => c[0]), lats = coords.map((c) => c[1]);
      camera.current?.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], { padding, duration: 900 });
    },
  }));

  const visited = useMemo(() => collection(Object.keys(visits).filter((id) => byId.has(id)).map((id) => point(byId.get(id)))), [visits]);
  const wished = useMemo(() => collection(Object.keys(wishlist).filter((id) => byId.has(id) && !visits[id]).map((id) => point(byId.get(id)))), [wishlist, visits]);
  const selected = useMemo(() => collection(selectedId && byId.has(selectedId) ? [point(byId.get(selectedId))] : []), [selectedId]);

  const routeLine = useMemo(() => (route ? collection([{ type: 'Feature', properties: {}, geometry: route.geometry }]) : null), [route]);
  const routeStops = useMemo(() => (route ? collection(route.ordered.map((p, i) => ({
    type: 'Feature', properties: { label: p.me ? '◎' : String(i + (route.fromMe ? 0 : 1)) }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
  }))) : null), [route]);

  const navLine = useMemo(() => (nav?.remaining?.length > 1 ? collection([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: nav.remaining } }]) : null), [nav?.remaining]);
  const navMe = useMemo(() => (nav?.pos ? collection([{ type: 'Feature', properties: { heading: nav.pos.heading ?? 0, hasHeading: nav.pos.heading != null }, geometry: { type: 'Point', coordinates: nav.pos.point } }]) : null), [nav?.pos]);
  const navStops = useMemo(() => (nav ? collection(nav.stops.map((s, i) => (i < nav.target ? null : {
    type: 'Feature', properties: { label: nav.circuit ? String(i + 1) : '' }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
  })).filter(Boolean)) : null), [nav?.stops, nav?.target, nav?.circuit]);

  // Toucher une bulle zoome dessus (chaque source a ses bulles) ; toucher un point l'ouvre.
  const pressIn = (src) => async (e) => {
    const f = e.nativeEvent.features?.[0];
    if (!f) return;
    if (f.properties?.cluster) {
      const zoom = await src.current?.getClusterExpansionZoom(f.properties.cluster_id).catch(() => null);
      camera.current?.easeTo({ center: f.geometry.coordinates, zoom: Math.min((zoom ?? 10) + 0.5, 16), padding: getPadding?.(), duration: 500 });
      return;
    }
    if (f.properties?.id) onSelect(f.properties.id);
  };

  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={MAP_STYLE}
      attribution
      attributionPosition={{ top: 54, left: 8 }}
      logo={false}
      compass={false}
      onRegionWillChange={(e) => { if (e.nativeEvent?.userInteraction) onUserPan?.(); }}
    >
      <Camera ref={camera} initialViewState={JAPAN} />
      {showUser && !nav ? <NativeUserLocation /> : null}

      <GeoJSONSource id="shrines" ref={source} data={ALL} cluster clusterRadius={55} clusterMaxZoom={14} onPress={pressIn(source)}>
        <Layer
          id="clusters" type="circle" filter={isCluster}
          paint={{
            'circle-color': 'rgba(29,30,24,0.84)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5,
            'circle-radius': ['step', ['get', 'point_count'], 15, 50, 19, 500, 24],
          }}
        />
        <Layer
          id="cluster-count" type="symbol" filter={['has', 'point_count']}
          layout={{ 'text-field': CLUSTER_LABEL, 'text-font': FONT, 'text-size': 12, 'text-allow-overlap': true }}
          paint={{ 'text-color': '#ffffff' }}
        />
        <Layer
          id="shrine" type="circle" filter={['!', ['has', 'point_count']]}
          paint={{ 'circle-color': '#ffffff', 'circle-radius': 6, 'circle-stroke-color': '#9aa59c', 'circle-stroke-width': 3 }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="wished" ref={wishedSource} data={wished} {...OVERLAY_CLUSTER} onPress={pressIn(wishedSource)}>
        <Layer id="wished-clusters" type="circle" filter={isCluster}
          paint={{ 'circle-color': colors.soft, 'circle-radius': overlayRadius, 'circle-stroke-color': colors.accent, 'circle-stroke-width': 3 }} />
        <Layer id="wished-count" type="symbol" filter={isCluster}
          layout={{ 'text-field': CLUSTER_LABEL, 'text-font': FONT, 'text-size': 12, 'text-allow-overlap': true }} paint={{ 'text-color': colors.ink }} />
        <Layer id="wished-dot" type="circle" filter={notCluster} paint={{ 'circle-color': colors.soft, 'circle-radius': 10, 'circle-stroke-color': colors.accent, 'circle-stroke-width': 3 }} />
        <Layer id="wished-star" type="circle" filter={notCluster} paint={{ 'circle-color': colors.accentDark, 'circle-radius': 3.5 }} />
      </GeoJSONSource>

      <GeoJSONSource id="visited" ref={visitedSource} data={visited} {...OVERLAY_CLUSTER} onPress={pressIn(visitedSource)}>
        <Layer id="visited-clusters" type="circle" filter={isCluster}
          paint={{ 'circle-color': colors.accent, 'circle-radius': overlayRadius, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 }} />
        <Layer id="visited-count" type="symbol" filter={isCluster}
          layout={{ 'text-field': CLUSTER_LABEL, 'text-font': FONT, 'text-size': 12, 'text-allow-overlap': true }} paint={{ 'text-color': '#ffffff' }} />
        <Layer id="visited-dot" type="circle" filter={notCluster} paint={{ 'circle-color': colors.accent, 'circle-radius': 11, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 }} />
        <Layer id="visited-center" type="circle" filter={notCluster} paint={{ 'circle-color': '#ffffff', 'circle-radius': 3 }} />
      </GeoJSONSource>

      {routeLine && !nav ? (
        <GeoJSONSource id="route" data={routeLine}>
          <Layer id="route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': colors.accentStrong, 'line-width': 5, 'line-opacity': 0.85, ...(route.mode === 'foot' ? { 'line-dasharray': [0.2, 2] } : {}) }} />
        </GeoJSONSource>
      ) : null}
      {routeStops && !nav ? (
        <GeoJSONSource id="route-stops" data={routeStops}>
          <Layer id="route-stop" type="circle" paint={{ 'circle-color': colors.accentStrong, 'circle-radius': 11, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }} />
          <Layer id="route-stop-label" type="symbol" layout={{ 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 11, 'text-allow-overlap': true }} paint={{ 'text-color': '#ffffff' }} />
        </GeoJSONSource>
      ) : null}

      {navLine ? (
        <GeoJSONSource id="nav-line" data={navLine}>
          <Layer id="nav-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.9 }} />
          <Layer id="nav-route" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.accentStrong, 'line-width': 6 }} />
        </GeoJSONSource>
      ) : null}
      {navStops ? (
        <GeoJSONSource id="nav-stops" data={navStops}>
          <Layer id="nav-stop" type="circle" paint={{ 'circle-color': colors.accentStrong, 'circle-radius': 12, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }} />
          <Layer id="nav-stop-label" type="symbol" layout={{ 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 11, 'text-allow-overlap': true }} paint={{ 'text-color': '#ffffff' }} />
        </GeoJSONSource>
      ) : null}
      {navMe ? (
        <GeoJSONSource id="nav-me" data={navMe}>
          <Layer id="nav-me-halo" type="circle" paint={{ 'circle-color': colors.blue, 'circle-opacity': 0.18, 'circle-radius': 22 }} />
          <Layer id="nav-me-dot" type="circle" paint={{ 'circle-color': colors.blue, 'circle-radius': 8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 }} />
          <Layer
            id="nav-me-heading" type="symbol" filter={['==', ['get', 'hasHeading'], true]}
            layout={{ 'text-field': '▲', 'text-font': FONT, 'text-size': 13, 'text-rotate': ['get', 'heading'], 'text-rotation-alignment': 'map', 'text-offset': [0, -1.6], 'text-allow-overlap': true }}
            paint={{ 'text-color': colors.blue }}
          />
        </GeoJSONSource>
      ) : null}

      <GeoJSONSource id="selected" data={selected}>
        <Layer id="selected-ring" type="circle" paint={{ 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 16, 'circle-stroke-color': colors.ink, 'circle-stroke-width': 3 }} />
      </GeoJSONSource>
    </Map>
  );
});

export default ShrineMap;
