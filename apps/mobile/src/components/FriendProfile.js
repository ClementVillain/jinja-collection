// Profil d'un ami, présenté comme « Mon compte » : bannière, photo, « Membre depuis »,
// statistiques, carte postale du dernier sanctuaire visité, puis toute sa collection.
// Lecture seule ; le bouton retour ou un balayage vers la droite ramène à l'onglet Amis.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, ImageBackground, Pressable, StyleSheet, View } from 'react-native';
import Text from './Text';
import { Postcard, useCoverPhoto } from './PostcardModal';
import { Avatar, BackButton, Stat, monthYear, profileStyles as styles } from './AccountScreen';
import { apiJson } from '../lib/api';
import { byId, prefectures, useCollection } from '../state/CollectionContext';
import { fmtDate } from '../lib/text';
import { colors } from '../theme';

function Card({ id, entry, width, onPress }) {
  const photo = useCoverPhoto(id);
  return <Pressable onPress={onPress}><Postcard id={id} entry={entry} width={width} photo={photo} /></Pressable>;
}

// friend : résumé venu de la liste ({ username, avatar, count }), affiché pendant le chargement.
export default function FriendProfile({ friend, cardWidth, onSelect, onRemoved, onBack }) {
  const c = useCollection();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await c.freshToken();
        const res = await apiJson(`/api/friends?user=${encodeURIComponent(friend.username)}`, { token });
        if (alive) setData(res);
      } catch (err) { if (alive) setError(err.message); }
    })();
    return () => { alive = false; };
  }, [friend.username]);

  const ordered = useMemo(() => Object.entries(data?.visits || {})
    .filter(([id]) => byId.has(id))
    .sort((a, b) => a[1].date.localeCompare(b[1].date))
    .map(([id, visit], i) => ({ id, visit, number: i + 1 }))
    .reverse(), [data]);
  const prefs = useMemo(() => new Set(ordered.map(({ id }) => byId.get(id).prefecture).filter(Boolean)), [ordered]);
  const discovered = useMemo(() => Object.entries(c.discoveries || {})
    .filter(([id, name]) => name === friend.username && byId.has(id)).length, [c.discoveries, friend.username]);
  const last = ordered[0];
  const fullWidth = Dimensions.get('window').width - 32;

  const remove = () => Alert.alert(`Retirer @${friend.username} de tes amis ?`, '', [
    { text: 'Annuler', style: 'cancel' },
    {
      text: 'Retirer', style: 'destructive', onPress: async () => {
        try {
          await apiJson('/api/friends', { token: await c.freshToken(), method: 'POST', body: { action: 'remove', username: friend.username } });
          onRemoved();
        } catch (err) { Alert.alert('Impossible de retirer cet ami', err.message); }
      },
    },
  ]);

  const banner = data?.banner;
  return (
    <View style={styles.wrap}>
      <ImageBackground source={banner ? { uri: banner } : null} style={styles.banner} imageStyle={styles.bannerImage}>
        {banner ? null : <View style={styles.bannerDefault}><View style={styles.bannerSoft} /></View>}
      </ImageBackground>
      <BackButton onPress={onBack} />
      <View style={[styles.center, styles.overBanner]}>
        <View style={styles.avatarRing}>
          <Avatar name={friend.username} uri={data ? data.avatar : friend.avatar} size={110} />
        </View>
        <Text style={styles.name}>@{friend.username}</Text>
        <Text style={styles.since}>{data?.since ? `Membre depuis ${monthYear(data.since)}` : ' '}</Text>
      </View>

      {error ? <Text style={[styles.error, { marginTop: 16 }]}>{error}</Text> : null}

      <View style={styles.stats}>
        <Stat value={data ? ordered.length : friend.count ?? '–'} label="Sanctuaires visités" />
        <Stat value={data ? `${prefs.size}/47` : '–'} label="Préfectures" sub={prefs.size ? [...prefs].slice(0, 3).map((p) => prefectures.get(p)?.ja).join(' · ') + (prefs.size > 3 ? '…' : '') : null} />
        <Stat value={discovered} label="Découvertes" sub="premier visiteur" />
        <Stat value={data?.friends ?? '–'} label="Amis" />
      </View>

      {data ? (
        last ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Dernier sanctuaire visité</Text>
              <Text style={styles.hint}>le {fmtDate(last.visit.date)}</Text>
              <Card id={last.id} entry={last} width={fullWidth} onPress={() => onSelect(last.id)} />
            </View>
            {ordered.length > 1 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sa collection · {ordered.length} cartes</Text>
                <View style={local.grid}>
                  {ordered.slice(1).map((e) => <Card key={e.id} id={e.id} entry={e} width={cardWidth} onPress={() => onSelect(e.id)} />)}
                </View>
              </View>
            ) : null}
          </>
        ) : <Text style={[styles.hint, { marginTop: 22, textAlign: 'center' }]}>Sa collection est encore vide.</Text>
      ) : !error ? <Text style={[styles.hint, { marginTop: 22, textAlign: 'center' }]}>Chargement…</Text> : null}

      <View style={styles.section}>
        <Pressable style={[styles.bigBtn, styles.logout]} onPress={remove}><Text style={[styles.logoutText, { color: colors.danger }]}>Retirer de mes amis</Text></Pressable>
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
});
