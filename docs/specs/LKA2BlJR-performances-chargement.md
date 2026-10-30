# Optimisation des performances : bannière, photo de profil, liste d'amis

Carte Trello : https://trello.com/c/LKA2BlJR/9
Branche : `task/LKA2BlJR-performances-chargement`

## Contexte
Constats de Clément : après connexion Google, la bannière et la photo de profil personnalisées de l'app mettent trop longtemps à s'afficher ; la liste d'amis est trop lente.
Causes probables relevées dans le code :
1. **Profil chargé en dernier** : dans `mobile/src/state/CollectionContext.js` (`syncNow`, ~l.315-330), `GET /api/profile` n'est lancé qu'après la fin de la synchro (GET puis éventuel PUT `/api/sync`). Avatar et bannière attendent donc toute la synchro.
2. **Images lourdes** : `api/profile-image.js` accepte jusqu'à 3 Mo ; l'app envoie une bannière de 1500×500 et un avatar de 512×512 (`IMAGE_SIZE` dans `mobile/src/components/AccountScreen.js`), affichés en 130 px de haut / 110 px. Aucune mise en cache disque (composant `Image` de React Native, URL Blob avec suffixe aléatoire).
3. **Amis : requêtes en cascade** (`api/friends.js`, GET sans `user`) : pour chaque ami, `readShared` (list Blob + fetch) puis `profileImages` (un `list` Blob par ami), après `allNames()` (liste complète des noms) et `relations()`. Chaque `list` Blob est lent ; le coût croît avec le nombre d'amis. `lib/profiles.js` : `listAll` pagine sans cache.
4. Le site a le même schéma côté serveur (`/api/friends`, `/api/profile`) ; vérifier s'il charge aussi son profil après la synchro (`app.js`).

## Objectif
Réduire sensiblement les temps d'affichage de l'avatar, de la bannière et de la liste d'amis, sans changer les fonctionnalités ni les données stockées.

## Comportement attendu (site ET app iOS)
1. **Mesurer d'abord** : consigner dans la PR des temps avant/après (chronomètre côté client, logs `Date.now()` temporaires non commités, ou onglet réseau du navigateur pour le site).
2. **Profil en parallèle de la synchro** (app et site) : lancer `GET /api/profile` dès la connexion, sans attendre la fin de `/api/sync`, avec les mêmes garde-fous de déconnexion (compteur `epoch` / `syncEpoch`) pour ne rien appliquer après une déconnexion.
3. **Cache local du profil** : mémoriser avatar/bannière (URL) en stockage local pour les afficher immédiatement au lancement, puis rafraîchir. Ce cache fait partie des données du compte : il doit être vidé à la déconnexion (voir `clearLocalCollection` livré par la carte « après déconnexion »).
4. **Images plus légères** : réduire les dimensions/qualité envoyées (ex. bannière 1200×400, avatar 384×384, JPEG qualité ~0.7) ; les images déjà téléversées restent valables (pas de migration). Ajouter `Cache-Control` long côté Blob lors du `put` (`cacheControlMaxAge`) puisque les URL changent à chaque modification. Sur l'app, utiliser `Image.prefetch` ou un cache disque si disponible sans nouvelle dépendance native (l'app est installée à la main : éviter d'ajouter un module natif).
5. **Liste d'amis plus rapide** (`api/friends.js`) : paralléliser les lectures (déjà en `Promise.all` par ami, mais `profileImages` est sérialisé dans chaque ami) ; supprimer les `list` redondants en listant une seule fois le préfixe `profiles/` (tous les comptes) pour en déduire les images de tous les amis, au lieu d'un `list` par ami ; éviter de relister plusieurs fois `names/`. Garder la même forme de réponse JSON (`friends`, `incoming`, `outgoing`).
6. **Affichage progressif** : l'app/site affiche la liste d'amis et les images avec un état de chargement discret (squelette ou avatar initial), jamais un écran vide ; les données en cache s'affichent d'abord si disponibles.
7. Aucune régression de confidentialité : seuls les noms d'utilisateur circulent (pas d'e-mail ni d'identifiant Google), comme décrit en tête de `api/friends.js`.

## Fichiers probablement concernés
- mobile/src/state/CollectionContext.js (`syncNow`, `profile`), mobile/src/components/AccountScreen.js, mobile/src/components/Friends.js, mobile/src/lib/store.js (clé de cache)
- api/friends.js, api/profile.js, lib/profiles.js (`profileImages`, `listAll`), api/profile-image.js, lib/friends.js
- app.js (section compte/amis du site) + `?v=` de app.js dans index.html

## Contraintes
- Serveur : CommonJS, Vercel Blob, auth dans `lib/auth.js`. Ne pas toucher aux secrets, à la config Vercel ni aux données existantes des utilisateurs (aucune migration ni réécriture des Blobs).
- Pas de nouvelle infrastructure (pas de base de données, pas de KV) : choix produit/coût à faire par Clément si une telle piste devient nécessaire ; la noter alors en conclusion de la PR plutôt que de l'implémenter.
- Interface/commentaires en français, style existant (app.js = IIFE en sections `// ---------- … ----------`).
- App : vérifier seulement que le bundle compile (`cd mobile && npm ci && npx expo export --platform ios`).

## Critères d'acceptation
- [ ] Le profil (avatar, bannière) est demandé en parallèle de la synchro, sur l'app et le site
- [ ] Au 2e lancement, avatar et bannière s'affichent depuis le cache sans attendre le réseau
- [ ] Cache du profil vidé à la déconnexion ; aucun avatar du compte précédent visible après changement de compte
- [ ] `GET /api/friends` réalise nettement moins d'appels Blob `list` (au plus un `list` pour toutes les images au lieu d'un par ami) ; forme de la réponse inchangée
- [ ] Les nouvelles images téléversées sont plus légères (taille moyenne indiquée dans la PR) ; les anciennes s'affichent toujours
- [ ] Temps avant/après consignés dans la PR
- [ ] Le bundle iOS compile ; `npm test` passe ; `?v=` incrémentés si fichiers du site modifiés

## Cas limites
- Compte sans avatar ni bannière personnalisés (photo Google / bannière par défaut).
- Ami sans nom d'utilisateur ou sans collection partagée.
- Zéro ami, ou beaucoup d'amis (≥ 30).
- Hors ligne : afficher le cache, pas d'erreur bloquante.
- Déconnexion pendant le chargement du profil : rien ne doit réapparaître.

## Hors périmètre
Migration/redimensionnement des images existantes, notifications, nouvelles fonctionnalités amis, changement d'hébergeur des images.

## Comment tester
Site : onglet réseau du navigateur (durée de `/api/friends` et `/api/profile`), se connecter/déconnecter/reconnecter. API : si possible, test unitaire avec `@vercel/blob` simulé comptant les appels `list`. App : `npx expo export --platform ios` ; Clément chronométrera sur son iPhone (connexion Google, ouverture de l'onglet Amis).
