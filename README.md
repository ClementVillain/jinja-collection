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
- **Sauvegarder / Restaurer** : les visites sont stockées dans le navigateur (localStorage). Exporte-les en JSON pour ne pas les perdre.
- **Photo de couverture** dans chaque popup : photo liée au sanctuaire dans OpenStreetMap/Wikidata, sinon photo Wikimedia Commons prise à moins de 200 m dont le titre évoque un sanctuaire, sinon l'illustration de la carte postale.
- Lien « Ouvrir dans Google Maps » sur chaque sanctuaire.

## Données

Les sanctuaires viennent d'OpenStreetMap (`amenity=place_of_worship` + `religion=shinto`), et non de Google Maps : l'API Google Places limite chaque recherche à 60 résultats, est payante et interdit de stocker les données. Pour mettre à jour la liste :

```bash
node scripts/fetch-shrines.mjs
```
