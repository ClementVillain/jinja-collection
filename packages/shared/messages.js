// Sanctuaires envoyés à un ami (site, app et serveur). Données : GET /api/messages?user=<nom> →
// { username, messages: [{ shrine, date, mine }] } ; GET /api/messages → { unread: { nom: nombre } }.
// Conversation : plus ancien en haut, mes envois à droite, ceux de l'ami à gauche.
(function (root) {
  // Identifiant de sanctuaire accepté (le serveur vérifie aussi qu'il existe dans les données).
  const SHRINE_ID = /^[a-z]\d+$/;
  const isShrineId = (id) => typeof id === 'string' && id.length <= 20 && SHRINE_ID.test(id);

  // Plus ancien d'abord ; deux envois à la même date gardent leur ordre d'arrivée.
  function sortThread(messages) {
    return (messages || []).map((m, i) => [m, i])
      .sort((a, b) => String(a[0].date).localeCompare(String(b[0].date)) || a[1] - b[1])
      .map(([m]) => m);
  }

  // Non-lus des amis encore dans la liste : { total, byFriend } (un ami retiré ne compte plus).
  function unread(counts, friendNames) {
    const keep = friendNames ? new Set(friendNames) : null;
    const out = { total: 0, byFriend: {} };
    for (const [name, n] of Object.entries(counts || {})) {
      if (!(n > 0) || (keep && !keep.has(name))) continue;
      out.byFriend[name] = n;
      out.total += n;
    }
    return out;
  }

  // « 1 sanctuaire », « 3 sanctuaires » (pastille par ami).
  const countLabel = (n) => `${n} sanctuaire${n > 1 ? 's' : ''}`;

  const EMPTY_THREAD = 'Envoie-lui un sanctuaire depuis sa fiche.';
  const NO_FRIENDS = "Ajoute d'abord des amis (onglet Amis) pour leur envoyer des sanctuaires.";
  const UNKNOWN_SHRINE = "Ce sanctuaire n'est pas dans les données de la carte.";

  const api = { SHRINE_ID, isShrineId, sortThread, unread, countLabel, EMPTY_THREAD, NO_FRIENDS, UNKNOWN_SHRINE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JinjaMessages = api;
})(this);
