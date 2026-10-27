// Jinja Collection — application iOS (React Native / Expo).
// Carte des sanctuaires shintō du Japon : coche ceux que tu as visités, collectionne une carte
// postale pour chacun, prépare des circuits et laisse-toi guider jusqu'à eux.
import 'react-native-gesture-handler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Location from 'expo-location';
import ShrineMap from './src/components/ShrineMap';
import Panel from './src/components/Panel';
import ShrineDetail from './src/components/ShrineDetail';
import PostcardModal from './src/components/PostcardModal';
import NavOverlay from './src/components/NavOverlay';
import useNavigation from './src/hooks/useNavigation';
import { CollectionProvider, byId, useCollection } from './src/state/CollectionContext';
import { colors } from './src/theme';

// Volet du bas : replié (barre seule), moitié, plein écran — comme sur le site mobile.
const SNAP = { collapsed: 0, half: 1, full: 2 };

function Main() {
  const c = useCollection();
  const insets = useSafeAreaInsets();
  const map = useRef(null);
  const sheet = useRef(null);
  const [selectedId, setSelectedId] = useState(null);
  const [card, setCard] = useState(null); // { id, isNew }
  const [route, setRoute] = useState(null);
  const [showUser, setShowUser] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const sheetBefore = useRef(SNAP.half);
  const sheetIndex = useRef(SNAP.half);
  const snapPoints = useMemo(() => [96 + insets.bottom, '52%', '94%'], [insets.bottom]);

  const { nav, start, stop, setFollowing, dismissMessage } = useNavigation({
    onFollow: (point, first) => map.current?.easeTo(point[1], point[0], first ? 17 : undefined),
    onStart: () => { sheetBefore.current = sheetIndex.current; sheet.current?.close(); },
    onStop: () => sheet.current?.snapToIndex(sheetBefore.current),
    onGps: c.recordSighting,
  });

  const select = useCallback((id) => {
    const s = byId.get(id);
    if (!s) return;
    setSelectedId(id);
    map.current?.flyTo(s.lat, s.lon, 15);
    if (sheetIndex.current === SNAP.collapsed) sheet.current?.snapToIndex(SNAP.half);
  }, []);

  const locate = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    setShowUser(true);
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    c.recordSighting({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy });
    map.current?.flyTo(pos.coords.latitude, pos.coords.longitude, 14);
  };

  const navigateTo = (s) => {
    setSelectedId(null);
    start({ stops: [s], mode: route?.mode || 'foot', simulate });
  };
  const startCircuit = (stops, mode) => {
    setSelectedId(null);
    start({ stops, mode, circuit: true, simulate });
  };

  const selected = selectedId ? byId.get(selectedId) : null;

  return (
    <View style={styles.root}>
      <StatusBar style={nav ? 'light' : 'dark'} />
      <ShrineMap
        ref={map}
        visits={c.visits}
        wishlist={c.wishlist}
        selectedId={selectedId}
        onSelect={select}
        route={route}
        nav={nav}
        showUser={showUser}
        onUserPan={() => { if (nav) setFollowing(false); }}
      />

      {!nav ? (
        <Pressable style={[styles.locate, { top: insets.top + 10 }]} onPress={locate} accessibilityLabel="Me localiser">
          <Text style={styles.locateText}>◎</Text>
        </Pressable>
      ) : null}

      <BottomSheet
        ref={sheet}
        index={SNAP.half}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose={false}
        onChange={(i) => { if (i >= 0) sheetIndex.current = i; }}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
        keyboardBehavior="extend"
      >
        {selected ? (
          <BottomSheetScrollView>
            <ShrineDetail
              shrine={selected}
              onClose={() => setSelectedId(null)}
              onNavigate={navigateTo}
              onOpenCard={(id, isNew) => setCard({ id, isNew })}
              onLoginHint={() => { setSelectedId(null); sheet.current?.snapToIndex(SNAP.half); }}
            />
          </BottomSheetScrollView>
        ) : (
          <Panel
            onSelect={select}
            onOpenCard={(id) => setCard({ id, isNew: false })}
            route={route}
            setRoute={setRoute}
            onFocusRoute={(r) => { map.current?.fitCoords(r.geometry.coordinates); sheet.current?.snapToIndex(SNAP.collapsed); }}
            onStartCircuit={startCircuit}
            simulate={simulate}
            setSimulate={setSimulate}
          />
        )}
      </BottomSheet>

      <NavOverlay
        nav={nav}
        onStop={stop}
        onRecenter={() => setFollowing(true)}
        onVisit={async (id) => {
          const error = await c.markVisited(id);
          if (error) Alert.alert('Visite impossible', error); else setCard({ id, isNew: true });
        }}
        isVisited={c.isVisited}
        onDismiss={dismissMessage}
      />

      <PostcardModal id={card?.id} isNew={card?.isNew} onClose={() => setCard(null)} onShowOnMap={(id) => { setCard(null); select(id); }} />
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <CollectionProvider>
          <Main />
        </CollectionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  locate: { position: 'absolute', right: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 0, height: 1 } },
  locateText: { fontSize: 22, color: colors.ink },
  sheetBg: { backgroundColor: colors.paper, borderRadius: 18 },
  handle: { backgroundColor: '#d8ccbb', width: 42 },
});
