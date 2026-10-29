// Onglet « Amis » (comptes connectés avec un nom d'utilisateur) : recherche dans ses amis,
// bouton pour en ajouter, demandes reçues, puis une carte par ami (photo, nom, dernier
// sanctuaire visité, nombre de cartes). Toucher un ami ouvre son profil (FriendProfile).
// Serveur : api/friends.js — seuls les noms d'utilisateur circulent.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Text, { withFont } from './Text';
import { SvgXml } from 'react-native-svg';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Avatar } from './AccountScreen';
import Torii from './Torii';
import { apiJson } from '../lib/api';
import { byId, useCollection } from '../state/CollectionContext';
import { colors, fonts } from '../theme';

const ADD_FRIEND = `<svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="8" r="4" fill="#ffffff" stroke="none"/><path d="M2.5 21c.5-4.2 3.6-6.6 7.5-6.6s7 2.4 7.5 6.6z" fill="#ffffff" stroke="none"/><path d="M19.5 4v6M16.5 7h6"/></svg>`;

function FriendRow({ friend, onPress }) {
  const last = friend.last && byId.get(friend.last.id);
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <Avatar name={friend.username} uri={friend.avatar} size={50} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>@{friend.username}</Text>
        <Text style={styles.sub} numberOfLines={1}>{last ? last.name : 'Pas encore de visite'}</Text>
      </View>
      <View style={styles.toriiBox}>
        <Torii size={22} color={colors.accentStrong} />
        <View style={styles.count}><Text style={styles.countText}>{friend.count}</Text></View>
      </View>
    </Pressable>
  );
}

export default function Friends({ onLogin, onOpenFriend }) {
  const c = useCollection();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const call = useCallback(async (opts = {}) => {
    const token = await c.freshToken();
    if (!token) throw new Error('connecte-toi avec Google');
    return apiJson('/api/friends', { token, ...opts });
  }, [c.freshToken]);

  const load = useCallback(async () => {
    try { setData(await call()); setError(''); } catch (err) { setError(err.message); }
  }, [call]);

  useEffect(() => { if (c.user && c.username) load(); }, [!!c.user, c.username]);

  const act = async (action, username) => {
    try {
      await call({ method: 'POST', body: { action, username } });
      setError('');
      if (action === 'add') setQuery('');
    } catch (err) { setError(err.message); }
    load();
  };

  const q = query.trim().replace(/^@/, '').toLowerCase();
  const shown = useMemo(() => (data?.friends || []).filter((f) => !q || f.username.toLowerCase().includes(q)), [data, q]);
  const isKnown = data && [...data.friends.map((f) => f.username), ...data.outgoing, ...data.incoming].some((u) => u.toLowerCase() === q);
  const add = () => {
    if (!q) { Alert.alert('Ajouter un ami', "Tape son nom d'utilisateur dans la barre de recherche, puis touche ce bouton."); return; }
    act('add', q);
  };

  if (!c.user) {
    return (
      <View>
        <Text style={styles.hint}>Connecte-toi pour ajouter des amis et voir leurs collections.</Text>
        <Pressable style={[styles.primaryBtn, { alignSelf: 'flex-start' }]} onPress={onLogin}><Text style={styles.primaryText}>Se connecter</Text></Pressable>
      </View>
    );
  }
  if (!c.username) {
    return (
      <View>
        <Text style={styles.hint}>Choisis d'abord ton nom d'utilisateur public : c'est par ce nom que tes amis te trouvent.</Text>
        <Pressable style={[styles.primaryBtn, { alignSelf: 'flex-start' }]} onPress={onLogin}><Text style={styles.primaryText}>Choisir mon nom</Text></Pressable>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.searchRow}>
        <BottomSheetTextInput style={withFont(styles.input)} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false}
          placeholder="Rechercher ou ajouter un ami" placeholderTextColor={colors.muted} maxLength={21} returnKeyType="send" onSubmitEditing={() => q && !isKnown && add()} />
        <Pressable style={styles.addBtn} onPress={add} hitSlop={6} accessibilityLabel="Ajouter un ami">
          <SvgXml xml={ADD_FRIEND} width={24} height={24} />
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!data ? <Text style={styles.hint}>Chargement…</Text> : (
        <>
          {data.incoming.map((u) => (
            <View key={u} style={[styles.card, styles.request]}>
              <Avatar name={u} uri={null} size={50} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>@{u}</Text>
                <Text style={styles.sub}>veut être ton ami</Text>
              </View>
              <Pressable style={styles.primaryBtn} onPress={() => act('add', u)}><Text style={styles.primaryText}>Accepter</Text></Pressable>
              <Pressable style={styles.smallBtn} onPress={() => act('remove', u)} hitSlop={6}><Text style={styles.smallText}>✕</Text></Pressable>
            </View>
          ))}

          {shown.map((f) => <FriendRow key={f.username} friend={f} onPress={() => onOpenFriend(f)} />)}

          {q && !isKnown && q.length >= 3 ? (
            <Pressable style={[styles.card, styles.invite]} onPress={add}>
              <Text style={[styles.sub, { flex: 1 }]}>Envoyer une demande d'ami à <Text style={{ fontWeight: '700', color: colors.ink }}>@{q}</Text></Text>
              <Text style={styles.inviteGo}>Ajouter</Text>
            </Pressable>
          ) : null}
          {!data.friends.length && !q ? <Text style={styles.hint}>Pas encore d'amis. Tape le nom d'utilisateur d'un ami et touche le bouton à côté de la recherche.</Text> : null}

          {data.outgoing.length ? <Text style={styles.title}>Demandes envoyées</Text> : null}
          {data.outgoing.map((u) => (
            <View key={u} style={styles.pending}>
              <Text style={[styles.sub, { flex: 1 }]}>@{u} · en attente</Text>
              <Pressable onPress={() => act('remove', u)} hitSlop={6}><Text style={styles.cancel}>Annuler</Text></Pressable>
            </View>
          ))}
        </>
      )}
      <Text style={[styles.hint, { marginTop: 14 }]}>Tu es <Text style={{ fontWeight: '700' }}>@{c.username}</Text>. Tes amis voient tes cartes postales (sanctuaires et dates), jamais tes notes ni ta position.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginVertical: 8 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 6 },
  title: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 15, color: colors.ink, marginTop: 14, marginBottom: 4 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 },
  input: { flex: 1, borderRadius: 12, backgroundColor: colors.paper2, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.ink },
  addBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accentStrong, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: colors.paper2, marginBottom: 8 },
  request: { borderWidth: 1, borderColor: colors.soft },
  invite: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', paddingVertical: 14 },
  inviteGo: { color: colors.accentStrong, fontWeight: '700' },
  name: { fontSize: 16, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  toriiBox: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', right: -6, bottom: -6, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, backgroundColor: colors.accentStrong, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.paper2 },
  countText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  pending: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  cancel: { color: colors.accentStrong, fontSize: 13, fontWeight: '600' },
  primaryBtn: { backgroundColor: colors.accentStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  smallBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  smallText: { fontSize: 12, color: colors.ink },
});
