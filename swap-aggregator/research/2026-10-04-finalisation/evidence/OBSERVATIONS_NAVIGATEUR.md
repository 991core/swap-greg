# Observation ciblée — 4 octobre 2026

Serveur Next en production locale sur `127.0.0.1:3187`, même arbre et build que les preuves. Navigateur intégré contrôlé par le coordinateur. Aucun wallet connecté, aucune signature, aucun dépôt et aucun fonds. Le serveur et l'onglet temporaires ont été arrêtés à la fin.

- Desktop environ 1265 px : formulaire à gauche, routes à droite ; présentation violette cohérente.
- Mobile 390 × 844 : contenu empilé, formulaire et cartes utilisables sur les écrans observés.
- FR activé ; montant `0,01` accepté ; sélection EUR activée après arrivée de la référence de conversion.
- Cotation anonyme ETH Base → ETH Ethereum, montant 0,01 : neuf routes à un instant. Rango Across ; LI.FI StargateV2, Glacis/Wrapper, Layerswap, Relay, AcrossV4, LI.FI Intents, Mayan Swift, Symbiosis. Les routes et montants ont varié au renouvellement automatique.
- Modale source Base : ETH natif en tête, puis actifs classés ; source marché CoinGecko affichée ; 113 actifs disponibles lors de l'observation.
- Recherche exacte du catalogue USDC Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` : un résultat exact.
- Le journal navigateur consulté n'avait pas d'erreur/warning à cet instant.

Limites : observation visuelle ciblée et instantanée, sans capture de trafic complète ni archive des neuf devis. Les captures affichées pendant l'audit n'ont pas été sauvegardées comme fichiers. Ne prouve ni une absence de requête réseau dans toutes les interactions (ce point repose sur le code/tests), ni la meilleure route économique, ni la compatibilité wallet, ni une livraison destination. Ce n'est pas une recette multi-navigateurs, accessibilité ou mobile avec wallet réel.
