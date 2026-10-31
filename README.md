# Grimoire

Gestion de collection et de decks Magic: The Gathering, à partir de l'export CSV de [Mythic Tools](https://mythic.tools).

- Import du CSV complet : quantités, classeurs, decks (classeurs « … - Main »), disponibilité des cartes.
- Decks : courbe de mana, demande et sources par couleur, alertes (identité, légalité, singleton), vue texte ou images.
- Swaps recommandés avec statut (disponible, utilisée ailleurs, appliqué) et archivage.
- Cartes inconnues complétées automatiquement via l'API Scryfall.
- Onglet Offres alimenté par `C:\Claude\MTG\sealed-prices.json`.

## Installation

Télécharge `Grimoire-Setup-x.y.z.exe` dans la dernière [release](https://github.com/EllaedS/grimoire/releases/latest) et lance-le. L'application se met ensuite à jour toute seule au démarrage.

Les données personnelles (decks, notes, swaps, CSV importés) sont stockées localement dans `%APPDATA%\Grimoire` et ne sont jamais envoyées dans ce dépôt.

## Développement

```
npm install
npm start          # lance l'app en local
npm run dist       # construit l'installeur dans dist/
```

Publier une version : augmenter `version` dans `package.json`, committer et pousser sur `main`. Le workflow GitHub Actions construit l'installeur Windows et le publie dans les Releases.
