// Carte native (MapLibre) : fond OpenStreetMap vectoriel (OpenFreeMap, gratuit, sans clé),
// ~30 000 sanctuaires regroupés en bulles par le téléphone, visités en olive (torii), « À visiter » en
// céladon (étoile) (regroupés aussi, en bulles de leur couleur), sanctuaire sélectionné, circuit et navigation.
// Visites des amis : photos (3 au plus, puis « +N ») au-dessus des sanctuaires affichés seuls dans
// la zone visible, à partir du zoom 11 (packages/shared/friendvisits.js).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Camera, GeoJSONSource, Images, Layer, Map, Marker, NativeUserLocation } from '@maplibre/maplibre-react-native';
import JinjaFriendVisits from '@jinja/shared/friendvisits';
import Text from './Text';
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
// Pictogrammes des points visités (torii blanc) et « À visiter » (étoile olive foncée), comme sur
// le site. PNG tirés du tracé de Torii.js (14 pt, @2x/@3x), centrés sur la pastille, toujours affichés.
const PIN_IMAGES = { torii: require('../../assets/map/torii.png'), star: require('../../assets/map/star.png') };
const pinIcon = (image) => ({ 'icon-image': image, 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true });

// Pastilles d'amis : vues natives (photos distantes), moins nombreuses que sur le site pour garder
// une carte fluide.
const MAX_FRIEND_PINS = 80;
// Calques où un sanctuaire est dessiné seul (hors bulle) : seuls ceux-là reçoivent une pastille.
const SINGLE_LAYERS = ['shrine', 'wished-dot', 'visited-dot'];

// 3 photos d'amis chevauchées au plus (initiale sur céladon sans photo), puis « +N ».
function FriendStack({ list }) {
  const { shown, more } = JinjaFriendVisits.stack(list);
  return (
    <View style={styles.stack}>
      {shown.map((f, i) => (f.avatar
        ? <Image key={f.username} source={{ uri: f.avatar }} style={[styles.face, i > 0 && styles.overlap]} />
        : (
          <View key={f.username} style={[styles.face, styles.initial, i > 0 && styles.overlap]}>
            <Text style={styles.initialText}>{JinjaFriendVisits.initial(f.username)}</Text>
          </View>
        )))}
      {more ? <View style={[styles.more, styles.overlap]}><Text style={styles.moreText}>+{more}</Text></View> : null}
    </View>
  );
}

const point = (s, props = {}) => ({ type: 'Feature', id: s.id, properties: { id: s.id, ...props }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } });
const collection = (features) => ({ type: 'FeatureCollection', features });

// Tous les sanctuaires : source statique (les visités sont redessinés par-dessus).
const ALL = collection(shrines.map((s) => point(s)));

const ShrineMap = forwardRef(function ShrineMap({
  visits, wishlist, selectedId, onSelect, route, nav, showUser, onUserPan, getPadding, friendVisits, showFriendVisits,
}, ref) {
  const camera = useRef(null);
  const mapRef = useRef(null);
  const region = useRef(null);
  const [friendIds, setFriendIds] = useState([]);
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

  // Sanctuaires de la zone visible visités par des amis, dessinés seuls (pas dans une bulle).
  const refreshFriendPins = useCallback(async () => {
    const r = region.current;
    if (!r?.bounds || !showFriendVisits || !friendVisits || nav || r.zoom < JinjaFriendVisits.MIN_ZOOM) { setFriendIds([]); return; }
    const [west, south, east, north] = r.bounds;
    let single = null;
    try {
      const features = await mapRef.current?.queryRenderedFeatures({ layers: SINGLE_LAYERS });
      single = new Set((features || []).map((f) => f.properties?.id).filter(Boolean));
    } catch { /* carte pas prête : la zone suffit */ }
    setFriendIds(JinjaFriendVisits.visible(friendVisits, (id) => byId.get(id), { west, south, east, north }, {
      zoom: r.zoom, limit: MAX_FRIEND_PINS, keep: single ? (id) => single.has(id) : undefined,
    }));
  }, [friendVisits, showFriendVisits, !!nav]);
  useEffect(() => { refreshFriendPins(); }, [refreshFriendPins, visits, wishlist]);

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
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      mapStyle={MAP_STYLE}
      attribution
      attributionPosition={{ top: 54, left: 8 }}
      logo={false}
      compass={false}
      onRegionWillChange={(e) => { if (e.nativeEvent?.userInteraction) onUserPan?.(); }}
      onRegionDidChange={(e) => { region.current = e.nativeEvent; refreshFriendPins(); }}
    >
      <Camera ref={camera} initialViewState={JAPAN} />
      <Images images={PIN_IMAGES} />
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
        <Layer id="wished-dot" type="circle" filter={notCluster} paint={{ 'circle-color': colors.soft, 'circle-radius': 11, 'circle-stroke-color': colors.accent, 'circle-stroke-width': 3 }} />
        <Layer id="wished-star" type="symbol" filter={notCluster} layout={pinIcon('star')} />
      </GeoJSONSource>

      <GeoJSONSource id="visited" ref={visitedSource} data={visited} {...OVERLAY_CLUSTER} onPress={pressIn(visitedSource)}>
        <Layer id="visited-clusters" type="circle" filter={isCluster}
          paint={{ 'circle-color': colors.accent, 'circle-radius': overlayRadius, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 }} />
        <Layer id="visited-count" type="symbol" filter={isCluster}
          layout={{ 'text-field': CLUSTER_LABEL, 'text-font': FONT, 'text-size': 12, 'text-allow-overlap': true }} paint={{ 'text-color': '#ffffff' }} />
        <Layer id="visited-dot" type="circle" filter={notCluster} paint={{ 'circle-color': colors.accent, 'circle-radius': 12, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 }} />
        <Layer id="visited-torii" type="symbol" filter={notCluster} layout={pinIcon('torii')} />
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

      {/* En haut à droite du point : le torii ou l'étoile restent visibles ; toucher ouvre la fiche. */}
      {friendIds.map((id) => {
        const s = byId.get(id);
        return (
          <Marker key={`friends-${id}`} id={`friends-${id}`} lngLat={[s.lon, s.lat]} anchor="bottom-left" offset={[6, -8]} onPress={() => onSelect(id)}>
            <FriendStack list={friendVisits[id]} />
          </Marker>
        );
      })}
    </Map>
  );
});

export default ShrineMap;

const styles = StyleSheet.create({
  stack: {
    flexDirection: 'row', alignItems: 'center', padding: 2, borderRadius: 15, backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  face: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ffffff', backgroundColor: colors.paper2 },
  overlap: { marginLeft: -8 },
  initial: { backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  initialText: { color: colors.ink, fontSize: 10, fontWeight: '700' },
  more: { minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, borderWidth: 2, borderColor: '#ffffff', backgroundColor: colors.accentStrong, alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
});
