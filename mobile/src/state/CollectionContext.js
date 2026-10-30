// État de la collection : visites, liste « À visiter », photos partagées et compte Google.
// Même modèle de données que le site web ({ visits, deleted, wishlist, wishDeleted }) et même
// fusion (merge.js) : le compte Google synchronise le site et l'app.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image } from 'react-native';
import * as Location from 'expo-location';
import JinjaMerge from '../shared/merge';
import JinjaProximity from '../shared/proximity';
import { API_BASE, APPLE_SIGN_IN, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, apiJson } from '../lib/api';
import { KEYS, loadJson, saveJson } from '../lib/store';
import { clearPhotoCache, fetchCommunityPhotos } from '../lib/photos';
import rawData from '../data/shrines.json';

// Données des sanctuaires (OpenStreetMap), chargées une fois.
export const shrines = rawData.shrines.map(([id, name, nameLatin, lat, lon, photo, romaji = '', prefecture = 0]) => ({
  id, name, nameLatin, lat, lon, photo, romaji, prefecture,
}));
// Préfectures : code JIS → [nom japonais, nom latin] (contours 地球地図日本 / GSI).
export const prefectures = new Map((rawData.prefectures || []).map(([code, ja, en]) => [code, { ja, en }]));
export const byId = new Map(shrines.map((s) => [s.id, s]));

// Module de connexion Google : seulement si l'app a été construite avec l'ID client iOS.
let GoogleSignin = null;
if (GOOGLE_IOS_CLIENT_ID) {
  try {
    ({ GoogleSignin } = require('@react-native-google-signin/google-signin'));
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID });
  } catch { GoogleSignin = null; }
}
export const googleSignInAvailable = !!GoogleSignin;

// Module « Se connecter avec Apple » (présent seulement si l'app a la capacité correspondante).
let AppleAuth = null;
if (APPLE_SIGN_IN) {
  try { AppleAuth = require('expo-apple-authentication'); } catch { AppleAuth = null; }
}
export const appleSignInAvailable = !!AppleAuth;

function jwtPayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(Array.from(global.atob(b64), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    return JSON.parse(json);
  } catch { return null; }
}

const Ctx = createContext(null);
export const useCollection = () => useContext(Ctx);

