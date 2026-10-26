// Petits utilitaires de texte et de format, repris du site.

// Ignore casse, accents, espaces et tirets : « fushimi inari taisha » trouve « Fushimi Inari-taisha ».
export const normalize = (str) => String(str || '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/[\s\-_'’.・]/g, '');

// Nom en lettres latines affiché sous les kanji : romaji, sinon nom anglais d'OSM.
export const latinName = (s) => s.romaji || (s.nameLatin !== s.name ? s.nameLatin : '');

export const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR');

export const fmtDistance = (m) => (m < 1000
  ? `${Math.round(m / 10) * 10} m`
  : `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);

export function fmtDuration(sec) {
  const min = Math.max(1, Math.round(sec / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}
