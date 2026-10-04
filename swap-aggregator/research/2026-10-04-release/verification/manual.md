# Contrôles manuels locaux — 4 octobre 2026

Serveur Next standalone démarré uniquement sur `127.0.0.1:3177` après copie de
`.next/static` et `public` dans `.next/standalone` comme au Dockerfile.
Sans cette copie, `/` était 200 mais l'asset CSS appelé par la page était 404.
Après la copie : `/` 200, deux assets CSS 200, `/api/health` 200 avec `ok`,
`/api/release` 200 avec `executionEnabled:false`. `/api/security/registry`
renvoie 410, une recherche de token invalide 400, une demande Rango swap
en mode cotations 403. Une requête 1Click `dry:false` avec un corps incomplet
renvoie 400 sur validation d'entrée ; la fermeture du chemin exécutable est
couverte par les tests API/transport à corps valide, pas par ce seul smoke.

Navigateur local sur la build production, sans wallet :

- 390 px : formulaire et parcours en une colonne, pas de débordement horizontal
  (`scrollWidth` 375 pour `innerWidth` 390) ; bouton cotations désactivé.
- 768 px : routes sous le formulaire, `scrollWidth` 753 pour `innerWidth` 768.
- 1280 px : formulaire à gauche, routes à droite (titres x=151 et x=660),
  `scrollWidth` 1280 ; bouton cotations désactivé.
- Passage English → Français visible ; libellés, frais et état cotations
  traduits. Le rendu français conserve aussi l'absence de débordement à 390
  et 768 px. Tabulation atteint le wallet puis les providers. Ouverture du
  sélecteur source focalise son champ de recherche ; Échap ferme le sélecteur
  et rend le focus au bouton ETH.

Ces observations ne couvrent pas MetaMask/Rabby réels, zoom/accessibilité
assistive, réseau cible ou confirmations wallet. Aucun wallet n'a été connecté.

`npm audit --omit=dev --json` a échoué avant de recevoir les avis avec
`getaddrinfo EAI_AGAIN registry.npmjs.org`. Aucun « zéro vulnérabilité » n'est
revendiqué. Docker CLI absent ; aucune image ni digest Hermes produit.
