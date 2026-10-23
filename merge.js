// Fusion de deux états de collection { visits, deleted } (navigateur ↔ compte).
// Pour chaque sanctuaire, l'événement le plus récent l'emporte : une visite (ou une note
// modifiée) après un retrait la fait revenir, un retrait après la visite la supprime.
(function (root) {
  const stamp = (v) => v.updatedAt || v.date;

  function merge(a, b) {
    const visits = {}, deleted = {};
    const ids = new Set([a, b].flatMap((s) => [...Object.keys(s?.visits || {}), ...Object.keys(s?.deleted || {})]));
    for (const id of ids) {
      const candidates = [a, b].map((s) => s?.visits?.[id]).filter(Boolean);
      const visit = candidates.sort((x, y) => stamp(y).localeCompare(stamp(x)))[0];
      const removedAt = [a?.deleted?.[id], b?.deleted?.[id]].filter(Boolean).sort().pop();
      if (visit && (!removedAt || stamp(visit) > removedAt)) visits[id] = visit;
      else if (removedAt) deleted[id] = removedAt;
    }
    return { visits, deleted };
  }

  const same = (a, b) => JSON.stringify(merge(a, {})) === JSON.stringify(merge(b, {}));

  const api = { merge, same };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JinjaMerge = api;
})(this);
