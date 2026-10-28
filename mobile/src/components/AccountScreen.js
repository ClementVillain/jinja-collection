// Écran du compte, ouvert par l'avatar en haut à droite du volet.
// Non connecté : grand avatar vide et deux boutons (Google, Apple).
// Connecté : grand avatar, nom, « Membre depuis… », statistiques, nom public et amis,
// sanctuaires découverts en premier.
import { useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { byId, prefectures, useCollection } from '../state/CollectionContext';
import { latinName } from '../lib/text';
import { colors, fonts } from '../theme';

const PERSON = (color) => `<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4" fill="${color}"/><path d="M4 21c.6-4.4 3.9-7 8-7s7.4 2.6 8 7z" fill="${color}"/></svg>`;

// Avatar rond : photo de profil Google, sinon silhouette (utilisé aussi dans l'en-tête du volet).
export function Avatar({ user, size = 40 }) {
  if (user?.picture) return <Image source={{ uri: user.picture }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.paper2 }} />;
  const initial = user ? (user.givenName || user.name || '?').trim().charAt(0).toUpperCase() : '';
  return (
    <View style={[styles.avatarEmpty, { width: size, height: size, borderRadius: size / 2 }, user && { backgroundColor: colors.vermilion }]}>
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
        <BottomSheetTextInput style={[nameStyles.search, { flex: 1, marginBottom: 0 }]} value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false}
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
  goBtn: { backgroundColor: colors.vermilion, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  goText: { color: '#fff', fontWeight: '700' },
  error: { color: colors.vermilion, fontSize: 12, marginTop: 8 },
});

const monthYear = (iso) => new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

function Stat({ value, label, sub }) {
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

function SignedIn({ onSelect }) {
  const c = useCollection();
  const [editing, setEditing] = useState(false);
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
      <View style={styles.center}>
        <Avatar user={c.user} size={110} />
        <Text style={styles.name}>{name}</Text>
        {c.username && c.user.name && c.user.name !== 'Compte Apple' ? <Text style={styles.realName}>{c.user.name}</Text> : null}
        <Text style={styles.since}>{c.profile?.since ? `Membre depuis ${monthYear(c.profile.since)}` : ' '}</Text>
      </View>

      <View style={styles.stats}>
        <Stat value={visited.length} label="Sanctuaires visités" />
        <Stat value={`${prefs.size}/47`} label="Préfectures" sub={prefs.size ? [...prefs].slice(0, 3).map((p) => prefectures.get(p)?.ja).join(' · ') + (prefs.size > 3 ? '…' : '') : null} />
        <Stat value={discovered.length} label="Découvertes" sub="premier visiteur" />
        <Stat value={wished.length} label="À visiter" />
        <Stat value={c.profile?.friends ?? '–'} label="Amis" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nom public</Text>
        {c.username && !editing ? (
          <Text style={styles.text}>@{c.username} · <Text style={styles.link} onPress={() => setEditing(true)}>modifier</Text></Text>
        ) : <UsernameForm onDone={() => setEditing(false)} />}
        <Text style={styles.hint}>Visible par les autres : amis et « Découvert par ».</Text>
      </View>

      {discovered.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⛩ Visités en premier par toi</Text>
          {discovered.map((s) => (
            <Pressable key={s.id} style={styles.discovery} onPress={() => onSelect(s.id)}>
              <Text style={styles.discoveryName}>{s.name}</Text>
              <Text style={styles.discoverySub} numberOfLines={1}>{[latinName(s), prefectures.get(s.prefecture)?.ja].filter(Boolean).join(' · ')}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.hint, c.syncStatus.error && { color: colors.vermilion }]}>{c.syncStatus.text}</Text>
        <Pressable style={[styles.bigBtn, styles.logout]} onPress={c.signOut}><Text style={styles.logoutText}>Se déconnecter</Text></Pressable>
        <Text style={styles.credit}>Préfectures : 地球地図日本 (Global Map Japan, GSI)</Text>
      </View>
    </View>
  );
}

export default function AccountScreen({ onBack, onSelect }) {
  const c = useCollection();
  return (
    <View style={styles.wrap}>
      <Pressable style={styles.backRow} onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Retour</Text></Pressable>
      {c.user ? <SignedIn onSelect={onSelect} /> : <SignedOut onBack={onBack} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 40 },
  backRow: { paddingVertical: 4, marginBottom: 6 },
  back: { color: colors.muted, fontSize: 14 },
  center: { alignItems: 'center', gap: 10, paddingTop: 8 },
  avatarEmpty: { backgroundColor: '#8a8380', alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '700' },
  pitch: { textAlign: 'center', color: colors.muted, fontSize: 14, lineHeight: 20, marginVertical: 18, paddingHorizontal: 8 },
  bigBtn: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 12, paddingVertical: 15 },
  googleBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  googleG: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  googleText: { fontSize: 16, fontWeight: '600', color: colors.ink },
  appleBtn: { backgroundColor: '#000' },
  appleLogo: { fontSize: 19, color: '#fff', marginTop: -3 },
  appleText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  error: { color: colors.vermilion, fontSize: 13, textAlign: 'center' },
  name: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 24, color: colors.ink, marginTop: 6 },
  realName: { color: colors.muted, fontSize: 13, marginTop: -6 },
  since: { color: colors.muted, fontSize: 13 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 22 },
  stat: { flexBasis: '31%', flexGrow: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.vermilion },
  statLabel: { fontSize: 12, color: colors.ink, marginTop: 2, textAlign: 'center' },
  statSub: { fontSize: 10, color: colors.muted, marginTop: 2, textAlign: 'center' },
  section: { marginTop: 22, gap: 6 },
  sectionTitle: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 16, color: colors.ink },
  text: { fontSize: 14, color: colors.ink },
  link: { color: colors.vermilion, textDecorationLine: 'underline' },
  hint: { fontSize: 12, color: colors.muted },
  discovery: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.paper2 },
  discoveryName: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 15, color: colors.ink },
  discoverySub: { fontSize: 12, color: colors.muted },
  logout: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, marginTop: 6 },
  logoutText: { fontSize: 15, fontWeight: '600', color: colors.vermilion },
  credit: { fontSize: 10, color: colors.muted, textAlign: 'center', marginTop: 10 },
});
