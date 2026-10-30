# Git flow et versions

Ce fichier n'est pas publié sur le site (`docs/` est dans `.vercelignore`).

## Branches

| Branche | Rôle | Part de | Fusionne dans |
|---|---|---|---|
| `main` | Production : chaque push est mis en ligne par Vercel. Un commit = une version publiée et taguée. | — | — |
| `develop` | Intégration : fonctionnalités terminées, pas encore publiées. L'iPhone de Clément installe cette branche quand il le branche. | `main` | `main` (par une release) |
| `feature/<carte>-<sujet>` | Nouvelle fonctionnalité ou amélioration | `develop` | `develop` |
| `bugfix/<carte>-<sujet>` | Correctif non urgent | `develop` | `develop` |
| `release/<version>` | Préparation d'une version : numéro, journal des versions | `develop` | `main`, puis `main` → `develop` |
| `hotfix/<version>` | Correctif urgent en production | `main` | `main`, puis `main` → `develop` |

`<carte>` = identifiant court de la carte Trello (ex. `A0TjsTJW`). Jamais de commit direct sur
`main` ni sur `develop` : tout passe par une Pull Request, relue et fusionnée par Clément.

## Versions (SemVer, avant la 1.0)

Le numéro vit à trois endroits, toujours identiques : `package.json`, `mobile/package.json` et
`mobile/app.json` (`expo.version`, plus `expo.ios.buildNumber` incrémenté de 1 à chaque version).

- `0.x.y` → `0.x.(y+1)` : la version ne contient que des correctifs.
- `0.x.y` → `0.(x+1).0` : la version contient au moins une fonctionnalité ou une amélioration visible.
- `1.0.0` : seulement sur décision de Clément (sortie publique / App Store).

## Journal des versions

Chaque PR vers `develop` ajoute une ligne dans `CHANGELOG.md`, section `## [Non publié]`,
sous `### Fonctionnalités` ou `### Corrections`, en français, du point de vue de l'utilisateur.
La release renomme cette section en `## [x.y.z] - AAAA-MM-JJ` et en rouvre une vide.

## Commits

Messages en français, à l'impératif ou au nominatif, préfixés par la zone quand c'est utile
(`Site :`, `App iOS :`, `API :`). Petits commits cohérents ; dernière ligne :
`Co-Authored-By: …` pour le travail d'un agent.

## Release

1. `release/x.y.z` depuis `develop` : numéro de version aux trois endroits, `buildNumber` + 1,
   section `[Non publié]` → `[x.y.z] - date`.
2. PR `release/x.y.z` → `main`, titre « Version x.y.z », corps = notes de version.
3. Après la fusion : tag annoté `vx.y.z` sur `main`, puis PR (ou fusion) `main` → `develop`
   pour que `develop` récupère le numéro de version.

Un hotfix suit le même chemin depuis `main` (`hotfix/x.y.z`, version corrective).
