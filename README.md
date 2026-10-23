# ⛩ Jinja Collection

Carte du Japon avec ~30 000 sanctuaires shintō (jinja). Coche ceux que tu as visités et collectionne une carte postale unique pour chacun.

## Lancer l'application

```bash
cd jinja-collection
python3 -m http.server 8642
```

Puis ouvre http://localhost:8642.

## Fonctionnalités

- **Carte** : sanctuaires non visités regroupés en clusters (points gris), sanctuaires visités toujours visibles en torii rouges.
- **Explorer** : recherche par nom japonais ou latin (`伏見稲荷`, `meiji jingu`…).
- **Visités** : liste chronologique, avec la note de visite.
- **Collection** : une carte postale générée par sanctuaire (saison, paysage, rareté : commune, rare ★, légendaire ★★), téléchargeable en PNG.
- **Compte Google** : « Se connecter avec Google » synchronise tes visites et notes entre tous tes appareils (fusion automatique, voir `merge.js`).
- **Sauvegarder / Restaurer** : sans compte, les visites restent dans le navigateur (localStorage) ; exporte-les en JSON pour ne pas les perdre.
- **Photo de couverture** dans chaque popup : photo Google Maps (si la clé est configurée), sinon photo Wikimedia liée au sanctuaire (OpenStreetMap/Wikidata) ou trouvée par nom, sinon photo partagée par un visiteur, sinon photo Wikimedia « à proximité », sinon l'illustration de la carte postale.
- **Photos de la communauté** : depuis la popup, « 📷 Partager ma photo » envoie une photo du sanctuaire (redimensionnée à 1600 px, sans métadonnées GPS), visible par tous.
- Lien « Ouvrir dans Google Maps » sur chaque sanctuaire.

## Données

Les sanctuaires viennent d'OpenStreetMap (`amenity=place_of_worship` + `religion=shinto`), et non de Google Maps : l'API Google Places limite chaque recherche à 60 résultats, est payante et interdit de stocker les données. Pour mettre à jour la liste :

```bash
node scripts/fetch-shrines.mjs
```

## Photos Google Maps

La fonction Vercel [`api/photo.js`](api/photo.js) interroge l'API Google Places (New) côté serveur : la clé n'est jamais envoyée au navigateur.

1. Dans Google Cloud Console, active **Places API (New)** et crée une clé API restreinte à cette seule API.
2. Fixe un **quota journalier** (APIs & Services → Places API (New) → Quotas) pour plafonner la facture : chaque popup ouverte coûte une recherche + une photo.
3. Ajoute la clé à Vercel puis redéploie :

```bash
vercel env add GOOGLE_MAPS_API_KEY production
vercel deploy --prod
```

En local, `python3 -m http.server` n'exécute pas `/api` : l'appli retombe sur Wikimedia. Pour tester les photos Google en local : `vercel env pull` puis `vercel dev`.

## Photos de la communauté

Stockées dans Vercel Blob (store `jinja-photos`, région Tokyo) sous `community/<idSanctuaire>/`.
`api/upload.js` reçoit les envois (JPEG, 3 Mo max), `api/community.js` liste la photo la plus récente de chaque sanctuaire.

Modération (supprimer une photo inappropriée) :

```bash
vercel env pull
node scripts/remove-photo.mjs w561378888            # toutes les photos d'un sanctuaire
node scripts/remove-photo.mjs https://…/photo.jpg   # une seule photo
```

Pour tester en local avec les fonctions serveur : `vercel dev`.

## Connexion Google et synchronisation

- Le navigateur obtient un jeton d'identité via Google Identity Services ; `lib/auth.js` en vérifie la signature (clés publiques Google) et l'audience.
- `api/sync.js` lit / écrit l'état `{ visits, deleted }` du compte dans Vercel Blob sous `users/<sha256(id Google)>/` (3 dernières versions gardées).
- `merge.js` fusionne navigateur et compte : pour chaque sanctuaire, l'action la plus récente (visite, note, retrait) l'emporte.

Configuration : créer un **ID client OAuth « Application Web »** dans Google Cloud Console (origines JavaScript autorisées : `https://jinja-collection.vercel.app`, `http://localhost:3000`), puis :

```bash
vercel env add GOOGLE_CLIENT_ID production
vercel deploy --prod
```

Sans `GOOGLE_CLIENT_ID`, l'encart de connexion n'apparaît pas et l'appli fonctionne comme avant.
