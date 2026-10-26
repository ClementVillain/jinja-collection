# Jinja Collection — application iOS

Version React Native (Expo SDK 58) de [Jinja Collection](https://jinja-collection.vercel.app) :
carte des ~30 000 sanctuaires shintō du Japon, visites, cartes postales, liste « À visiter »,
circuits et navigation intégrée. Elle utilise le **même serveur** que le site (photos partagées,
connexion Google, synchronisation) : tes données sont communes au site et à l'app.

## Structure

- `App.js` : écran principal (carte, volet à trois positions, fiche, navigation).
- `src/components/` : `ShrineMap` (MapLibre + OpenFreeMap), `Panel` (onglets), `ShrineDetail`
  (fiche + carrousel + partage de photo), `PostcardModal`, `NavOverlay`.
- `src/hooks/useNavigation.js` : guidage GPS (portage de `navigation.js`).
- `src/state/CollectionContext.js` : visites, liste, compte Google, synchronisation.
- `src/lib/photos.js` : photos Wikimedia / visiteurs (même logique que le site).
- `src/shared/` : code repris du site (`merge.js`, `route.js`, `card.js`, `navcore.js`).
- `src/data/shrines.json` : copie de `../data/shrines.json` (à recopier après `fetch-shrines.mjs`).

## Lancer sur ton iPhone (Xcode)

Prérequis, une fois :

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Dans Xcode : **Réglages › Comptes** → ajoute ton identifiant Apple (gratuit suffit).
Sur l'iPhone : **Réglages › Confidentialité et sécurité › Mode développeur** → activé.

Branche l'iPhone en USB, puis :

```bash
cd mobile
npm install
npx expo run:ios --device --configuration Release
```

Choisis ton iPhone dans la liste. La première fois, Xcode demande une **équipe de signature** :
ouvre `ios/JinjaCollection.xcworkspace`, cible *JinjaCollection* › *Signing & Capabilities* ›
*Team* = ton identifiant Apple, puis relance la commande. Sur l'iPhone, autorise le développeur
dans **Réglages › Général › VPN et gestion de l'appareil**.

Avec un compte Apple gratuit, l'app installée reste valable **7 jours** : relance la commande
pour la réinstaller.

### Développement (rechargement à chaud)

```bash
npx expo run:ios --device          # version Debug, reliée à Metro
```

En Debug, l'onglet Explorer propose un **mode simulation** pour tester la navigation sans bouger.

## Connexion Google (optionnel)

Il faut un **ID client OAuth de type iOS** (Google Cloud Console › Identifiants › Créer un ID
client OAuth › iOS, identifiant du bundle : `com.villainclement.jinjacollection`), puis :

```bash
GOOGLE_IOS_CLIENT_ID=xxxx.apps.googleusercontent.com npx expo prebuild -p ios --clean
GOOGLE_IOS_CLIENT_ID=xxxx.apps.googleusercontent.com npx expo run:ios --device --configuration Release
```

Sans cet ID, l'app fonctionne sans compte (données gardées sur le téléphone).
