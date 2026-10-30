// Écran du compte, ouvert par l'avatar en haut à droite du volet.
// Non connecté : grand avatar vide et deux boutons (Google, Apple).
// Connecté : grand avatar, nom, « Membre depuis… », statistiques, nom public et amis,
// sanctuaires découverts en premier.
import { useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, ImageBackground, Pressable, StyleSheet, View } from 'react-native';
import Text, { withFont } from './Text';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { SvgXml } from 'react-native-svg';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { byId, prefectures, useCollection } from '../state/CollectionContext';
import { latinName } from '../lib/text';
import Torii from './Torii';
import { colors, fonts } from '../theme';

const PERSON = (color) => `<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4" fill="${color}"/><path d="M4 21c.6-4.4 3.9-7 8-7s7.4 2.6 8 7z" fill="${color}"/></svg>`;

// Avatar rond : photo choisie dans le profil, sinon photo Google, sinon silhouette
// (utilisé aussi dans l'en-tête du volet). Pour un ami : `name` et `uri` (sa photo ou null).
export function Avatar({ user, size = 40, name, uri }) {
  const custom = useCollection()?.profile?.avatar;
  const picture = name !== undefined ? uri : user ? custom || user.picture : null;
  if (picture) return <Image source={{ uri: picture }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.paper2 }} />;
  const initial = (name || (user ? user.givenName || user.name || '?' : '')).trim().charAt(0).toUpperCase();
  return (
    <View style={[styles.avatarEmpty, { width: size, height: size, borderRadius: size / 2 }, initial && { backgroundColor: colors.accentStrong }]}>
      {initial ? <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
        : <SvgXml xml={PERSON('#ffffff')} width={size * 0.62} height={size * 0.62} />}
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
    <View style={nameStyles.nameForm}>
      <Text style={nameStyles.nameLabel}>{c.username ? 'Nouveau nom d’utilisateur' : 'Choisis ton nom d’utilisateur public'} <Text style={{ color: colors.muted }}>(visible par les autres : amis, « Découvert par »)</Text></Text>
      <View style={nameStyles.nameRow}>
        <BottomSheetTextInput style={withFont([nameStyles.search, { flex: 1, marginBottom: 0 }])} value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false}
          placeholder="ex : kitsune_77" placeholderTextColor={colors.muted} maxLength={20} onSubmitEditing={submit} />
        <Pressable style={[nameStyles.goBtn, { paddingHorizontal: 16 }, busy && { opacity: 0.5 }]} disabled={busy} onPress={submit}><Text style={nameStyles.goText}>OK</Text></Pressable>
      </View>
      {error ? <Text style={nameStyles.error}>{error}</Text> : null}
    </View>
  );
}

const nameStyles = StyleSheet.create({
  nameForm: { marginTop: 4 },
  nameLabel: { fontSize: 12, color: colors.ink, marginBottom: 6 },
  nameRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  search: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.ink },
  goBtn: { backgroundColor: colors.accentStrong, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  goText: { color: '#fff', fontWeight: '700' },
  error: { color: colors.danger, fontSize: 12, marginTop: 8 },
});

const CHEVRON = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Bouton retour rond, en haut à gauche de la bannière (compte et profil d'ami).
export function BackButton({ onPress }) {
  return (
    <Pressable style={styles.backBtn} onPress={onPress} hitSlop={10} accessibilityLabel="Retour">
      <SvgXml xml={CHEVRON} width={24} height={24} />
    </Pressable>
  );
}

export const monthYear = (iso) => new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function Stat({ value, label, sub }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function SignedOut({ onBack }) {
  const c = useCollection();
  const apple = () => {
    if (c.appleSignInAvailable) { c.signInWithApple(); return; }
    Alert.alert(
      'Bientôt disponible',
      "La connexion avec Apple sera activée quand l'app sera publiée sur l'App Store : elle demande le compte développeur Apple payant. En attendant, connecte-toi avec Google.",
    );
  };
  return (
    <View style={styles.center}>
      <Avatar size={110} />
      <Text style={styles.pitch}>Connecte-toi pour collectionner les sanctuaires, garder tes cartes postales et les retrouver sur le site et dans l'app.</Text>
      <Pressable style={[styles.bigBtn, styles.googleBtn]} onPress={c.signIn} disabled={!c.googleSignInAvailable}>
        <Text style={styles.googleG}>G</Text>
        <Text style={styles.googleText}>Se connecter avec Google</Text>
      </Pressable>
      <Pressable style={[styles.bigBtn, styles.appleBtn]} onPress={apple}>
        <Text style={styles.appleLogo}></Text>
        <Text style={styles.appleText}>Se connecter avec Apple</Text>
      </Pressable>
      {c.syncStatus.error ? <Text style={styles.error}>{c.syncStatus.text}</Text> : null}
      <Pressable onPress={onBack}><Text style={styles.back}>Continuer sans compte</Text></Pressable>
    </View>
  );
}

// Recadre au centre au format voulu, réduit, et réencode en JPEG (métadonnées et GPS retirés).
async function cropToJpeg(asset, [w, h]) {
  const ratio = w / h;
  let cw = asset.width, ch = asset.width / ratio;
  if (ch > asset.height) { ch = asset.height; cw = ch * ratio; }
  const ctx = ImageManipulator.manipulate(asset.uri);
  ctx.crop({ originX: (asset.width - cw) / 2, originY: (asset.height - ch) / 2, width: cw, height: ch });
  if (cw > w) ctx.resize({ width: w, height: h });
  const image = await ctx.renderAsync();
  return (await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG })).uri;
}
// Affichées en 110 px (avatar) et 130 px de haut (bannière) : ces tailles suffisent en @3x.
const IMAGE_SIZE = { avatar: [384, 384], banner: [1200, 400] };

