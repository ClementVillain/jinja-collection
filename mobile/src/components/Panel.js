// Panneau principal (volet du bas) : compte Google, progression, et onglets Explorer,
// À visiter (avec le circuit), Visités et Collection.
import { useMemo, useState } from 'react';
import { Dimensions, Image, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import * as Location from 'expo-location';
import JinjaRoute from '../shared/route';
import { Postcard, useCoverPhoto } from './PostcardModal';
import Friends from './Friends';
import { shrines, byId, useCollection } from '../state/CollectionContext';
import { fmtDate, fmtDistance, fmtDuration, latinName, normalize } from '../lib/text';
import { colors, fonts } from '../theme';

const SEARCH_INDEX = shrines.map((s) => ({ s, key: normalize(`${s.name} ${s.nameLatin} ${s.romaji}`) }));
// Pas d'onglet « Visités » : la Collection montre déjà chaque sanctuaire visité (avec son compteur).
const TABS = [['explore', 'Explorer'], ['wish', 'À visiter'], ['collection', 'Collection'], ['friends', 'Amis']];
const MAX_ROUTE_STOPS = 25;

function Item({ s, icon, iconStyle, sub, right, onPress }) {
  const iconColor = iconStyle === styles.iconVisited ? '#fff' : iconStyle === styles.iconWish ? colors.gold : null;
  const latin = latinName(s);
  return (
    <View style={styles.item}>
      <Pressable style={styles.itemMain} onPress={onPress}>
        <View style={[styles.itemIcon, iconStyle]}><Text style={[styles.itemIconText, iconColor && { color: iconColor }]}>{icon}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemName} numberOfLines={1}>{s.name}</Text>
          {latin ? <Text style={styles.itemRomaji} numberOfLines={1}>{latin}</Text> : null}
          {sub ? <Text style={styles.itemSub} numberOfLines={1}>{sub}</Text> : null}
        </View>
      </Pressable>
      {right}
    </View>
  );
}

