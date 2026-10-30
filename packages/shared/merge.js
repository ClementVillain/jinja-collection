// Fusion de deux états de collection (navigateur ↔ compte) :
// { visits, deleted, wishlist, wishDeleted } — visites et liste « À visiter », chacune avec
// les dates de retrait. Pour chaque sanctuaire, l'événement le plus récent l'emporte :
// un ajout après un retrait le fait revenir, un retrait après l'ajout le supprime.
(function (root) {
  function mergeMap(a, b, itemsKey, removedKey, stamp) {
    const items = {}, removed = {};
    const ids = new Set([a, b].flatMap((s) => [...Object.keys(s?.[itemsKey] || {}), ...Object.keys(s?.[removedKey] || {})]));
    for (const id of ids) {
      const candidates = [a, b].map((s) => s?.[itemsKey]?.[id]).filter(Boolean);
      const item = candidates.sort((x, y) => stamp(y).localeCompare(stamp(x)))[0];
      const removedAt = [a?.[removedKey]?.[id], b?.[removedKey]?.[id]].filter(Boolean).sort().pop();
      if (item && (!removedAt || stamp(item) > removedAt)) items[id] = item;
      else if (removedAt) removed[id] = removedAt;
    }
    return [items, removed];
  }

  function merge(a, b) {
    const [visits, deleted] = mergeMap(a, b, 'visits', 'deleted', (v) => v.updatedAt || v.date);
    const [wishlist, wishDeleted] = mergeMap(a, b, 'wishlist', 'wishDeleted', (w) => w.addedAt);
    return { visits, deleted, wishlist, wishDeleted };
  }

  const same = (a, b) => JSON.stringify(merge(a, {})) === JSON.stringify(merge(b, {}));

  const api = { merge, same };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JinjaMerge = api;
})(this);
