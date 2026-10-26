// Fiche d'un sanctuaire (équivalent de la popup du site) : carrousel de photos, nom en kanji
// et romaji, « J'y suis allé » / « À visiter », « Y aller », lien Google Maps, et partage
// d'une photo prise sur place.
import { useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Dimensions, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import ShrineCard from '../shared/card';
import { coverSlides, creditOf, forgetPhoto, rememberAuthor } from '../lib/photos';
import { fmtDate, latinName } from '../lib/text';
import { useCollection } from '../state/CollectionContext';
import { colors, fonts } from '../theme';

const COVER_H = 190;

function CameraPlus({ size = 22 }) {
  return (
    <SvgXml width={size} height={size} xml={`<svg viewBox="0 0 24 24" fill="none" stroke="${colors.ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-1.8h6.6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5z"/><path d="M12 9.8v5.4M9.3 12.5h5.4"/></svg>`} />
  );
}

// Redimensionne à 1600 px max et réencode en JPEG : fichier léger, et les métadonnées
// (dont la position GPS) disparaissent au passage.
async function toJpeg(asset) {
  const big = Math.max(asset.width || 0, asset.height || 0);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (big > 1600) ctx.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
  const image = await ctx.renderAsync();
  const result = await image.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
  return result.uri;
}

function Cover({ shrine, slides, width, onAdd, uploading }) {
  const [index, setIndex] = useState(0);
  const noPhoto = slides && !slides.length;
  return (
    <View style={[styles.cover, { width, height: COVER_H }]}>
      {slides === null ? (
        <View style={styles.coverLoading}><ActivityIndicator color={colors.muted} /><Text style={styles.loadingText}>Recherche d'une photo…</Text></View>
      ) : noPhoto ? (
        <>
          <SvgXml xml={ShrineCard.renderScene(shrine)} width={width} height={COVER_H} preserveAspectRatio="xMidYMid slice" />
          <View style={[styles.credit, styles.creditLeft]}><Text style={styles.creditText}>Pas encore de photo · illustration</Text></View>
        </>
      ) : (
        <>
          <FlatList
            data={slides}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(p, i) => `${p.src}-${i}`}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <View style={{ width, height: COVER_H }}>
                <Image source={{ uri: item.src }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => { if (!item.credit) forgetPhoto(shrine.id); }} />
                <Pressable style={[styles.credit, styles.creditLeft, item.by?.picture && styles.creditAvatar]} onPress={() => item.href && Linking.openURL(item.href)}>
                  {item.by?.picture ? <Image source={{ uri: item.by.picture }} style={styles.avatar} /> : null}
                  <Text style={styles.creditText}>{creditOf(item)}</Text>
                </Pressable>
              </View>
            )}
          />
          {slides.length > 1 ? (
            <View style={styles.dots} pointerEvents="none">
              {slides.map((_, i) => <View key={i} style={[styles.dot, i === index && styles.dotOn]} />)}
            </View>
          ) : null}
        </>
      )}
      {onAdd ? (
        <Pressable onPress={onAdd} disabled={uploading} style={[styles.addBtn, noPhoto && styles.addBtnCenter, uploading && { opacity: 0.5 }]}>
          {uploading ? <ActivityIndicator color={colors.ink} /> : <CameraPlus size={noPhoto ? 28 : 20} />}
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ShrineDetail({ shrine, onClose, onNavigate, onOpenCard, onLoginHint }) {
  const c = useCollection();
  const [slides, setSlides] = useState(null);
  const [status, setStatus] = useState(null);
  const [uploading, setUploading] = useState(false);
  const width = Dimensions.get('window').width - 32;
  const visited = c.isVisited(shrine.id);
  const wished = c.isWished(shrine.id);
  const latin = latinName(shrine);

  useEffect(() => {
    let alive = true;
    setSlides(null);
    setStatus(null);
    coverSlides(shrine, c.community).then((s) => { if (alive) setSlides(s); }).catch(() => { if (alive) setSlides([]); });
    return () => { alive = false; };
  }, [shrine.id, c.community]);

  const pick = async (source) => {
    const options = { mediaTypes: ['images'], quality: 1, exif: false };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setStatus({ error: true, text: "Autorise l'appareil photo dans Réglages › Jinja Collection." }); return; }
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets?.[0]) return;
    setUploading(true);
    setStatus({ text: 'Envoi de la photo…' });
    try {
      const body = await c.uploadPhoto(shrine.id, await toJpeg(res.assets[0]));
      rememberAuthor(body.meta, body.by);
      const withWiki = slides?.[0] && !slides[0].by && slides[0].href && !slides[0].href.includes('vercel-storage');
      setStatus({ ok: true, text: withWiki ? 'Merci ! Ta photo est ajoutée au carrousel.' : 'Merci ! Ta photo est maintenant la couverture de ce sanctuaire.' });
    } catch (err) {
      setStatus({ error: true, text: `La photo n'a pas pu être envoyée : ${err.message}` });
    } finally {
      setUploading(false);
    }
  };

  const addPhoto = () => {
    if (!c.user) { onLoginHint(); return; }
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Prendre une photo', 'Choisir dans la photothèque', 'Annuler'], cancelButtonIndex: 2, title: 'Partager une photo de ce sanctuaire' },
      (i) => { if (i === 0) pick('camera'); else if (i === 1) pick('library'); },
    );
  };

  return (
    <View style={styles.wrap}>
      <Cover shrine={shrine} slides={slides} width={width} onAdd={c.community ? addPhoto : null} uploading={uploading} />
      <Pressable style={styles.close} onPress={onClose} hitSlop={10}><Text style={styles.closeText}>✕</Text></Pressable>

      <Text style={styles.name}>{shrine.name}</Text>
      {latin ? <Text style={styles.latin}>{latin}</Text> : null}
      <Text style={[styles.status, visited && styles.statusDone, wished && styles.statusWish]}>
        {visited ? `✓ Visité le ${fmtDate(c.visits[shrine.id].date)}` : wished ? '★ Dans ta liste « À visiter »' : 'Pas encore visité'}
      </Text>

      <View style={styles.actions}>
        {visited ? (
          <>
            <Pressable style={[styles.btn, styles.primary]} onPress={() => onOpenCard(shrine.id)}><Text style={styles.primaryText}>Voir ma carte</Text></Pressable>
            <Pressable style={[styles.btn, styles.ghost, { flex: 0, paddingHorizontal: 14 }]} onPress={() => c.unmarkVisited(shrine.id)}><Text style={styles.ghostText}>Retirer</Text></Pressable>
          </>
        ) : (
          <>
            <Pressable style={[styles.btn, styles.primary]} onPress={() => { c.markVisited(shrine.id); onOpenCard(shrine.id, true); }}>
              <Text style={styles.primaryText}>J'y suis allé ⛩</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.ghost, wished && styles.wishOn]} onPress={() => c.toggleWish(shrine.id)}>
              <Text style={[styles.ghostText, wished && { color: colors.goldText }]}>{wished ? '★ Retirer' : '☆ À visiter'}</Text>
            </Pressable>
          </>
        )}
      </View>
      {status ? <Text style={[styles.upload, status.ok && { color: colors.green }, status.error && { color: colors.vermilion }]}>{status.text}</Text> : null}

      <Pressable style={[styles.btn, styles.go]} onPress={() => onNavigate(shrine)}>
        <Text style={styles.goText}>➤ Y aller</Text>
      </Pressable>
      <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${shrine.lat}%2C${shrine.lon}`)}>
        <Text style={styles.gmaps}>Ouvrir dans Google Maps</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 24 },
  cover: { borderRadius: 14, overflow: 'hidden', backgroundColor: colors.paper2, marginBottom: 12 },
  coverLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  loadingText: { color: colors.muted, fontSize: 12 },
  credit: { position: 'absolute', bottom: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  creditLeft: { left: 8 },
  creditAvatar: { paddingLeft: 3, borderRadius: 14 },
  creditText: { color: '#fff', fontSize: 11 },
  avatar: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#fff' },
  dots: { position: 'absolute', top: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { backgroundColor: '#fff' },
  addBtn: { position: 'absolute', right: 8, bottom: 8, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  addBtnCenter: { right: undefined, bottom: undefined, alignSelf: 'center', top: COVER_H / 2 - 30, width: 60, height: 60, borderRadius: 30 },
  close: { position: 'absolute', top: 8, right: 24, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  name: { fontFamily: fonts.serif, fontWeight: '700', fontSize: 24, color: colors.ink },
  latin: { fontSize: 13, color: colors.ink, opacity: 0.55, marginTop: 2, letterSpacing: 0.3 },
  status: { marginVertical: 10, fontSize: 14, color: colors.muted },
  statusDone: { color: colors.vermilion, fontWeight: '700' },
  statusWish: { color: colors.goldText, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.vermilion },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghost: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  ghostText: { color: colors.ink, fontWeight: '600', fontSize: 15 },
  wishOn: { borderColor: colors.gold },
  upload: { fontSize: 13, color: colors.muted, marginTop: 8 },
  go: { flex: 0, marginTop: 10, backgroundColor: colors.ink },
  goText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  gmaps: { textAlign: 'center', color: colors.muted, fontSize: 13, marginTop: 12, textDecorationLine: 'underline' },
});