function UsernameForm({ onDone }) {
  const c = useCollection();
  const [value, setValue] = useState(c.username || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError('');
    try { await c.chooseUsername(value); onDone?.(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <View style={styles.nameForm}>
      <Text style={styles.nameLabel}>{c.username ? 'Nouveau nom d’utilisateur' : 'Choisis ton nom d’utilisateur public'} <Text style={{ color: colors.muted }}>(visible par les autres : amis, « Découvert par »)</Text></Text>
      <View style={styles.nameRow}>
        <BottomSheetTextInput style={[styles.search, { flex: 1, marginBottom: 0 }]} value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false}
          placeholder="ex : kitsune_77" placeholderTextColor={colors.muted} maxLength={20} onSubmitEditing={submit} />
        <Pressable style={[styles.goBtn, { paddingHorizontal: 16 }, busy && { opacity: 0.5 }]} disabled={busy} onPress={submit}><Text style={styles.goText}>OK</Text></Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Account() {
  const c = useCollection();
  const [editing, setEditing] = useState(false);
  if (!c.googleSignInAvailable) return null;
  if (!c.user) {
    return (
      <View style={styles.account}>
        <Text style={styles.accountPitch}>Connecte-toi pour collectionner les sanctuaires (visites, « À visiter », notes, photos) et retrouver tes cartes sur le site et l'app.</Text>
        <Pressable style={styles.googleBtn} onPress={c.signIn}><Text style={styles.googleText}>Se connecter avec Google</Text></Pressable>
      </View>
    );
  }
  return (
    <View style={[styles.account, { flexWrap: 'wrap' }]}>
      {c.user.picture ? <Image source={{ uri: c.user.picture }} style={styles.accountAvatar} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.accountName} numberOfLines={1}>{c.user.name}</Text>
        {c.username ? (
          <Text style={styles.accountUsername}>@{c.username} · <Text style={styles.link} onPress={() => setEditing(true)}>modifier</Text></Text>
        ) : null}
        <Text style={[styles.accountStatus, c.syncStatus.error && { color: colors.vermilion }]}>{c.syncStatus.text}</Text>
      </View>
      <Pressable style={styles.smallBtn} onPress={c.signOut}><Text style={styles.smallBtnText}>Déconnexion</Text></Pressable>
      {c.username === null || editing ? <UsernameForm onDone={() => setEditing(false)} /> : null}
    </View>
  );
}

function CollectionCard({ id, width, onPress }) {
  const photo = useCoverPhoto(id);
  return <Pressable onPress={onPress}><Postcard id={id} width={width} photo={photo} /></Pressable>;
}

function RouteBox({ items, excluded, route, setRoute, onStart, onFocusRoute, simulate }) {
  const [mode, setMode] = useState('foot');
  const [fromMe, setFromMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stops = items.filter((s) => !excluded.has(s.id));
  const enough = stops.length + (fromMe ? 1 : 0) >= 2;

  const compute = async () => {
    setBusy(true); setError(''); setRoute(null);
    try {
      let points = stops.slice(0, MAX_ROUTE_STOPS);
      if (fromMe) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') throw new Error("impossible d'obtenir ta position (autorise la localisation)");
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        points = [{ me: true, lat: pos.coords.latitude, lon: pos.coords.longitude }, ...points];
      }
      const result = await JinjaRoute.plan(points, { mode, fixedStart: fromMe });
      const r = { ...result, mode, fromMe };
      setRoute(r);
      onFocusRoute(r);
    } catch (err) {
      setError(`Circuit impossible : ${err.message}`);
    } finally { setBusy(false); }
  };

  const googleUrl = (r) => {
    const list = r.ordered.filter((p) => !p.me).slice(0, r.fromMe ? 10 : 11).map((p) => `${p.lat},${p.lon}`);
    const params = [`api=1`, `travelmode=${r.mode === 'car' ? 'driving' : 'walking'}`];
    if (!r.fromMe) params.push(`origin=${list.shift()}`);
    params.push(`destination=${list.pop()}`);
    if (list.length) params.push(`waypoints=${encodeURIComponent(list.join('|'))}`);
    return `https://www.google.com/maps/dir/?${params.join('&')}`;
  };

  return (
    <View style={styles.routeBox}>
      <View style={styles.routeHead}>
        <Text style={styles.routeTitle}>Circuit</Text>
        <View style={styles.modes}>
          {[['foot', '🚶 À pied'], ['car', '🚗 Voiture']].map(([k, label]) => (
            <Pressable key={k} style={[styles.mode, mode === k && styles.modeOn]} onPress={() => setMode(k)}>
              <Text style={[styles.modeText, mode === k && { color: colors.ink }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.option}><Switch value={fromMe} onValueChange={setFromMe} trackColor={{ true: colors.vermilion }} /><Text style={styles.optionText}>Partir de ma position</Text></View>
      <Pressable style={[styles.goBtn, (!enough || busy) && { opacity: 0.5 }]} disabled={!enough || busy} onPress={compute}>
        <Text style={styles.goText}>{busy ? 'Calcul du circuit…' : enough ? `Tracer le circuit (${stops.length} sanctuaire${stops.length > 1 ? 's' : ''})` : 'Coche au moins 2 sanctuaires'}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {route ? (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.summary}>{route.ordered.filter((p) => !p.me).length} étapes · {fmtDistance(route.distance)} · {fmtDuration(route.duration)} {route.mode === 'car' ? 'en voiture' : 'à pied'}</Text>
          {route.ordered.map((p, i) => (
            <View key={`${p.id || 'me'}-${i}`} style={styles.step}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{p.me ? '◎' : i + (route.fromMe ? 0 : 1)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepName}>{p.me ? 'Ma position' : p.name}</Text>
                {i < route.legs.length ? <Text style={styles.stepLeg}>↓ {fmtDuration(route.legs[i].duration)} · {fmtDistance(route.legs[i].distance)}</Text> : null}
              </View>
            </View>
          ))}
          <View style={styles.routeActions}>
            <Pressable style={[styles.goBtn, { flex: 1 }]} onPress={() => onStart(route.ordered.filter((p) => !p.me), route.mode)}><Text style={styles.goText}>▶ Démarrer</Text></Pressable>
            <Pressable style={styles.smallBtn} onPress={() => Linking.openURL(googleUrl(route))}><Text style={styles.smallBtnText}>Google Maps</Text></Pressable>
            <Pressable style={styles.smallBtn} onPress={() => setRoute(null)}><Text style={styles.smallBtnText}>Effacer</Text></Pressable>
          </View>
          {simulate ? <Text style={styles.hint}>Mode simulation activé : la position avancera seule.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export default function Panel({ onSelect, onOpenCard, route, setRoute, onStartCircuit, onFocusRoute, simulate, setSimulate }) {
  const c = useCollection();
  const [tab, setTab] = useState('explore');
  const [query, setQuery] = useState('');
  const [excluded, setExcluded] = useState(() => new Set());
  const width = Dimensions.get('window').width;
  const cardW = (width - 16 * 2 - 10) / 2;

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return [];
    const out = [];
    for (const { s, key } of SEARCH_INDEX) { if (key.includes(q)) { out.push(s); if (out.length >= 60) break; } }
    return out;
  }, [query]);

  const wishItems = useMemo(() => Object.entries(c.wishlist)
    .filter(([id]) => byId.has(id) && !c.visits[id])
    .sort((a, b) => b[1].addedAt.localeCompare(a[1].addedAt))
    .map(([id, w]) => ({ ...byId.get(id), addedAt: w.addedAt })), [c.wishlist, c.visits]);
  const recent = useMemo(() => [...c.visitedOrdered].reverse(), [c.visitedOrdered]);
  const n = c.visitedOrdered.length;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.brand}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>⛩</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Jinja Collection</Text>
          <Text style={styles.progress}>{n.toLocaleString('fr-FR')} / {shrines.length.toLocaleString('fr-FR')} sanctuaires visités</Text>
        </View>
      </View>
      <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.max(n ? 1.5 : 0, (n / shrines.length) * 100)}%` }]} /></View>

      <View style={styles.tabs}>
        {TABS.map(([k, label]) => (
          <Pressable key={k} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={[styles.tabText, tab === k && { color: colors.vermilion }]}>{label}</Text>
            {k === 'wish' ? <View style={[styles.badge, { backgroundColor: colors.gold }]}><Text style={styles.badgeText}>{wishItems.length}</Text></View> : null}
            {k === 'collection' ? <View style={styles.badge}><Text style={styles.badgeText}>{n}</Text></View> : null}
          </Pressable>
        ))}
      </View>

      <BottomSheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {tab === 'explore' ? (
          <>
            <Account />
            <BottomSheetTextInput
              style={styles.search} value={query} onChangeText={setQuery} clearButtonMode="while-editing"
              placeholder="Rechercher un sanctuaire (伏見稲荷, hakusan…)" placeholderTextColor={colors.muted} autoCorrect={false}
            />
            {query && !results.length ? <Text style={styles.hint}>Aucun sanctuaire trouvé.</Text> : null}
            {!query ? <Text style={styles.hint}>Touche un point de la carte, ou cherche un sanctuaire par son nom.</Text> : null}
            {results.map((s) => (
              <Item key={s.id} s={s} onPress={() => onSelect(s.id)}
                icon={c.isVisited(s.id) ? '⛩' : c.isWished(s.id) ? '★' : '◦'}
                iconStyle={c.isVisited(s.id) ? styles.iconVisited : c.isWished(s.id) ? styles.iconWish : null}
                sub={c.isVisited(s.id) ? 'visité ✓' : null} />
            ))}
            {__DEV__ ? (
              <View style={[styles.option, { marginTop: 18 }]}>
                <Switch value={simulate} onValueChange={setSimulate} trackColor={{ true: colors.vermilion }} />
                <Text style={styles.optionText}>Mode simulation (tests de navigation)</Text>
              </View>
            ) : null}
          </>
        ) : null}

        {tab === 'wish' ? (
          <>
            {wishItems.length ? (
              <RouteBox items={wishItems} excluded={excluded} route={route} setRoute={setRoute} onStart={onStartCircuit} onFocusRoute={onFocusRoute} simulate={simulate} />
            ) : <Text style={styles.hint}>Ta liste est vide. Ouvre un sanctuaire et touche « ☆ À visiter » pour le garder pour plus tard.</Text>}
            {wishItems.map((s) => (
              <Item key={s.id} s={s} onPress={() => onSelect(s.id)} icon="★" iconStyle={styles.iconWish}
                sub={`Ajouté le ${fmtDate(s.addedAt)}`}
                right={(
                  <View style={styles.itemRight}>
                    {wishItems.length > 1 ? (
                      <Switch value={!excluded.has(s.id)} trackColor={{ true: colors.vermilion }} style={{ transform: [{ scale: 0.8 }] }}
                        onValueChange={(on) => setExcluded((e) => { const x = new Set(e); if (on) x.delete(s.id); else x.add(s.id); return x; })} />
                    ) : null}
                    <Pressable style={styles.smallBtn} onPress={() => c.toggleWish(s.id)}><Text style={styles.smallBtnText}>✕</Text></Pressable>
                  </View>
                )} />
            ))}
          </>
        ) : null}


        {tab === 'collection' ? (
          recent.length ? (
            <View style={styles.grid}>
              {recent.map(({ shrine: s }) => <CollectionCard key={s.id} id={s.id} width={cardW} onPress={() => onOpenCard(s.id)} />)}
            </View>
          ) : <Text style={styles.hint}>Ta collection est vide. Chaque sanctuaire visité te donne une carte postale.</Text>
        ) : null}
        {tab === 'collection' ? <Text style={styles.hint}>Une visite compte si ta position a été enregistrée à moins de 1 km du sanctuaire dans les 48 h précédentes (position gardée sur ton appareil, seule la position utilisée est envoyée avec la visite). Cela évite les cartes cochées depuis son canapé, mais pas la triche délibérée : un GPS falsifié trompe la vérification.</Text> : null}
        {tab === 'friends' ? <Friends onSelect={onSelect} cardWidth={cardW} onLogin={() => setTab('explore')} /> : null}
        <Text style={styles.credit}>Données © OpenStreetMap · photos Wikimedia Commons</Text>
      </BottomSheetScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  brandMark: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.vermilion, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#fff', fontSize: 19 },
  title: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 19, color: colors.ink },
  progress: { fontSize: 12, color: colors.muted, marginTop: 1 },
  bar: { height: 4, marginHorizontal: 16, marginBottom: 6, backgroundColor: colors.paper2, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.vermilion },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 8 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.vermilion },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  badge: { minWidth: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colors.vermilion, alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 16 },
  content: { padding: 16, paddingBottom: 60 },
  search: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.ink, marginBottom: 6 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  item: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.paper2 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  itemIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.paper2, alignItems: 'center', justifyContent: 'center' },
  itemIconText: { color: colors.muted, fontSize: 14 },
  iconVisited: { backgroundColor: colors.vermilion },
  iconWish: { backgroundColor: '#fff', borderWidth: 2, borderColor: colors.gold },
  itemName: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 15, color: colors.ink },
  itemRomaji: { fontSize: 11, color: colors.ink, opacity: 0.5 },
  itemSub: { fontSize: 12, color: colors.muted },
  itemRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  smallBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  smallBtnText: { fontSize: 12, color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  credit: { fontSize: 10, color: colors.muted, textAlign: 'center', marginTop: 24 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: '#fff', marginBottom: 12 },
  accountPitch: { flex: 1, fontSize: 12, color: colors.muted },
  accountAvatar: { width: 32, height: 32, borderRadius: 16 },
  accountName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  accountUsername: { fontSize: 11, color: colors.muted },
  link: { color: colors.vermilion, textDecorationLine: 'underline' },
  nameForm: { flexBasis: '100%', marginTop: 4 },
  nameLabel: { fontSize: 12, color: colors.ink, marginBottom: 6 },
  nameRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  accountStatus: { fontSize: 11, color: colors.green },
  googleBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  googleText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  routeBox: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: '#fff', padding: 12, marginBottom: 8 },
  routeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  routeTitle: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 17, color: colors.ink },
  modes: { flexDirection: 'row', backgroundColor: colors.paper2, borderRadius: 8, padding: 2 },
  mode: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  modeOn: { backgroundColor: '#fff' },
  modeText: { fontSize: 12, color: colors.muted },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  optionText: { fontSize: 13, color: colors.ink },
  goBtn: { backgroundColor: colors.vermilion, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  goText: { color: '#fff', fontWeight: '700' },
  error: { color: colors.vermilion, fontSize: 12, marginTop: 8 },
  summary: { fontWeight: '700', fontSize: 14, color: colors.ink, marginBottom: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.vermilion, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepName: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 14, color: colors.ink },
  stepLeg: { fontSize: 11, color: colors.muted },
  routeActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
});
