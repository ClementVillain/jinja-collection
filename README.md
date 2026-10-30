# ⛩ Jinja Collection

Carte du Japon avec ~30 000 sanctuaires shintō (jinja). Coche ceux que tu as visités et collectionne une carte postale unique pour chacun.

## Organisation du dépôt

```
apps/
  web/        site (public/) et fonctions serveur Vercel (api/, lib/) — racine du projet Vercel
  mobile/     app iOS (React Native / Expo), voir apps/mobile/README.md
packages/
  shared/     code et données communs au site et à l'app : data/shrines.json, merge.js,
              proximity.js, route.js, geo.js, card.js, et les scripts qui régénèrent les données
docs/         règles de travail (git flow, versions)
```

Le site n'a pas de bundler : `apps/web/scripts/build.mjs` copie `packages/shared` dans
`apps/web/public/shared/` et `public/data/` (dossiers ignorés par git). Vercel le lance à chaque
déploiement et ne publie que `apps/web/public/`. Les fonctions serveur importent ces fichiers par
chemin relatif (`../../../packages/shared/…`), que Vercel embarque à coup sûr dans chaque
fonction. L'app les importe via `@jinja/shared`. Le code partagé fonctionne dans les trois
contextes (balise `<script>`, Node et Metro).

## Lancer le site

```bash
npm install          # à la racine, une fois
npm run dev -w apps/web
```

Puis ouvre http://localhost:8642. Après une modification de `packages/shared`, relance `npm run dev`.

## Fonctionnalités

- **Carte** : sanctuaires non visités regroupés en clusters (points gris), sanctuaires visités toujours visibles en torii rouges.
- **Explorer** : recherche par nom japonais ou latin (`伏見稲荷`, `meiji jingu`…).
- **Visités** : liste chronologique, avec la note de visite.
- **Collection** : une carte postale générée par sanctuaire (saison, paysage, rareté : commune, rare ★, légendaire ★★), téléchargeable en PNG.
- **Compte Google** : « Se connecter avec Google » synchronise tes visites et notes entre tous tes appareils (fusion automatique, voir `packages/shared/merge.js`).
- **Sauvegarder / Restaurer** : sans compte, les visites restent dans le navigateur (localStorage) ; exporte-les en JSON pour ne pas les perdre.
- **Photo de couverture** dans chaque popup : photo Google Maps (si la clé est configurée), sinon photo Wikimedia liée au sanctuaire (OpenStreetMap/Wikidata) ou trouvée par nom, sinon photo partagée par un visiteur, sinon photo Wikimedia « à proximité », sinon l'illustration de la carte postale.
- **Photos de la communauté** : depuis la popup, « 📷 Partager ma photo » envoie une photo du sanctuaire (redimensionnée à 1600 px, sans métadonnées GPS), visible par tous.
- Lien « Ouvrir dans Google Maps » sur chaque sanctuaire.
- **Navigation intégrée** (`apps/web/public/navigation.js`) : « ➤ Y aller » dans la popup, ou « ▶ Démarrer » sur un circuit de l'onglet « À visiter ». Position suivie en direct, bandeau avec la prochaine manœuvre (étapes OSRM, textes générés en français), heure d'arrivée, recalcul si on s'écarte du tracé, écran maintenu allumé, « J'y suis allé ⛩ » à l'arrivée. Pour tester sans bouger : ajoute `?simulate=1` à l'URL (`&vitesse=10` pour accélérer).

## Tests

```bash
npm test   # depuis la racine : packages/shared puis apps/web (node --test)
```

Installer d'abord les dépendances : `npm install` à la racine (workspaces npm : `apps/web` et `packages/shared`).
L'app mobile garde ses propres dépendances (`npm install` dans `apps/mobile`), pour ne pas perturber la compilation iOS.

## Données

Les sanctuaires viennent d'OpenStreetMap (`amenity=place_of_worship` + `religion=shinto`), et non de Google Maps : l'API Google Places limite chaque recherche à 60 résultats, est payante et interdit de stocker les données. Pour mettre à jour la liste :

```bash
npm install                                   # à la racine
node packages/shared/scripts/fetch-shrines.mjs
```

Le fichier `packages/shared/data/shrines.json` sert au site, au serveur et à l'app : il n'y a plus de copie à faire.

## Photos Google Maps

La fonction Vercel [`apps/web/api/photo.js`](apps/web/api/photo.js) interroge l'API Google Places (New) côté serveur : la clé n'est jamais envoyée au navigateur.

1. Dans Google Cloud Console, active **Places API (New)** et crée une clé API restreinte à cette seule API.
2. Fixe un **quota journalier** (APIs & Services → Places API (New) → Quotas) pour plafonner la facture : chaque popup ouverte coûte une recherche + une photo.
3. Ajoute la clé à Vercel puis redéploie :

```bash
vercel env add GOOGLE_MAPS_API_KEY production
vercel deploy --prod
```

En local, `npm run dev` n'exécute pas `/api` : l'appli retombe sur Wikimedia. Pour tester les photos Google en local : `vercel env pull` puis `vercel dev`.

## Photos de la communauté

Stockées dans Vercel Blob (store `jinja-photos`, région Tokyo) sous `community/<idSanctuaire>/`.
`apps/web/api/upload.js` reçoit les envois (JPEG, 3 Mo max), `apps/web/api/community.js` liste la photo la plus récente de chaque sanctuaire.

Modération (supprimer une photo inappropriée), depuis la racine du dépôt :

```bash
vercel env pull
node apps/web/scripts/remove-photo.mjs w561378888            # toutes les photos d'un sanctuaire
node apps/web/scripts/remove-photo.mjs https://…/photo.jpg   # une seule photo
```

Pour tester en local avec les fonctions serveur : `vercel dev`.

## Connexion Google et synchronisation

- Le navigateur obtient un jeton d'identité via Google Identity Services ; `apps/web/lib/auth.js` en vérifie la signature (clés publiques Google) et l'audience.
- `apps/web/api/sync.js` lit / écrit l'état `{ visits, deleted }` du compte dans Vercel Blob sous `users/<sha256(id Google)>/` (3 dernières versions gardées).
- `packages/shared/merge.js` fusionne navigateur et compte : pour chaque sanctuaire, l'action la plus récente (visite, note, retrait) l'emporte.

Configuration : créer un **ID client OAuth « Application Web »** dans Google Cloud Console (origines JavaScript autorisées : `https://jinja-collection.vercel.app`, `http://localhost:3000`), puis :

```bash
vercel env add GOOGLE_CLIENT_ID production
vercel deploy --prod
```

Sans `GOOGLE_CLIENT_ID`, l'encart de connexion n'apparaît pas et l'appli fonctionne comme avant.
