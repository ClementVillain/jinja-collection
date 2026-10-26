// Serveur de l'app : les mêmes fonctions Vercel que le site web (photos partagées,
// envoi de photo, synchronisation du compte Google).
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};
export const API_BASE = extra.apiBase || 'https://jinja-collection.vercel.app';
export const GOOGLE_WEB_CLIENT_ID = extra.googleWebClientId || '';
export const GOOGLE_IOS_CLIENT_ID = extra.googleIosClientId || '';

export async function apiJson(path, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && typeof body === 'object' ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body && typeof body === 'object' ? JSON.stringify(body) : body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `erreur ${res.status}`), { status: res.status });
  return data;
}
