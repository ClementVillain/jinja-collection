// Carte postale d'un sanctuaire visité : même dessin que sur le site (card.js), avec la photo
// de couverture quand il y en a une, une note de visite, et le partage de la carte en image.
import { useEffect, useRef, useState } from 'react';
import { Dimensions, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import ShrineCard from '../shared/card';
import { coverSlides, creditOf } from '../lib/photos';
import { useCollection, byId } from '../state/CollectionContext';
import { colors, fonts } from '../theme';

// Crédit en texte simple sur la carte.
const cardCredit = (photo) => creditOf(photo).replace(/^Photo de /, '');

export function Postcard({ id, width, photo }) {
  const c = useCollection();
  const shrine = byId.get(id);
  const entry = c.visitedOrdered.find((v) => v.shrine.id === id);
  if (!shrine || !entry) return null;
  const xml = ShrineCard.render(shrine, entry.visit, entry.number, photo ? { src: photo.src, credit: cardCredit(photo) } : undefined);
  return <SvgXml xml={xml} width={width} height={width * (520 / 600)} />;
}

// Photo de couverture du sanctuaire (la même que dans sa fiche), pour illustrer la carte.
export function useCoverPhoto(id) {
  const c = useCollection();
  const [photo, setPhoto] = useState(null);
  useEffect(() => {
    let alive = true;
    const s = byId.get(id);
    if (s) coverSlides(s, c.community).then((slides) => { if (alive) setPhoto(slides[0] || null); }).catch(() => {});
    return () => { alive = false; };
  }, [id, c.community]);
  return photo;
}

export default function PostcardModal({ id, isNew, onClose }) {
  const c = useCollection();
  const shot = useRef(null);
  const photo = useCoverPhoto(id);
  const [note, setNote] = useState('');
  const width = Dimensions.get('window').width - 48;
  const shrine = byId.get(id);

  useEffect(() => { setNote(c.visits[id]?.note || ''); }, [id]);

  const share = async () => {
    try {
      const uri = await captureRef(shot, { format: 'png', quality: 1 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: shrine?.name });
    } catch { /* partage annulé */ }
  };

  return (
    <Modal visible={!!id} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.body}>
          <Text style={styles.title}>{isNew ? '✨ Nouvelle carte obtenue !' : shrine?.name}</Text>
          <View ref={shot} collapsable={false} style={{ backgroundColor: 'transparent' }}>
            {id ? <Postcard id={id} width={width} photo={photo} /> : null}
          </View>
          <Text style={styles.label}>Note de visite</Text>
          <TextInput
            style={styles.note}
            value={note}
            onChangeText={setNote}
            onEndEditing={() => c.setNote(id, note)}
            placeholder="Un souvenir, un omamori acheté, la météo…"
            placeholderTextColor={colors.muted}
            multiline
          />
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.ghost]} onPress={share}><Text style={styles.ghostText}>Partager la carte</Text></Pressable>
            <Pressable style={[styles.btn, styles.primary]} onPress={() => { c.setNote(id, note); onClose(); }}><Text style={styles.primaryText}>Fermer</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(30,20,15,0.6)', justifyContent: 'center', padding: 12 },
  body: { backgroundColor: colors.paper, borderRadius: 18, padding: 12, gap: 10 },
  title: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 20, textAlign: 'center', color: colors.ink },
  label: { fontSize: 13, color: colors.muted },
  note: { minHeight: 60, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: '#fff', padding: 10, fontSize: 15, color: colors.ink },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  btn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16 },
  primary: { backgroundColor: colors.vermilion },
  primaryText: { color: '#fff', fontWeight: '700' },
  ghost: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  ghostText: { color: colors.ink, fontWeight: '600' },
});
