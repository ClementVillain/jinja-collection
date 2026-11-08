// Conversation avec un ami (toucher un ami dans l'onglet Amis) : les sanctuaires envoyés et
// reçus, plus ancien en haut ; mes envois à droite (olive), les siens à gauche. Chaque bulle :
// photo de couverture, nom, romaji et préfecture, date, et « Voir sur la carte ». Son nom ou sa
// photo, ou « Voir le profil », ouvrent son profil (FriendProfile). Pas de texte libre.
// Serveur : api/messages.js (ouvrir la conversation marque ses envois comme lus).
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Text from './Text';
import JinjaMessages from '@jinja/shared/messages';
import { Avatar, BackButton } from './AccountScreen';
import { useCoverPhoto } from './PostcardModal';
import Torii from './Torii';
import { apiJson } from '../lib/api';
import { latinName } from '../lib/text';
import { byId, prefectures, useCollection } from '../state/CollectionContext';
import { colors } from '../theme';

function Bubble({ message, onShowOnMap }) {
  const s = byId.get(message.shrine);
  const photo = useCoverPhoto(message.shrine);
  const mine = message.mine;
  const when = new Date(message.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const place = s ? [latinName(s), prefectures.get(s.prefecture)?.ja].filter(Boolean).join(' · ') : JinjaMessages.UNKNOWN_SHRINE;
  return (
    <View style={[styles.msg, mine && styles.msgMine]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {s ? (
          <View style={styles.cover}>
            {photo ? <Image source={{ uri: photo.src }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Torii size={34} color={colors.accentStrong} />}
          </View>
        ) : null}
        <View style={styles.body}>
          <Text style={[styles.name, mine && styles.textMine]}>{s ? s.name : 'Sanctuaire introuvable'}</Text>
          {place ? <Text style={[styles.place, mine && styles.textMine]}>{place}</Text> : null}
          <Pressable style={[styles.go, !s && { opacity: 0.5 }]} disabled={!s} onPress={() => onShowOnMap(message.shrine)}>
            <Text style={styles.goText}>Voir sur la carte</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.date}>{mine ? 'Envoyé' : 'Reçu'} le {when}</Text>
    </View>
  );
}

// friend : { username, avatar } venu de la liste d'amis. onLoaded : fil affiché (pour défiler en bas).
export default function Conversation({ friend, onBack, onProfile, onShowOnMap, onLoaded }) {
  const c = useCollection();
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await c.freshToken();
        const res = await apiJson(`/api/messages?user=${encodeURIComponent(friend.username)}`, { token });
        if (!alive) return;
        setMessages(JinjaMessages.sortThread(res.messages));
        setError('');
        c.markChatRead(friend.username);
      } catch (err) { if (alive) setError(err.message); }
    })();
    return () => { alive = false; };
  }, [friend.username]);

  useEffect(() => { if (messages?.length) setTimeout(() => onLoaded?.(), 50); }, [messages]);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <BackButton onPress={onBack} />
        <Pressable style={styles.who} onPress={onProfile} accessibilityLabel={`Profil de @${friend.username}`}>
          <Avatar name={friend.username} uri={friend.avatar || null} size={44} />
          <Text style={styles.whoName} numberOfLines={1}>@{friend.username}</Text>
        </Pressable>
        <Pressable style={styles.profileBtn} onPress={onProfile} hitSlop={6}><Text style={styles.profileText}>Voir le profil</Text></Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!messages ? (!error ? <Text style={styles.hint}>Chargement…</Text> : null)
        : messages.length ? messages.map((m, i) => <Bubble key={`${m.date}-${i}`} message={m} onShowOnMap={onShowOnMap} />)
        : <Text style={styles.hint}>{JinjaMessages.EMPTY_THREAD}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62, paddingLeft: 54, paddingBottom: 10, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  whoName: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: colors.ink },
  profileBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  profileText: { fontSize: 12, color: colors.ink, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13, marginBottom: 8 },
  hint: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 22 },
  msg: { alignSelf: 'flex-start', alignItems: 'flex-start', width: '82%', marginBottom: 14 },
  msgMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { width: '100%', overflow: 'hidden', borderRadius: 16 },
  bubbleTheirs: { backgroundColor: colors.paper2, borderBottomLeftRadius: 4 },
  bubbleMine: { backgroundColor: colors.accentStrong, borderBottomRightRadius: 4 },
  cover: { height: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft },
  body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 3 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  place: { fontSize: 12, color: colors.muted },
  textMine: { color: '#fff' },
  go: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  goText: { color: colors.accentStrong, fontWeight: '700', fontSize: 12 },
  date: { fontSize: 11, color: colors.muted, marginTop: 3 },
});
