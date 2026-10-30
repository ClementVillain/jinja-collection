# Jinja Collection — application iOS

Version React Native (Expo SDK 58) de [Jinja Collection](https://jinja-collection.vercel.app) :
carte des ~30 000 sanctuaires shintō du Japon, visites, cartes postales, liste « À visiter »,
circuits et navigation intégrée. Elle utilise le **même serveur** que le site (photos partagées,
connexion Google, synchronisation) : tes données sont communes au site et à l'app.

## Structure

- `App.js` : écran principal (carte, volet à trois positions, fiche, navigation).
- `src/components/` : `ShrineMap` (MapLibre + OpenFreeMap), `Panel` (onglets), `ShrineDetail`
  (fiche + carrousel + partage de photo), `PostcardModal`, `NavOverlay`.
- `src/hooks/useNavigation.js` : guidage GPS (portage de `apps/web/public/navigation.js`).
- `src/lib/navcore.js` : fonctions pures de la navigation, reprises de `navigation.js` du site.
- `src/state/CollectionContext.js` : visites, liste, compte Google, synchronisation.
- `src/lib/photos.js` : photos Wikimedia / visiteurs (même logique que le site).
- `@jinja/shared` : code et données communs avec le site (`packages/shared` : `merge`, `proximity`,
  `route`, `geo`, `card`, `data/shrines.json`), lié par npm (`file:../../packages/shared`).
  `metro.config.js` ajoute ce dossier à ceux que Metro surveille.

## Lancer sur ton iPhone (Xcode)

Prérequis, une fois :

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Dans Xcode : **Réglages › Comptes** → ajoute ton identifiant Apple (gratuit suffit).
Sur l'iPhone : **Réglages › Confidentialité et sécurité › Mode développeur** → activé.

Branche l'iPhone en USB, puis :

```bash
cd apps/mobile
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

## Connexion Google

L'app utilise l'**ID client OAuth iOS** du projet Google Cloud du site (`app.config.js`), dans le
même projet que l'ID client web : Google remet à l'app un jeton émis pour l'ID web, que le serveur
vérifie comme pour le site. Le compte et ses données (visites, liste, notes) sont donc communs
au site et à l'app. Après un changement d'ID client, régénère le projet natif :

```bash
npx expo prebuild -p ios
npx expo run:ios --device --configuration Release
```
