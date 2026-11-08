// « Envoyer à un ami » (fiche d'un sanctuaire) : la liste de ses amis (photo et nom), un toucher
// envoie le sanctuaire, puis « Envoyé à @nom ». Le destinataire le retrouve dans votre conversation
// (onglet Amis). Serveur : api/messages.js — seulement entre amis.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Text from './Text';
import JinjaMessages from '@jinja/shared/messages';
import { Avatar } from './AccountScreen';
import { apiJson } from '../lib/api';
import { KEYS } from '../lib/store';
import { useCollection } from '../state/CollectionContext';
import { colors } from '../theme';

export default function SendToFriend({ shrine, visible, onClose }) {
  const c = useCollection();
  const [friends, setFriends] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null); // { text, ok?, error? }
  const [busy, setBusy] = useState(false);
  const closeTimer = useRef(null);

  // Liste d'amis : celle gardée sur le téléphone d'abord, puis celle du serveur.
  const loadFriends = async () => {
    try {
      const fresh = await apiJson('/api/friends', { token: await c.freshToken() });
      setFriends(fresh.friends); setError('');
      c.writeAccountCache(KEYS.friends, fresh);
    } catch (err) { setError(err.message); }
  };
  useEffect(() => {
    if (!visible) return undefined;
    setStatus(null); setBusy(false);
    if (!c.username) return undefined;
    let alive = true;
    c.readAccountCache(KEYS.friends).then((cached) => { if (alive && cached) setFriends((f) => f || cached.friends); });
    loadFriends();
    return () => { alive = false; clearTimeout(closeTimer.current); };
  }, [visible, c.username]);

  const send = async (name) => {
    setBusy(true);
    setStatus({ text: 'Envoi…' });
    try {
      await apiJson('/api/messages', { token: await c.freshToken(), method: 'POST', body: { username: name, shrine: shrine.id } });
      setStatus({ ok: true, text: `Envoyé à @${name} ✓` });
      closeTimer.current = setTimeout(onClose, 1400);
    } catch (err) {
      // Rien n'est envoyé ; l'ami a peut-être été retiré entre-temps : liste relue.
      setStatus({ error: true, text: `Pas envoyé : ${err.message}` });
      setBusy(false);
      loadFriends();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.box} onPress={() => {}}>
          <Text style={styles.title}>Envoyer « {shrine.name} » à un ami</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {!c.username ? <Text style={styles.hint}>Choisis d'abord ton nom d'utilisateur public (écran du compte) : c'est par ce nom que tes amis te trouvent.</Text>
              : !friends ? (error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.muted} style={{ marginVertical: 16 }} />)
              : !friends.length ? <Text style={styles.hint}>{JinjaMessages.NO_FRIENDS}</Text>
              : friends.map((f) => (
                <Pressable key={f.username} style={({ pressed }) => [styles.row, (pressed || busy) && { opacity: 0.6 }]} disabled={busy} onPress={() => send(f.username)}>
                  <Avatar name={f.username} uri={f.avatar || null} size={40} />
                  <Text style={styles.name} numberOfLines={1}>@{f.username}</Text>
                </Pressable>
              ))}
          </ScrollView>
          {status ? <Text style={[styles.status, status.ok && styles.ok, status.error && styles.error]}>{status.text}</Text> : null}
          <Pressable style={styles.close} onPress={onClose}><Text style={styles.closeText}>Fermer</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(30,20,15,0.6)', justifyContent: 'center', padding: 16 },
  box: { backgroundColor: colors.paper, borderRadius: 16, padding: 18 },
  title: { fontWeight: '700', fontSize: 18, color: colors.ink, textAlign: 'center', marginBottom: 12 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: colors.paper2, marginBottom: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.ink },
  status: { fontSize: 13, color: colors.muted, marginTop: 6 },
  ok: { color: colors.accentStrong, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13 },
  close: { alignSelf: 'flex-end', marginTop: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#fff' },
  closeText: { color: colors.ink, fontWeight: '600' },
});
