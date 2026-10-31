# Grimoire — notes pour Claude

Utilisateur : Fred. Outil de gestion de collection/decks MTG.

- Dépôt : https://github.com/EllaedS/grimoire (public). Copie locale de Fred : `C:\Dev\grimoire`.
- Ancien projet (scripts PowerShell, viewer, base de connaissances) : `C:\Claude\MTG` — référence uniquement.

## Deux surfaces, une seule source
- `web/index.html` est LA source de la page. Elle tourne :
  1. dans l'app Electron (ce dépôt) : `window.grimoireLocal` existe (`S.local=true`) → images Scryfall, enrichissement direct via `/cards/collection`, mises à jour auto ;
  2. comme artifact claude.ai « Grimoire MTG » (https://claude.ai/artifact/GYLwTSHDrPNA8aSD2635Cg) : capabilities db/assets/user/sample/mcp(host:claude_browser navigate+get_page_text) ; pas d'images (CSP) ; analyse Claude via `sample`.
- Après une modification de `web/index.html` : republier l'artifact avec ce fichier (même URL), puis publier une release.

## Données
- `preload.js` imite `window.claude.use("db"|"assets"|"user")` ; documents dans `%APPDATA%\Grimoire\grimoire-data.json`, CSV dans `blobs/`.
- Collections : `app/state` (csv courant + historique + lastDiff), `app/offres`, `decks/{id}`, `swaps/{id}` (`items`, `acq`, `archive`, `intro`), `cards_extra/{set~num}`.
- `web/cards.json` : base de cartes compacte clé `set|num` → `{e,f,o,c,k,m,t,r,l}` (l = "P"/"C" légalités).
- Aucune donnée personnelle dans le dépôt (public).

## Release
1. `version` +1 dans `package.json`
2. commit + `git push` sur `main` (pas de tag : le proxy des sessions Claude bloque les tags)
3. GitHub Actions (`.github/workflows/release.yml`, windows-latest) construit `Grimoire-Setup-X.Y.Z.exe` + `latest.yml` et publie la release ; electron-updater côté app télécharge et propose « Redémarrer ».
