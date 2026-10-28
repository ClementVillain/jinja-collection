// Bandeau de navigation : prochaine manœuvre en grand en haut, arrivée prévue et distance
// restante en bas, bouton pour recentrer, et carte d'arrivée avec « J'y suis allé ⛩ ».
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Nav from '../shared/navcore';
import Torii from './Torii';
import { colors, fonts } from '../theme';
import { fmtDistance, fmtDuration } from '../lib/text';

const rad = (d) => (d * Math.PI) / 180;

// Flèche de manœuvre (même dessin que sur le site).
function arrowXml(icon) {
  const svg = (body) => `<svg viewBox="0 0 48 48" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const head = (x, y, a) => {
    const p = (da) => `${(x - 11 * Math.sin(rad(a + da))).toFixed(1)},${(y + 11 * Math.cos(rad(a + da))).toFixed(1)}`;
    return `<polyline points="${p(-40)} ${x.toFixed(1)},${y.toFixed(1)} ${p(40)}"/>`;
  };
  if (icon === 'roundabout') return svg(`<circle cx="24" cy="20" r="9"/><path d="M24 44V29"/><path d="M30.4 13.6L38 6"/>${head(38, 6, 45)}`);
  if (icon === 'uturn') return svg(`<path d="M32 44V20a8 8 0 0 0-16 0v14"/>${head(16, 36, 180)}`);
  const angles = { straight: 0, 'slight-right': 45, right: 90, 'sharp-right': 135, 'slight-left': -45, left: -90, 'sharp-left': -135 };
  const a = angles[icon] ?? 0;
  const x = 24 + 15 * Math.sin(rad(a)), y = 24 - 15 * Math.cos(rad(a));
  return svg(`<path d="M24 44V24L${x.toFixed(1)} ${y.toFixed(1)}"/>${head(x, y, a)}`);
}

const clock = (sec) => new Date(Date.now() + sec * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function NavOverlay({ nav, onStop, onRecenter, onVisit, isVisited, onDismiss }) {
  const insets = useSafeAreaInsets();
  if (!nav) return null;
  const m = nav.maneuver;
  const target = nav.stops[Math.min(nav.target, nav.stops.length - 1)];
  const msg = nav.message;
  const lastArrived = nav.arrived[nav.arrived.length - 1];

  let banner;
  if (nav.fatal) {
    banner = <Text style={styles.instr}>{nav.fatal}</Text>;
  } else if (nav.finished) {
    banner = (
      <View>
        <View style={[styles.row, { gap: 10 }]}><Torii size={30} color="#ffffff" /><Text style={styles.dist}>Arrivé !</Text></View>
        <Text style={styles.instr}>{nav.circuit ? `Circuit terminé : ${nav.arrived.length} sanctuaire${nav.arrived.length > 1 ? 's' : ''}.` : lastArrived?.name}</Text>
      </View>
    );
  } else if (m) {
    banner = (
      <View style={styles.row}>
        <View style={styles.arrow}>
          {m.next.icon === 'arrive' ? <Torii size={38} color="#ffffff" /> : <SvgXml xml={arrowXml(m.next.icon)} width={46} height={46} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.dist}>{Nav.fmtNavDistance(m.distance)}</Text>
          <Text style={styles.instr} numberOfLines={3}>{m.next.text}</Text>
          {m.then ? <Text style={styles.then} numberOfLines={1}>Puis : {m.then.text}</Text> : null}
        </View>
      </View>
    );
  } else {
    banner = <Text style={styles.instr}>{nav.pos ? "Calcul de l'itinéraire…" : 'Recherche de ta position…'}</Text>;
  }

  const visitButton = (s) => (s && !isVisited(s.id) ? (
    <Pressable style={styles.visitBtn} onPress={() => onVisit(s.id)}>
      <View style={[styles.row, { gap: 8, justifyContent: 'center' }]}><Text style={styles.visitText}>J'y suis allé</Text><Torii size={18} color="#ffffff" /></View>
    </Pressable>
  ) : s ? <Text style={styles.visitedText}>✓ Déjà dans ta collection</Text> : null);

  return (
    <>
      <View style={[styles.top, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        {banner}
        {msg?.kind === 'error' || msg?.kind === 'info' ? (
          <Text style={[styles.msg, msg.kind === 'error' && styles.msgError]}>{msg.text}</Text>
        ) : null}
      </View>

      {msg?.kind === 'arrive' ? (
        <View style={styles.arriveCard}>
          <Text style={styles.arriveTitle}>Tu es arrivé à {msg.stop.name}</Text>
          {visitButton(msg.stop)}
          <Pressable onPress={onDismiss}><Text style={styles.next}>Continuer vers l'étape suivante →</Text></Pressable>
        </View>
      ) : null}
      {nav.finished && !nav.fatal ? (
        <View style={styles.arriveCard}>
          {visitButton(lastArrived)}
        </View>
      ) : null}

      {!nav.following && !nav.finished ? (
        <Pressable style={[styles.recenter, { bottom: insets.bottom + 96 }]} onPress={onRecenter}>
          <Text style={styles.recenterText}>◎ Recentrer</Text>
        </Pressable>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]}>
        <View style={{ flex: 1 }}>
          {nav.finished ? (
            <Text style={styles.eta}>Navigation terminée</Text>
          ) : nav.leftToStop != null ? (
            <>
              <Text style={styles.eta}>Arrivée {clock(nav.durationToStop)} · {fmtDuration(nav.durationToStop)}</Text>
              <Text style={styles.etaSub} numberOfLines={1}>
                {fmtDistance(nav.leftToStop)} jusqu'à {target.name}
                {nav.circuit ? ` · étape ${Math.min(nav.target + 1, nav.stops.length)}/${nav.stops.length}` : ''}
                {nav.simulate ? ' · simulation' : ''}
              </Text>
            </>
          ) : <Text style={styles.etaSub}>{target?.name}</Text>}
        </View>
        <Pressable style={styles.stop} onPress={onStop}>
          <Text style={styles.stopText}>{nav.finished ? 'Fermer' : 'Arrêter'}</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.ink, paddingHorizontal: 16, paddingBottom: 14, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  arrow: { width: 58, height: 58, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  arriveIcon: { fontSize: 34, color: '#fff' },
  dist: { color: '#fff', fontSize: 32, fontWeight: '800' },
  instr: { color: '#fff', fontSize: 19, fontWeight: '600', lineHeight: 24 },
  then: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 4 },
  msg: { color: '#fff', fontSize: 13, marginTop: 8, opacity: 0.9 },
  msgError: { color: '#ffd7cf', fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.paper, borderTopLeftRadius: 18, borderTopRightRadius: 18, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12 },
  eta: { fontSize: 18, fontWeight: '800', color: colors.ink },
  etaSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  stop: { backgroundColor: colors.accentStrong, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10 },
  stopText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  recenter: { position: 'absolute', alignSelf: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6 },
  recenterText: { fontWeight: '700', color: colors.ink },
  arriveCard: { position: 'absolute', left: 16, right: 16, bottom: 120, backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12 },
  arriveTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700', color: colors.ink },
  visitBtn: { backgroundColor: colors.accentStrong, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  visitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  visitedText: { color: colors.accentStrong, fontWeight: '700' },
  next: { color: colors.muted, textAlign: 'center', paddingVertical: 4 },
});
