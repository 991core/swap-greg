# Logos du catalogue

Les SVG sont livrés dans `public/tokens/`. Le catalogue les référence localement :
aucun service de logos, requête d'authenticité ou téléchargement distant n'est
nécessaire pour les 39 entrées préchargées. Le cache HTTP standard du navigateur
peut les réutiliser. Un échec d'image affiche les initiales.

`TokenIcon` choisit une image du catalogue uniquement par réseau et adresse.
Un contrat inconnu nommé ETH ou USDC n'hérite jamais de ce logo. Pour les tokens
découverts à distance, seules les URL HTTPS déjà validées sont utilisées.
Les images sont décoratives ; le nom/symbole reste disponible en texte.

## Sources épinglées

- ETH, USDC, USDT, DAI, WBTC, BTC, LINK, BNB, AVAX : SVG couleur de
  [cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons/tree/1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color),
  révision `1a63530be6e374711a8554f31b17e4cb92c25fa5`, licence CC0-1.0.
- Icônes des neuf réseaux et marque Rango : dépôt officiel
  [rango-exchange/assets](https://github.com/rango-exchange/assets), arbre Git
  `32fe20ce1ad910e0b4864ae29502edd80f6e9d74`, dossiers `blockchains/*/icon.svg`
  et `branding/icons/icon.svg`. Marques et droits restent à leurs titulaires ;
  aucune affiliation supplémentaire n'est suggérée.

OP, POL et METIS utilisent l'emblème de leur réseau. WETH/WBNB/WAVAX utilisent
l'actif sous-jacent avec un badge W ; cbBTC/BTCB, XDAI et USDT0 ont un badge
distinctif cb/B, x ou 0. Ce sont des représentations de l'actif sous-jacent,
pas une prétention à reproduire le logo officiel de chaque token enveloppé.
WBTC possède sa propre icône. Le badge réseau évite de confondre deux réseaux.

Les SVG sont statiques, rendus comme images, et testés pour l'absence de scripts
et de gestionnaires d'événements. Toute nouvelle entrée doit garder son identité
réseau/adresse et documenter la provenance du visuel.
