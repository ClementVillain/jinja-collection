# Bug : icônes tori et étoile absentes des marqueurs sur mobile

Carte Trello : https://trello.com/c/A0TjsTJW/11
Branche : `task/A0TjsTJW-pins-visites-mobile`

## Contexte
Sur le site (Leaflet, `app.js` l.92-99, `style.css` l.221-237), les marqueurs ont des pictogrammes : sanctuaire visité = pastille olive avec torii SVG blanc (`iconDone`), « À visiter » = pastille céladon avec étoile ★ (`iconWish`), non visité = rond blanc à bord gris (`iconTodo`).
Dans l'app iOS (`mobile/src/components/ShrineMap.js`, MapLibre), les mêmes états sont dessinés avec de simples calques `circle` : « visited-dot » + « visited-center » (point blanc) et « wished-dot » + « wished-star » (petit point sombre, pas une étoile). Aucun torii ni étoile n'apparaît : sur un téléphone, on distingue mal visités et favoris, surtout aux zooms moyens (voir les captures dans la carte Trello : site vs iPhone).

## Objectif
Dans l'app iOS, les marqueurs visités affichent le torii et les marqueurs « À visiter » affichent l'étoile, comme sur le site, de façon lisible sur petit écran.

## Comportement attendu
1. **App iOS (principal)** : remplacer `visited-center` par un torii blanc centré sur la pastille olive, et `wished-star` par une vraie étoile (couleur `colors.accentDark`) centrée sur la pastille céladon. Approche recommandée : calques `symbol` avec des images enregistrées dans la carte (composant `Images` / `icon-image` de `@maplibre/maplibre-react-native`, à vérifier dans la version installée), les images étant générées à partir des mêmes tracés SVG que `mobile/src/components/Torii.js` (pas d'emoji ⛩). Alternative acceptable : glyphes de police si l'étoile ★ est disponible dans la police de la carte (`Noto Sans Bold`) ; à vérifier, sinon utiliser des images.
2. Tailles : pastilles actuelles (rayon 11 visités, 10 « à visiter ») à conserver ou agrandir légèrement (≤ 13) pour que le pictogramme reste lisible ; zone tactile inchangée.
3. Les bulles de regroupement (clusters) gardent leur couleur (olive = visités, céladon = à visiter) : inchangées.
4. **Site** : vérifier l'affichage sur écran étroit (≤ 480 px, navigateur mobile / mode responsive). Si le torii ou l'étoile sont absents ou illisibles (ex. tailles écrasées par les règles `.pin-done .torii`, `.pin-wish span`), corriger dans `style.css`. Si tout s'affiche déjà correctement, ne rien changer côté site et le noter dans la PR.
5. Ordre d'affichage inchangé : visité par-dessus « à visiter » par-dessus non visité ; un sanctuaire visité n'est jamais affiché comme « à visiter ».

## Fichiers probablement concernés
- mobile/src/components/ShrineMap.js (calques `visited-*`, `wished-*`), mobile/src/components/Torii.js (tracé de référence), éventuellement un nouveau fichier d'images dans mobile/assets/ ou un utilitaire de génération dans mobile/src/lib/.
- style.css (+ `?v=` de style.css dans index.html) seulement si le site est concerné.

## Contraintes
- Palette : olive #4F6E55 / #6B8F71, céladon #AAD2BA, encre #1D1E18, blanc ; torii SVG, jamais l'emoji ⛩.
- Interface/commentaires en français ; style de code existant.
- Ne pas dégrader les performances de la carte (~30 000 sanctuaires) : les icônes ne concernent que les sources `visited` et `wished`, pas la source `shrines`.
- App : le développeur vérifie seulement que le bundle compile (`cd mobile && npm ci && npx expo export --platform ios`) ; Clément testera sur son iPhone.

## Critères d'acceptation
- [x] App : un sanctuaire visité s'affiche avec un torii sur pastille olive (calque `visited-torii`, image tirée du tracé de Torii.js ; code et bundle vérifiés, rendu sur iPhone à vérifier par Clément)
- [x] App : un sanctuaire « À visiter » s'affiche avec une étoile sur pastille céladon (calque `wished-star`, étoile `accentDark` ; rendu sur iPhone à vérifier par Clément)
- [ ] Les deux sont immédiatement distinguables d'un sanctuaire non visité et l'un de l'autre, à zoom 13-16 — non vérifiable sans iPhone (pastilles 12 / 11, pictogrammes 14 pt) : à contrôler par Clément
- [ ] Les clusters et la sélection d'un sanctuaire fonctionnent comme avant (toucher ouvre la fiche) — clusters et gestionnaire `onPress` inchangés dans le code ; toucher sur le pictogramme à vérifier sur iPhone
- [x] Site : rien à changer — vérifié dans le code : `.pin-done .torii` (62 %) et `.pin-wish span` (15 px) ne sont redéfinis par aucune règle `@media` ; pas de navigateur disponible pour une capture
- [x] Le bundle iOS compile (`iOS Bundled … 1496 modules`, images star/torii ×3 incluses) ; `style.css`/`app.js` inchangés

## Cas limites
- Sanctuaire à la fois visité et dans « À visiter » : afficher le torii.
- Collection vide (déconnecté) : aucune icône résiduelle.
- Beaucoup de points proches (zoom 13) : pas de chevauchement illisible du pictogramme.

## Hors périmètre
Refonte des marqueurs non visités, changement de fond de carte, avatars d'amis sur la carte (carte « Visites des amis » en Idée).

## Comment tester
`cd mobile && npx expo export --platform ios` doit réussir. Visuel : Clément installe l'app et compare avec le site ; côté site, mode responsive du navigateur sur la carte du Japon, zoomer sur un quartier ayant des visités et des favoris. `npm test` à la racine si des tests existent.