export function CollectionProvider({ children }) {
  const [state, setState] = useState({ visits: {}, deleted: {}, wishlist: {}, wishDeleted: {} });
  const [ready, setReady] = useState(false);
  const [community, setCommunity] = useState(null);
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState({ text: '', error: false });
  // Nom d'utilisateur public (undefined : pas encore lu ; null : pas encore choisi).
  const [username, setUsernameState] = useState(undefined);
  // Profil du compte : date d'inscription et nombre d'amis (null tant que non chargé).
  const [profile, setProfile] = useState(null);
  // Dernières valeurs, pour réécrire le cache du profil depuis les fonctions asynchrones.
  const profileRef = useRef(null);
  profileRef.current = profile;
  const usernameRef = useRef(undefined);
  usernameRef.current = username;
  // « Découvert par » : { idSanctuaire: nom du premier visiteur vérifié }.
  const [discoveries, setDiscoveries] = useState({});
  const stateRef = useRef(state);
  const tokenRef = useRef(null);
  const syncTimer = useRef(null);
  const syncing = useRef(false);
  const syncAgain = useRef(false);
  // Passages récents (positions GPS des 48 dernières heures), gardés seulement sur le téléphone.
  const sightings = useRef([]);
  // Incrémenté à la déconnexion : une synchro encore en cours ne doit plus rien réécrire.
  const epoch = useRef(0);
  // Nombre de déconnexions : l'interface s'en sert pour fermer ce qui reste du compte (profil d'ami…).
  const [signOuts, setSignOuts] = useState(0);

  // ---------- Chargement ----------
  useEffect(() => {
    (async () => {
      const [visits, deleted, wishlist, wishDeleted] = await Promise.all(
        [KEYS.visits, KEYS.deleted, KEYS.wishlist, KEYS.wishDeleted].map((k) => loadJson(k)),
      );
      const loaded = { visits, deleted, wishlist, wishDeleted };
      stateRef.current = loaded;
      setState(loaded);
      setReady(true);
      sightings.current = await loadJson(KEYS.sightings, []);
      setToken(await loadJson(KEYS.googleToken, null));
      if (GoogleSignin && !tokenRef.current) silentLogin();
      else if (tokenRef.current) syncNow();
    })();
    refreshCommunity();
    refreshDiscoveries();
  }, []);

  const refreshDiscoveries = useCallback(() => {
    apiJson('/api/discoveries').then(setDiscoveries).catch(() => {});
  }, []);

  const refreshCommunity = useCallback(() => {
    fetchCommunityPhotos().then(setCommunity).catch(() => setCommunity((c) => c || {}));
  }, []);

  // ---------- Écriture ----------
  const persist = (next) => {
    stateRef.current = next;
    setState(next);
    saveJson(KEYS.visits, next.visits);
    saveJson(KEYS.deleted, next.deleted);
    saveJson(KEYS.wishlist, next.wishlist);
    saveJson(KEYS.wishDeleted, next.wishDeleted);
  };
  // Collectionner (visites, « À visiter », notes) demande un compte Google connecté.
  const update = (fn) => {
    if (!tokenRef.current) return;
    const cur = stateRef.current;
    const next = fn({
      visits: { ...cur.visits }, deleted: { ...cur.deleted }, wishlist: { ...cur.wishlist }, wishDeleted: { ...cur.wishDeleted },
    });
    persist(next);
    scheduleSync();
  };

  const isVisited = useCallback((id) => Object.prototype.hasOwnProperty.call(state.visits, id), [state]);
  const isWished = useCallback((id) => !isVisited(id) && Object.prototype.hasOwnProperty.call(state.wishlist, id), [state, isVisited]);

  // ---------- Proximité : 1 km dans les 48 h (shared/proximity.js, vérifié aussi par le serveur) ----------
  const recordSighting = useCallback((pos) => {
    sightings.current = JinjaProximity.addSighting(sightings.current, pos);
    saveJson(KEYS.sightings, sightings.current);
  }, []);

  async function gpsSample(ask) {
    const perm = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    recordSighting({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy });
  }

  // Connecté : position enregistrée à l'ouverture de l'app, au retour au premier plan,
  // puis toutes les 3 minutes tant que l'app est ouverte.
  useEffect(() => {
    if (!user) return undefined;
    gpsSample(true).catch(() => {});
    const timer = setInterval(() => { if (AppState.currentState === 'active') gpsSample(false).catch(() => {}); }, 3 * 60 * 1000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') gpsSample(false).catch(() => {}); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [!!user]);

  // Renvoie null si la visite est enregistrée, sinon le message d'erreur à afficher.
  const markVisited = async (id) => {
    if (!tokenRef.current) return 'Connecte-toi avec Google pour collectionner ce sanctuaire.';
    const shrine = byId.get(id);
    let proof = JinjaProximity.findProof(sightings.current, shrine);
    if (!proof) {
      try { await gpsSample(true); } catch { /* traité plus bas */ }
      proof = JinjaProximity.findProof(sightings.current, shrine);
    }
    if (!proof) {
      return `Pour collectionner ce sanctuaire, il faut être passé à moins de 1 km dans les 48 dernières heures. Ta position n'a pas été enregistrée près d'ici : autorise la localisation et réessaie sur place.`;
    }
    addVisit(id, proof);
    return null;
  };
  const addVisit = (id, proof) => update((s) => {
    const now = new Date().toISOString();
    s.visits[id] = { date: now, note: '', updatedAt: now, proof };
    delete s.deleted[id];
    // Visité : il sort de la liste « À visiter ».
    if (s.wishlist[id]) { delete s.wishlist[id]; s.wishDeleted[id] = now; }
    return s;
  });
  const unmarkVisited = (id) => update((s) => {
    delete s.visits[id];
    s.deleted[id] = new Date().toISOString();
    return s;
  });
  const setNote = (id, note) => update((s) => {
    if (s.visits[id]) s.visits[id] = { ...s.visits[id], note: note.trim(), updatedAt: new Date().toISOString() };
    return s;
  });
  const toggleWish = (id) => update((s) => {
    const now = new Date().toISOString();
    if (s.wishlist[id]) { delete s.wishlist[id]; s.wishDeleted[id] = now; } else { s.wishlist[id] = { addedAt: now }; delete s.wishDeleted[id]; }
    return s;
  });

  // Numéro de carte = ordre chronologique de visite.
  const visitedOrdered = useMemo(() => Object.entries(state.visits)
    .filter(([id]) => byId.has(id))
    .sort((a, b) => a[1].date.localeCompare(b[1].date))
    .map(([id, visit], i) => ({ shrine: byId.get(id), visit, number: i + 1 })), [state.visits]);

  // ---------- Compte Google et synchronisation ----------
  function setToken(token) {
    const payload = token && jwtPayload(token);
    const valid = payload && payload.exp * 1000 > Date.now() + 60 * 1000;
    if (!valid || tokenRef.current !== token) setUsernameState(undefined);
    // Autre compte (ou plus de compte) : le profil précédent ne reste pas affiché.
    if (!valid || jwtPayload(tokenRef.current || '')?.sub !== payload.sub) setProfile(null);
    tokenRef.current = valid ? token : null;
    if (valid) restoreProfile(payload.sub);
    const apple = valid && payload.iss === 'https://appleid.apple.com';
    setUser(valid ? {
      name: apple ? (appleName.current || 'Compte Apple') : payload.name || payload.email,
      givenName: apple ? appleName.current : payload.given_name,
      picture: apple ? null : payload.picture,
      provider: apple ? 'apple' : 'google',
    } : null);
    saveJson(KEYS.googleToken, valid ? token : null);
    return !!valid;
  }

  // Prénom donné par Apple (seulement à la toute première connexion) : gardé sur le téléphone.
  const appleName = useRef(null);
  useEffect(() => { loadJson(KEYS.appleName, null).then((n) => { appleName.current = n; }); }, []);

  async function silentLogin() {
    if (AppleAuth && jwtPayload(await loadJson(KEYS.googleToken, null) || '')?.iss === 'https://appleid.apple.com') {
      return false; // pas de renouvellement silencieux chez Apple : il faudra se reconnecter
    }
    if (!GoogleSignin) return false;
    const e = epoch.current;
    try {
      const res = await GoogleSignin.signInSilently();
      if (res?.type !== 'success') return false;
      const { idToken } = await GoogleSignin.getTokens();
      if (e !== epoch.current) return false; // déconnecté entre-temps
      if (setToken(idToken)) { syncNow(); return true; }
    } catch { /* pas de session enregistrée */ }
    return false;
  }

  const signIn = async () => {
    if (!GoogleSignin) return;
    try {
      const res = await GoogleSignin.signIn();
      if (res?.type !== 'success') return;
      const idToken = res.data?.idToken || (await GoogleSignin.getTokens()).idToken;
      if (setToken(idToken)) syncNow();
    } catch (err) {
      setSyncStatus({ text: `Connexion impossible : ${err.message}`, error: true });
    }
  };

  const signInWithApple = async () => {
    if (!AppleAuth) return false;
    try {
      const cred = await AppleAuth.signInAsync({
        requestedScopes: [AppleAuth.AppleAuthenticationScope.FULL_NAME, AppleAuth.AppleAuthenticationScope.EMAIL],
      });
      if (cred.fullName?.givenName) {
        appleName.current = cred.fullName.givenName;
        saveJson(KEYS.appleName, appleName.current);
      }
      if (setToken(cred.identityToken)) syncNow();
      return true;
    } catch (err) {
      if (err.code !== 'ERR_REQUEST_CANCELED') setSyncStatus({ text: `Connexion impossible : ${err.message}`, error: true });
      return false;
    }
  };

  // Déconnexion : dernière synchro (8 s au plus ; hors ligne, tant pis : la déconnexion prime),
  // puis la collection du compte quitte le téléphone. Le serveur n'est jamais écrit avec un état vide.
  const signOut = async () => {
    await finalSync();
    try { await GoogleSignin?.signOut(); } catch { /* ignore */ }
    setToken(null);
    clearLocalCollection();
    setSyncStatus({ text: '', error: false });
  };

  async function finalSync() {
    clearTimeout(syncTimer.current);
    const attempt = (async () => {
      // Une synchro déjà en cours : on attend sa fin, puis on renvoie les dernières modifications.
      while (syncing.current) await new Promise((r) => setTimeout(r, 200));
      clearTimeout(syncTimer.current);
      syncAgain.current = false;
      await syncNow();
    })();
    await Promise.race([attempt, new Promise((r) => setTimeout(r, 8000))]);
  }

  // Vide la mémoire et AsyncStorage : visites, liste « À visiter », passages, photos, profil, amis.
  // Appelée seulement par signOut (pas à l'expiration du jeton, renouvelé en silence).
  function clearLocalCollection() {
    epoch.current += 1;
    clearTimeout(syncTimer.current);
    syncAgain.current = false;
    const empty = { visits: {}, deleted: {}, wishlist: {}, wishDeleted: {} };
    stateRef.current = empty;
    setState(empty);
    [KEYS.visits, KEYS.deleted, KEYS.wishlist, KEYS.wishDeleted, KEYS.sightings, KEYS.profile, KEYS.friends].forEach((k) => saveJson(k, null));
    sightings.current = [];
    clearPhotoCache();
    setUsernameState(undefined);
    setProfile(null);
    setSignOuts((n) => n + 1);
  }

  // ---------- Profil (nom public, photo, bannière) : cache local, puis réseau ----------
  // Le cache est rattaché au compte qui l'a écrit (`sub` du jeton) : jamais affiché pour un autre
  // compte, et vidé à la déconnexion avec le reste de la collection.
  const accountSub = () => jwtPayload(tokenRef.current || '')?.sub || null;
  const readAccountCache = useCallback(async (key) => {
    const cached = await loadJson(key, null);
    return cached?.sub && cached.sub === accountSub() ? cached.value : null;
  }, []);
  const writeAccountCache = useCallback((key, value) => {
    const sub = accountSub();
    if (sub) saveJson(key, { sub, value });
  }, []);

  // Au lancement : profil du cache tout de suite (si le réseau ne l'a pas déjà donné).
  async function restoreProfile(sub) {
    const e = epoch.current;
    const cached = await loadJson(KEYS.profile, null);
    if (!cached?.value || cached.sub !== sub || e !== epoch.current || accountSub() !== sub) return;
    setUsernameState((u) => (u === undefined ? cached.value.username : u));
    setProfile((p) => p || cached.value.profile);
  }

  // Lancé en même temps que la synchro (et non après) ; rien n'est appliqué après une déconnexion.
  async function refreshProfile(token, e) {
    try {
      const info = await apiJson('/api/profile', { token });
      if (e !== epoch.current) return;
      const next = { since: info.since || null, friends: info.friends ?? 0, avatar: info.avatar || null, banner: info.banner || null };
      // Images téléchargées dès maintenant : elles sont prêtes quand l'écran du compte s'ouvre.
      [next.avatar, next.banner].forEach((url) => { if (url) Image.prefetch(url).catch(() => {}); });
      setUsernameState(info.username);
      setProfile(next);
      writeAccountCache(KEYS.profile, { username: info.username, profile: next });
    } catch { /* hors ligne : le cache reste affiché, réessayé à la prochaine synchro */ }
  }

  // Jeton valable, en le renouvelant silencieusement s'il a expiré (1 h).
  async function freshToken() {
    if (tokenRef.current && jwtPayload(tokenRef.current)?.exp * 1000 > Date.now() + 60 * 1000) return tokenRef.current;
    setToken(null);
    return (await silentLogin()) ? tokenRef.current : null;
  }

  // Lit le compte, fusionne avec le téléphone, puis renvoie le résultat si quelque chose a changé.
  async function syncNow() {
    if (syncing.current) { syncAgain.current = true; return; }
    const e = epoch.current;
    const token = await freshToken();
    if (!token || e !== epoch.current) return;
    syncing.current = true;
    setSyncStatus({ text: 'Synchronisation…', error: false });
    refreshProfile(token, e);
    try {
      const { state: remote } = await apiJson('/api/sync', { token });
      if (e !== epoch.current) return; // déconnecté entre-temps : on ne touche plus à rien
      // Le compte d'abord : à égalité, la version du serveur (avec le statut de vérification) l'emporte.
      const merged = JinjaMerge.merge(remote, stateRef.current);
      persist(merged);
      if (!JinjaMerge.same(merged, remote)) {
        const { state: saved } = await apiJson('/api/sync', { token, method: 'PUT', body: merged });
        if (e !== epoch.current) return;
        if (saved) persist(JinjaMerge.merge(saved, stateRef.current));
        refreshDiscoveries();
      }
      setSyncStatus({ text: 'Synchronisé ✓', error: false });
    } catch (err) {
      if (e !== epoch.current) return;
      if (err.status === 401) setToken(null);
      setSyncStatus({ text: `Synchro impossible : ${err.message}`, error: true });
    } finally {
      syncing.current = false;
      if (syncAgain.current) { syncAgain.current = false; scheduleSync(); }
    }
  }

  function scheduleSync() {
    if (!tokenRef.current && !GoogleSignin) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(syncNow, 1200);
  }

  // Choisit ou change le nom d'utilisateur public. Lève une erreur si le nom est pris.
  const chooseUsername = async (name) => {
    const token = await freshToken();
    if (!token) throw new Error('connecte-toi avec Google');
    const { username: saved } = await apiJson('/api/profile', { token, method: 'PUT', body: { username: name } });
    setUsernameState(saved);
    writeAccountCache(KEYS.profile, { username: saved, profile: profileRef.current });
    refreshDiscoveries();
    return saved;
  };

  // ---------- Photo de profil et bannière ----------
  // kind : 'avatar' | 'banner' ; jpegUri : image déjà recadrée en JPEG, ou null pour revenir
  // à la photo Google / bannière par défaut.
  const setProfileImage = async (kind, jpegUri) => {
    const token = await freshToken();
    if (!token) throw new Error('connecte-toi pour personnaliser ton profil');
    const res = await fetch(`${API_BASE}/api/profile-image?kind=${kind}`, {
      method: jpegUri ? 'POST' : 'DELETE',
      headers: { Authorization: `Bearer ${token}`, ...(jpegUri ? { 'Content-Type': 'application/octet-stream' } : {}) },
      body: jpegUri ? await (await fetch(jpegUri)).blob() : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `erreur ${res.status}`);
    const next = { ...(profileRef.current || {}), [kind]: body.url };
    setProfile(next);
    writeAccountCache(KEYS.profile, { username: usernameRef.current, profile: next });
    return body.url;
  };

  // ---------- Photo partagée ----------
  // jpegUri : photo déjà redimensionnée en JPEG (expo-image-manipulator).
  const uploadPhoto = async (id, jpegUri) => {
    const token = await freshToken();
    if (!token) throw new Error('connecte-toi avec Google pour partager une photo');
    const blob = await (await fetch(jpegUri)).blob();
    const res = await fetch(`${API_BASE}/api/upload?shrine=${encodeURIComponent(id)}`, {
      method: 'POST',
      // octet-stream : Vercel transmet alors le corps tel quel à la fonction.
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
      body: blob,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `erreur ${res.status}`);
    setCommunity((c) => {
      const list = c?.[id] ? (Array.isArray(c[id]) ? c[id] : [c[id]]) : [];
      return { ...(c || {}), [id]: [{ url: body.url, meta: body.meta }, ...list] };
    });
    return body;
  };

  const value = {
    ready, ...state, isVisited, isWished, visitedOrdered,
    markVisited, unmarkVisited, setNote, toggleWish, recordSighting,
    community, refreshCommunity, uploadPhoto,
    setProfileImage,
    user, signIn, signInWithApple, signOut, syncNow, syncStatus, googleSignInAvailable, appleSignInAvailable, profile,
    username, chooseUsername, discoveries, freshToken, signOuts, readAccountCache, writeAccountCache,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
