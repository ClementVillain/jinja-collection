// Onglet « Amis » (comptes connectés avec un nom d'utilisateur) : ajouter un ami par son nom,
// accepter / refuser les demandes, voir la collection d'un ami et son dernier sanctuaire visité.
// Serveur : api/friends.js — seuls les noms d'utilisateur circulent.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Text, { withFont } from './Text';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Postcard, useCoverPhoto } from './PostcardModal';
import { apiJson } from '../lib/api';
import { byId, useCollection } from '../state/CollectionContext';
import { fmtDate } from '../lib/text';
import { colors, fonts } from '../theme';

function FriendCard({ id, entry, width, onPress }) {
  const photo = useCoverPhoto(id);
  return <Pressable onPress={onPress}><Postcard id={id} entry={entry} width={width} photo={photo} /></Pressable>;
}

export default function Friends({ onSelect, cardWidth, onLogin }) {
  const c = useCollection();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [view, setView] = useState(null); // { username, visits }

  const call = useCallback(async (opts = {}, query = '') => {
    const token = await c.freshToken();
    if (!token) throw new Error('connecte-toi avec Google');
    return apiJson(`/api/friends${query}`, { token, ...opts });
  }, [c.freshToken]);

  const load = useCallback(async () => {
    try { setData(await call()); setError(''); } catch (err) { setError(err.message); }
  }, [call]);

  useEffect(() => { if (c.user && c.username) load(); }, [!!c.user, c.username]);

  const act = async (action, username) => {
    try { await call({ method: 'POST', body: { action, username } }); setError(''); if (action === 'add') setName(''); } catch (err) { setError(err.message); }
    load();
  };
  const confirmRemove = (username) => Alert.alert(`Retirer @${username} ?`, '', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Retirer', style: 'destructive', onPress: () => act('remove', username) },
  ]);
  const open = async (username) => {
    setView({ username, visits: null });
    try { setView(await call({}, `?user=${encodeURIComponent(username)}`)); } catch (err) { setView(null); setError(err.message); }
  };

  const ordered = useMemo(() => Object.entries(view?.visits || {})
    .filter(([id]) => byId.has(id))
    .sort((a, b) => a[1].date.localeCompare(b[1].date))
    .map(([id, visit], i) => ({ id, visit, number: i + 1 }))
    .reverse(), [view]);

  if (!c.user) {
    return (
      <View>
        <Text style={styles.hint}>Connecte-toi avec Google pour ajouter des amis et voir leurs collections.</Text>
        <Pressable style={styles.primaryBtn} onPress={onLogin}><Text style={styles.primaryText}>Se connecter</Text></Pressable>
      </View>
    );
  }
  if (!c.username) {
    return <Text style={styles.hint}>Choisis d'abord ton nom d'utilisateur public (onglet Explorer, encart du compte) : c'est par ce nom que tes amis te trouvent.</Text>;
  }

  if (view) {
    return (
      <View>
        <Pressable style={[styles.smallBtn, { alignSelf: 'flex-start' }]} onPress={() => setView(null)}><Text style={styles.smallText}>← Amis</Text></Pressable>
        <Text style={styles.title}>Collection de @{view.username}{view.visits ? ` · ${ordered.length} carte${ordered.length > 1 ? 's' : ''}` : ''}</Text>
        {!view.visits ? <Text style={styles.hint}>Chargement…</Text> : ordered.length ? (
          <View style={styles.grid}>
            {ordered.map(({ id, visit, number }) => (
              <FriendCard key={id} id={id} entry={{ visit, number }} width={cardWidth} onPress={() => onSelect(id)} />
            ))}
          </View>
        ) : <Text style={styles.hint}>Sa collection est encore vide.</Text>}
      </View>
    );
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.addRow}>
        <BottomSheetTextInput style={withFont(styles.input)} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false}
          placeholder="Nom d'utilisateur d'un ami" placeholderTextColor={colors.muted} maxLength={20} onSubmitEditing={() => name.trim() && act('add', name.trim())} />
        <Pressable style={styles.primaryBtn} onPress={() => name.trim() && act('add', name.trim())}><Text style={styles.primaryText}>Ajouter</Text></Pressable>
      </View>
      <Text style={styles.hint}>Tu es <Text style={{ fontWeight: '700' }}>@{c.username}</Text>. Tes amis voient tes cartes postales (sanctuaires et dates), jamais tes notes ni ta position.</Text>
      {!data ? <Text style={styles.hint}>Chargement…</Text> : (
        <>
          {data.incoming.length ? <Text style={styles.title}>Demandes reçues</Text> : null}
          {data.incoming.map((u) => (
            <View key={u} style={styles.row}>
              <Text style={styles.name}>@{u}</Text>
              <Pressable style={styles.primaryBtn} onPress={() => act('add', u)}><Text style={styles.primaryText}>Accepter</Text></Pressable>
              <Pressable style={styles.smallBtn} onPress={() => act('remove', u)}><Text style={styles.smallText}>Refuser</Text></Pressable>
            </View>
          ))}
          <Text style={styles.title}>Mes amis</Text>
          {data.friends.length ? data.friends.map((f) => (
            <View key={f.username} style={styles.row}>
              <Pressable style={{ flex: 1 }} onPress={() => open(f.username)}>
                <Text style={styles.name}>@{f.username}</Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {f.count} carte{f.count > 1 ? 's' : ''}
                  {f.last && byId.has(f.last.id) ? (
                    <> · dernier : <Text style={styles.link} onPress={() => onSelect(f.last.id)}>{byId.get(f.last.id).name}</Text> ({fmtDate(f.last.date)})</>
                  ) : null}
                </Text>
              </Pressable>
              <Pressable style={styles.smallBtn} onPress={() => open(f.username)}><Text style={styles.smallText}>Collection</Text></Pressable>
              <Pressable style={styles.smallBtn} onPress={() => confirmRemove(f.username)}><Text style={styles.smallText}>✕</Text></Pressable>
            </View>
          )) : <Text style={styles.hint}>Pas encore d'amis. Ajoute-les par leur nom d'utilisateur.</Text>}
          {data.outgoing.length ? <Text style={styles.title}>Demandes envoyées</Text> : null}
          {data.outgoing.map((u) => (
            <View key={u} style={styles.row}>
              <Text style={[styles.name, { flex: 1 }]}>@{u} <Text style={styles.sub}>en attente</Text></Text>
              <Pressable style={styles.smallBtn} onPress={() => act('remove', u)}><Text style={styles.smallText}>Annuler</Text></Pressable>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginVertical: 8 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 6 },
  title: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 16, color: colors.ink, marginTop: 14, marginBottom: 6 },
  addRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.paper2 },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted },
  link: { color: colors.accentStrong, textDecorationLine: 'underline' },
  primaryBtn: { backgroundColor: colors.accentStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  smallBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  smallText: { fontSize: 12, color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
});
