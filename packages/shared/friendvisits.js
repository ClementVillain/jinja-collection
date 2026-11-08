// Visites des amis sur la carte (site et app). Données : GET /api/friends?visits=1 →
// { shrines: { "<idSanctuaire>": [{ username, avatar, date }, …] } }, visite la plus récente d'abord.
// Sur le marqueur : 3 photos d'amis au plus, puis « +N » ; seulement dans la zone affichée, à
// partir du zoom 11 et sans dépasser ~150 pastilles. Pastille de l'onglet Amis : visites d'amis
// postérieures au dernier passage dans cet onglet.
(function (root) {
  const MAX_AVATARS = 3;
  const MIN_ZOOM = 11;
  const MAX_PINS = 150;

  // { shown: les premiers amis (3 au plus), more: nombre d'amis restants pour le badge « +N » }.
  function stack(list, max = MAX_AVATARS) {
    const all = list || [];
    return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
  }

  // Ids des sanctuaires à dessiner : visités par au moins un ami, dans les limites
  // { west, south, east, north }, ceux qui ont le plus d'amis d'abord, `limit` au plus.
  // position(id) → { lat, lon } (ou rien : sanctuaire inconnu) ; keep(id), facultatif, écarte
  // par exemple un sanctuaire encore regroupé dans une bulle.
  function visible(shrines, position, bounds, { zoom, limit = MAX_PINS, keep } = {}) {
    if (!shrines || !bounds || (zoom != null && zoom < MIN_ZOOM)) return [];
    const out = [];
    for (const [id, list] of Object.entries(shrines)) {
      if (!list || !list.length) continue;
      const p = position(id);
      if (!p || p.lat < bounds.south || p.lat > bounds.north || p.lon < bounds.west || p.lon > bounds.east) continue;
      if (keep && !keep(id)) continue;
      out.push([id, list.length]);
    }
    return out.sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  }

  // Visites d'amis postérieures à `since` (date ISO) : { total, byFriend: { nom: nombre } }.
  // Sans `since` (premier passage) : rien de nouveau.
  function newVisits(shrines, since) {
    const out = { total: 0, byFriend: {} };
    const from = Date.parse(since);
    if (!shrines || Number.isNaN(from)) return out;
    for (const list of Object.values(shrines)) {
      for (const v of list || []) {
        if (!(Date.parse(v.date) > from)) continue;
        out.total += 1;
        out.byFriend[v.username] = (out.byFriend[v.username] || 0) + 1;
      }
    }
    return out;
  }

  // « a », « a et b », « a, b et c ».
  function joinFr(items) {
    if (items.length < 2) return items.join('');
    return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
  }

  // Initiale affichée quand l'ami n'a pas de photo.
  const initial = (name) => String(name || '').trim().charAt(0).toUpperCase() || '?';

  const api = { MAX_AVATARS, MIN_ZOOM, MAX_PINS, stack, visible, newVisits, joinFr, initial };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JinjaFriendVisits = api;
})(this);
