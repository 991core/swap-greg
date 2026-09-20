# Catalogue local Hermes

Revue du 20 septembre 2026. Ce catalogue embarqué permet une sélection immédiate
et dispense ses entrées exactes de requête de vérification d’authenticité. Il
ne restreint pas la recherche LI.FI et ne constitue ni une garantie de sécurité
ni une promesse de route, de liquidité ou de parité pour les actifs représentés.

## Sources

- [Liste Uniswap — snapshot eddf220](https://github.com/Uniswap/default-token-list/tree/eddf220c47dd51da0dd85140d082a1a52569c8df/src/tokens) : métadonnées des ERC-20 et extensions `bridgeInfo` pour WETH/USDC sur Arbitrum et WETH sur Optimism.
- [Liste PancakeSwap — snapshot 1dd8633](https://github.com/pancakeswap/token-list/blob/1dd8633d75ea081a9fbf88b1a22f29f74c06b36d/lists/pancakeswap-default.json) : représentations Binance Pegged USDT, USDC, BTCB et ETH sur BNB Chain.
- [Contrats USDC publiés par Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses) : adresses natives USDC Ethereum, Base, Arbitrum, Optimism, Polygon et Avalanche recoupées.
- `lib/chains.ts` / définitions viem installées : devises natives des neuf réseaux configurés.

Les actifs bridgés restent distincts : BTCB/WBTC/cbBTC ne sont pas du Bitcoin natif ;
Binance Pegged USDC n’est pas de l’USDC natif émis par Circle sur BNB Chain.
Les noms de contrats sont conservés ; USDT0 sur Arbitrum est identifié explicitement.

## Actifs natifs

Adresse conventionnelle LI.FI : `0x0000000000000000000000000000000000000000`.

| Réseau | Chain ID | Symbole | Décimales |
| --- | ---: | --- | ---: |
| Base | 8453 | ETH | 18 |
| Ethereum | 1 | ETH | 18 |
| Arbitrum | 42161 | ETH | 18 |
| Optimism | 10 | ETH | 18 |
| Polygon | 137 | POL | 18 |
| BNB Chain | 56 | BNB | 18 |
| Avalanche | 43114 | AVAX | 18 |
| Gnosis | 100 | XDAI | 18 |
| Metis | 1088 | METIS | 18 |

## Contrats épinglés

| Réseau | Symbole | Adresse | Décimales |
| --- | --- | --- | ---: |
| Base | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| Base | WETH | `0x4200000000000000000000000000000000000006` | 18 |
| Base | cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8 |
| Base | DAI | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | 18 |
| Ethereum | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| Ethereum | WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | 18 |
| Ethereum | WBTC | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | 8 |
| Ethereum | DAI | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | 18 |
| Ethereum | LINK | `0x514910771AF9Ca656af840dff83E8264EcF986CA` | 18 |
| Arbitrum | USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| Arbitrum | WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | 18 |
| Arbitrum | cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8 |
| Arbitrum | USDT0 | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |
| Optimism | USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 |
| Optimism | WETH | `0x4200000000000000000000000000000000000006` | 18 |
| Optimism | OP | `0x4200000000000000000000000000000000000042` | 18 |
| Polygon | USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 |
| Polygon | USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 |
| Polygon | WETH | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` | 18 |
| Polygon | WBTC | `0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6` | 8 |
| Polygon | DAI | `0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063` | 18 |
| Polygon | LINK | `0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39` | 18 |
| BNB Chain | WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | 18 |
| BNB Chain | USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| BNB Chain | BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | 18 |
| BNB Chain | ETH | `0x2170Ed0880ac9A755fd29B2688956BD959F933F8` | 18 |
| BNB Chain | USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 |
| Avalanche | USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | 6 |
| Avalanche | WAVAX | `0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7` | 18 |

## Règles de maintenance

1. Vérifier le réseau, l’adresse exacte et les décimales auprès des sources du projet ou d’une liste maintenue ; ne jamais approuver un contrat à partir du nom seul.
2. Modifier explicitement `lib/tokens/catalog.ts` et cette documentation dans le même commit. Un résultat API ne peut pas modifier le catalogue.
3. Pour une migration, distinguer les versions natives et bridgées ; retirer une exemption obsolète au lieu de la déduire d’un symbole.
4. Exécuter les tests de catalogue, modale et exécution. Vérifier notamment les homonymes, les décimales altérées et le maintien du blocage des verdicts `flagged`.

À l’exécution, l’adresse, le réseau et les décimales du devis doivent correspondre
à la sélection et aux métadonnées locales. Les signalements déjà fournis par
LI.FI restent bloquants ; aucun scan d’authenticité supplémentaire n’est demandé
pour ces entrées. Les prix et les devis restent des données dynamiques obtenues
par API. `priceUSD: "0"` est une absence de prix, jamais une estimation.
