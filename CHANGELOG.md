# Journal des versions

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon
[SemVer](https://semver.org/lang/fr/). Tant que l'app n'est pas en 1.0 : une version mineure
(0.x.0) apporte des fonctionnalités, une version corrective (0.x.y) seulement des correctifs.
Règles de travail : voir `docs/git-flow.md`.

## [Non publié]

### Fonctionnalités
- App Android : configuration de compilation (EAS Build) produisant un APK installable.
- Carte : les sanctuaires visités par tes amis affichent leurs photos de profil (3 au maximum, puis « +N »), liste « Visité par » sur la fiche et pastille de nouvelles visites dans l'onglet Amis (site et app).

## [0.9.0] - 2026-10-30

### Fonctionnalités
- Dépôt réorganisé : `apps/web` (site et serveur), `apps/mobile` (app iOS) et `packages/shared` (données des sanctuaires et logique communes, qui n'existent plus en double). Le site ne publie plus que ses fichiers publics : le code serveur et les tests ne sont plus téléchargeables.

## [0.8.0] - 2026-10-30

Première version numérotée : état du site et de l'app iOS au passage à git flow.

### Fonctionnalités
- Carte d'environ 30 000 sanctuaires shintō (OpenStreetMap), recherche par nom et par ville, regroupement des marqueurs.
- Visites avec carte postale à collectionner ; visite validée seulement à moins de 1 km du sanctuaire (dans les 48 h).
- Listes « À visiter » et « Collection », photos de couverture (Wikimedia et photos de la communauté).
- Itinéraires, circuits et navigation GPS intégrée.
- Compte Google avec synchronisation entre appareils ; connexion obligatoire pour collectionner.
- Profil : nom d'utilisateur, photo de profil, bannière, statistiques, préfectures, « Découvert par ».
- Amis : demandes, liste avec dernier sanctuaire visité, profil d'un ami et sa collection.
- App iOS (React Native / Expo) avec les mêmes fonctionnalités ; balayage entre onglets.

### Corrections
- Après déconnexion, la collection du compte n'est plus affichée.
