// Stockage local (équivalent du localStorage du site) : visites, liste « À visiter »,
// photos déjà trouvées, session Google, profil et amis du compte (affichés avant le réseau),
// dernier passage dans l'onglet Amis et réglage « Visites des amis » de la carte. Tout est en JSON.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEYS = {
  visits: 'jinja-collection:visits',
  deleted: 'jinja-collection:deleted',
  wishlist: 'jinja-collection:wishlist',
  wishDeleted: 'jinja-collection:wish-deleted',
  photos: 'jinja-collection:photos',
  googleToken: 'jinja-collection:google-token',
  appleName: 'jinja-collection:apple-name',
  sightings: 'jinja-collection:sightings',
  profile: 'jinja-collection:profile',
  friends: 'jinja-collection:friends',
  friendsSeen: 'jinja-collection:friends-seen',
  showFriendVisits: 'jinja-collection:show-friend-visits',
};

export async function loadJson(key, fallback = {}) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveJson(key, value) {
  try {
    if (value == null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch { /* stockage plein ou indisponible : tant pis */ }
}
