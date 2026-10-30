# Bug : après déconnexion, la collection reste affichée

Carte Trello : https://trello.com/c/luWhwKwb/1
Branche : `task/luWhwKwb-deconnexion-collection`

## Contexte
« Se déconnecter » ne fait que retirer le jeton et la session Google :
- Site : `#logout-btn` (app.js, ~l.1585) appelle `setToken(null)`, qui ne touche pas à `visits`, `deleted`, `wishlist`, `wishDeleted`, `sightings`, `photoStore` (variables en mémoire + clés localStorage `STORAGE_KEY`, `DELETED_KEY`, `WISH_KEY`, `WISH_DELETED_KEY`, `SIGHTINGS_KEY`, `PHOTO_STORE_KEY`).
- App : `signOut` (mobile/src/state/CollectionContext.js, ~l.253) appelle `setToken(null)` sans vider `state` (visits/deleted/wishlist/wishDeleted), `sightings`, `discoveries`, `profile`, ni les clés AsyncStorage (`KEYS` dans mobile/src/lib/store.js).
Résultat : la collection du compte précédent reste visible (et pourrait être fusionnée dans le compte d'une autre personne à la connexion suivante).

## Objectif
À la déconnexion, toute donnée de collection du compte disparaît de l'interface ET du stockage local de l'appareil ; à la reconnexion elle revient depuis le serveur.

## Comportement attendu (site ET app iOS)
1. **Avant de vider** : si un jeton valide existe et qu'une synchronisation est possible, lancer une dernière synchro (`syncNow`) pour ne pas perdre de modifications non envoyées. Si elle échoue (hors ligne), vider quand même (décision produit : la déconnexion prime), sans bloquer l'utilisateur ; ne pas afficher d'erreur bloquante.
2. **Vider** : visites, suppressions, liste « À visiter », suppressions de la liste, passages récents (`sightings`), photos en cache liées au compte, découvertes/profil/amis, nom d'utilisateur. Vider la mémoire ET le stockage (localStorage / AsyncStorage).
3. **Rafraîchir l'interface** : carte (marqueurs visités / à visiter redeviennent « non visités »), onglets Collection et À visiter (état vide), compteurs, écran Compte (retour à l'écran de connexion), liste d'amis.
4. **Reconnexion** : la collection réapparaît intacte via la synchro serveur (le serveur n'est jamais modifié par la déconnexion — aucun appel PUT avec un état vide !).
5. Ne pas supprimer les préférences non liées au compte (panneau latéral `SIDE_KEY`, état de la feuille `SHEET_KEY`).

## Fichiers probablement concernés
- app.js (section compte/synchro : `setToken`, handler `#logout-btn`, `persistVisits`, `refreshPanels`, `renderFriends`) ; style.css inchangé a priori ; `?v=N` de app.js à incrémenter dans index.html.
- mobile/src/state/CollectionContext.js (`signOut`, `setToken`, états `state`, `discoveries`, `profile`, `username`, refs `stateRef`/`sightings`), mobile/src/lib/store.js (`KEYS`).
- Attention : `setToken(null)` est aussi appelé à l'expiration du jeton (401, `freshToken`) — dans ce cas il NE faut PAS vider la collection (la session sera renouvelée en silence). Créer une fonction dédiée (ex. `clearLocalCollection()`) appelée uniquement par la déconnexion explicite.

## Contraintes
Voir le rappel projet : interface/commentaires en français, style existant (app.js = IIFE en sections `// ---------- … ----------`), palette inchangée, ne rien toucher aux secrets/config Vercel/données utilisateurs côté serveur. App : vérifier seulement que le bundle compile (`cd mobile && npm ci && npx expo export --platform ios`).

## Critères d'acceptation
- [ ] Déconnexion (site) → plus aucun sanctuaire visité ni carte postale affichés, onglets Collection / À visiter vides, compteurs à 0 — *implémenté (`clearLocalCollection`), non testé dans un navigateur par l'agent*
- [ ] Déconnexion (app) → idem — *implémenté, non testé sur iPhone / simulateur*
- [ ] localStorage / AsyncStorage ne contiennent plus visites, liste à visiter, passages, photos du compte — *clés supprimées dans le code, à vérifier dans les outils du navigateur / sur l'appareil*
- [ ] Reconnexion → collection intacte (site et app) — *à vérifier en réel ; vérifié en Node que `merge(serveur, état vide)` redonne exactement l'état du serveur*
- [x] Aucune donnée perdue côté serveur (aucune requête d'écriture avec un état vide) — *la déconnexion n'appelle jamais PUT ; une synchro en cours est neutralisée (compteur `syncEpoch` / `epoch`) ; `merge(serveur, vide)` est identique au serveur, donc pas de PUT à la reconnexion*
- [x] Expiration du jeton (401) ne vide PAS la collection — *`setToken(null)` inchangé ; le vidage n'est appelé que par « Se déconnecter »*
- [x] Préférences d'affichage conservées — *`SIDE_KEY` et `SHEET_KEY` non touchées*
- [x] Suffixe `?v=` de app.js incrémenté (41 → 42) ; l'export iOS compile (« iOS Bundled … index.js (1494 modules) »)

## Cas limites
- Déconnexion hors ligne ou pendant une synchro en cours (attendre/annuler le timer `scheduleSync`, éviter qu'une synchro tardive réécrive l'état après le vidage).
- Changement de compte : le compte B ne voit jamais les données de A.
- Déconnexion puis rechargement de la page : toujours vide.

## Hors périmètre
Mode « consultation sans compte » (déjà livré), suppression de compte, notifications.

## Comment tester
Site : se connecter, visiter/ajouter à visiter, se déconnecter → vérifier carte, onglets, localStorage (outils navigateur) ; se reconnecter → tout revient. App : même scénario dans le simulateur/ device ; `npx expo export --platform ios` doit passer. Lancer aussi `npm test` à la racine si des tests existent (tests/).