function SignedIn({ onSelect, onBack }) {
  const c = useCollection();
  const [busy, setBusy] = useState(null); // 'avatar' | 'banner' pendant un envoi, 'logout' pendant la déconnexion

  const save = async (kind, asset) => {
    setBusy(kind);
    try { await c.setProfileImage(kind, asset ? await cropToJpeg(asset, IMAGE_SIZE[kind]) : null); }
    catch (err) { Alert.alert("L'image n'a pas pu être enregistrée", err.message); }
    finally { setBusy(null); }
  };
  const pick = async (kind, source) => {
    const options = { mediaTypes: ['images'], quality: 1, exif: false, ...(kind === 'avatar' ? { allowsEditing: true, aspect: [1, 1] } : {}) };
    if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      Alert.alert('Appareil photo', "Autorise l'appareil photo dans Réglages › Jinja Collection.");
      return;
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!res.canceled && res.assets?.[0]) save(kind, res.assets[0]);
  };
  const edit = (kind) => {
    const has = c.profile?.[kind];
    const options = ['Choisir dans la photothèque', 'Prendre une photo'];
    if (has) options.push(kind === 'avatar' ? 'Revenir à la photo Google' : 'Revenir à la bannière par défaut');
    options.push('Annuler');
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: has ? options.length - 2 : undefined, title: kind === 'avatar' ? 'Photo de profil' : 'Bannière' },
      (i) => {
        if (i === 0) pick(kind, 'library');
        else if (i === 1) pick(kind, 'camera');
        else if (has && i === 2) save(kind, null);
      },
    );
  };
  const visited = Object.keys(c.visits).filter((id) => byId.has(id));
  const wished = Object.keys(c.wishlist).filter((id) => byId.has(id) && !c.visits[id]);
  // Sanctuaires dont l'utilisateur est le premier visiteur vérifié (« Découvert par »).
  const discovered = useMemo(() => (c.username
    ? Object.entries(c.discoveries || {}).filter(([id, name]) => name === c.username && byId.has(id)).map(([id]) => byId.get(id))
    : []), [c.discoveries, c.username]);
  const prefs = useMemo(() => new Set(visited.map((id) => byId.get(id).prefecture).filter(Boolean)), [c.visits]);
  const name = c.username ? `@${c.username}` : c.user.name;

  return (
    <View>
      <Pressable onPress={() => edit('banner')} disabled={!!busy}>
        <ImageBackground source={c.profile?.banner ? { uri: c.profile.banner } : null} style={styles.banner} imageStyle={styles.bannerImage}>
          {c.profile?.banner ? null : <View style={styles.bannerDefault}><View style={styles.bannerSoft} /></View>}
          <View style={styles.bannerEdit}>{busy === 'banner' ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.bannerEditText}>✎ Bannière</Text>}</View>
        </ImageBackground>
      </Pressable>
      <BackButton onPress={onBack} />
      <View style={[styles.center, styles.overBanner]}>
        <Pressable onPress={() => edit('avatar')} disabled={!!busy} style={styles.avatarRing}>
          <Avatar user={c.user} size={110} />
          <View style={styles.avatarPen}>{busy === 'avatar' ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.penText}>✎</Text>}</View>
        </Pressable>
        <Text style={styles.name}>{name}</Text>
        {c.username && c.user.name && c.user.name !== 'Compte Apple' ? <Text style={styles.realName}>{c.user.name}</Text> : null}
        {c.syncStatus.text ? <Text style={[styles.sync, c.syncStatus.error && { color: colors.danger }]}>{c.syncStatus.text}</Text> : null}
        <Text style={styles.since}>{c.profile?.since ? `Membre depuis ${monthYear(c.profile.since)}` : ' '}</Text>
      </View>

      <View style={styles.stats}>
        <Stat value={visited.length} label="Sanctuaires visités" />
        <Stat value={`${prefs.size}/47`} label="Préfectures" sub={prefs.size ? [...prefs].slice(0, 3).map((p) => prefectures.get(p)?.ja).join(' · ') + (prefs.size > 3 ? '…' : '') : null} />
        <Stat value={discovered.length} label="Découvertes" sub="premier visiteur" />
        <Stat value={wished.length} label="À visiter" />
        <Stat value={c.profile?.friends ?? '–'} label="Amis" />
      </View>

      {/* Nom public : demandé tant qu'il n'a pas été choisi (nécessaire pour les amis et « Découvert par »). */}
      {c.username === null ? (
        <View style={styles.section}>
          <UsernameForm />
        </View>
      ) : null}

      {discovered.length ? (
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Torii size={18} color={colors.accentStrong} /><Text style={styles.sectionTitle}>Visités en premier par toi</Text></View>
          {discovered.map((s) => (
            <Pressable key={s.id} style={styles.discovery} onPress={() => onSelect(s.id)}>
              <Text style={styles.discoveryName}>{s.name}</Text>
              <Text style={styles.discoverySub} numberOfLines={1}>{[latinName(s), prefectures.get(s.prefecture)?.ja].filter(Boolean).join(' · ')}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Pressable style={[styles.bigBtn, styles.logout, busy === 'logout' && { opacity: 0.5 }]} disabled={!!busy} onPress={() => { setBusy('logout'); c.signOut(); }}>
          <Text style={styles.logoutText}>{busy === 'logout' ? 'Déconnexion…' : 'Se déconnecter'}</Text>
        </Pressable>
        <Text style={styles.credit}>Préfectures : 地球地図日本 (Global Map Japan, GSI)</Text>
      </View>
    </View>
  );
}

export default function AccountScreen({ onBack, onSelect }) {
  const c = useCollection();
  return (
    <View style={styles.wrap}>
      {c.user ? <SignedIn onSelect={onSelect} onBack={onBack} /> : <SignedOut onBack={onBack} />}
    </View>
  );
}

export const profileStyles = StyleSheet.create({
  banner: { height: 130, marginHorizontal: -16, justifyContent: 'flex-end', overflow: 'hidden' },
  bannerImage: { resizeMode: 'cover' },
  bannerDefault: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.accent },
  bannerSoft: { position: 'absolute', right: -60, top: -40, width: 260, height: 260, borderRadius: 130, backgroundColor: colors.soft, opacity: 0.6 },
  bannerEdit: { position: 'absolute', right: 10, bottom: 10, backgroundColor: 'rgba(29,30,24,0.6)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  bannerEditText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  overBanner: { marginTop: -62, paddingTop: 0 },
  avatarRing: { borderWidth: 4, borderColor: '#fff', borderRadius: 64, backgroundColor: '#fff' },
  avatarPen: { position: 'absolute', right: 0, bottom: 0, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(29,30,24,0.75)', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  penText: { color: '#fff', fontSize: 14 },
  backBtn: { position: 'absolute', left: 0, top: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(29,30,24,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  wrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  backRow: { paddingVertical: 4, marginBottom: 6 },
  back: { color: colors.muted, fontSize: 14 },
  center: { alignItems: 'center', gap: 10, paddingTop: 8 },
  avatarEmpty: { backgroundColor: '#9aa59c', alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '700' },
  pitch: { textAlign: 'center', color: colors.muted, fontSize: 14, lineHeight: 20, marginVertical: 18, paddingHorizontal: 8 },
  bigBtn: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 12, paddingVertical: 15 },
  googleBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  googleG: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  googleText: { fontSize: 16, fontWeight: '600', color: colors.ink },
  appleBtn: { backgroundColor: '#000' },
  appleLogo: { fontSize: 19, color: '#fff', marginTop: -3 },
  appleText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  name: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 24, color: colors.ink, marginTop: 6 },
  realName: { color: colors.muted, fontSize: 13, marginTop: -6 },
  since: { color: colors.muted, fontSize: 13 },
  sync: { color: colors.accentStrong, fontSize: 12, marginTop: -4 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 22 },
  stat: { flexBasis: '31%', flexGrow: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.accentStrong },
  statLabel: { fontSize: 12, color: colors.ink, marginTop: 2, textAlign: 'center' },
  statSub: { fontSize: 10, color: colors.muted, marginTop: 2, textAlign: 'center' },
  section: { marginTop: 22, gap: 6 },
  sectionTitle: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 16, color: colors.ink },
  text: { fontSize: 14, color: colors.ink },
  link: { color: colors.accentStrong, textDecorationLine: 'underline' },
  hint: { fontSize: 12, color: colors.muted },
  discovery: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.paper2 },
  discoveryName: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 15, color: colors.ink },
  discoverySub: { fontSize: 12, color: colors.muted },
  logout: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, marginTop: 6 },
  logoutText: { fontSize: 15, fontWeight: '600', color: colors.accentStrong },
  credit: { fontSize: 10, color: colors.muted, textAlign: 'center', marginTop: 10 },
});
const styles = profileStyles;
