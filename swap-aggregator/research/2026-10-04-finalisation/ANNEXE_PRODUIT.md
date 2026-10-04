# Audit Hermes — produit, interface, wallets et QA

Date : 2026-10-04. Périmètre : arbre de travail partagé sur `feat/hermes-oneclick`, HEAD transmis `86159fb636d1b779c85818a261b07e05512cd9f0`, avec modifications locales déjà présentes. Lecture seule du dépôt ; aucune installation, aucun test/build, aucune lecture de `.env.local`, aucun appel externe, aucune signature ni transaction. Ce rapport est une inspection statique : il ne constitue pas une validation visuelle du navigateur ou d'une livraison réelle.

Les contrôles obligatoires de registre local, contrats et ABI ont été retirés à la demande de l'utilisateur. Cet audit prend cette décision comme acquise et ne recommande pas leur retour. Les recommandations portent sur le choix utilisateur, le rendu des données, la continuité du suivi et les preuves de QA.

## Conclusion de périmètre

Une démo de cotation anonyme dispose désormais d'une preuve navigateur limitée transmise par le coordinateur : rendu desktop et mobile globalement correct et cotations réelles anonymes sur la paire de départ, sans wallet/signature. La prise en charge du natif en premier, la recherche ouverte par identité, les quotes anonymes, l'isolation des providers, les minima exacts et les reprises conservatrices Rango/1Click disposent de mécanismes cohérents dans le code.

Un lancement avec fonds n'est pas qualifié par cette inspection. Deux sujets sont prioritaires : la sélection de route peut changer implicitement à chaque renouvellement ; le parcours LI.FI ne dispose pas dans l'UI d'une reprise persistante comparable à Rango/1Click. La documentation reconnaît aussi que les wallets et les livraisons réelles restent une validation manuelle. Les résultats de tests/build du coordinateur doivent être rattachés à l'arbre dirty courant, et non aux anciens nombres de tests du README.

Échelle : P1 = à résoudre ou explicitement qualifier avant un parcours public avec fonds ; P2 = défaut produit/robustesse significatif ou limitation de lancement à annoncer ; P3 = amélioration UX/documentation. Aucun exploit de fonds n'est établi par ce rapport statique.

## Constats concrets

### F1 — P1 fonds, P2 démo : sélection implicite et remplacement silencieux de la route

Preuves : `components/SwapCard.tsx:59` initialise `selectedId` à null ; `:91` utilise `find(...selectedId) ?? quotes.routes[0] ?? null` ; `:95` permet l'exécution sur ce résultat ; `:311` transmet l'ID ainsi obtenu au radio. `lib/routing/sort.ts:2-3` classe les routes par montant de sortie. `lib/aggregators/rango/routes.ts:10` lie l'identifiant au `requestId`, donc une nouvelle cotation Rango peut changer cet ID. `components/RouteList.tsx:38` place le badge « Highest output / Meilleur montant » sur le premier élément.

Parcours : après le premier chargement, la première route apparaît cochée et Swap peut être disponible sans clic de sélection. Si l'utilisateur a choisi une route et que le renouvellement retourne de nouveaux IDs ou retire cette route, le fallback sélectionne automatiquement la première route restante. Il peut donc changer de provider/protocole sans action de sélection spécifique. L'utilisateur conserve la possibilité de choisir une autre route ; ce n'est pas un routage techniquement forcé, mais la réassignation reste implicite et l'intention initiale n'est pas préservée. Sur mobile, le CTA précède la liste des routes dans le DOM (`SwapCard.tsx:281`, `:304-311`) : la nouvelle route cochée peut se trouver sous la zone visible.

Recommandation : distinguer une route proposée d'une route explicitement choisie. Une quote renouvelée doit conserver un choix stable lorsque la même route/protocole reste disponible, sinon demander une sélection/reconfirmation visible ; ne pas adopter automatiquement un autre provider. Préserver le tri par sortie comme indication et afficher le fait qu'il n'intègre pas le coût total.

Critère QA : sélectionner une route Rango moins rémunératrice, renvoyer au refresh une meilleure route LI.FI et un nouveau `requestId` Rango ; vérifier que Swap ne devient pas autorisé sur LI.FI sans choix explicite. Répéter à 375 px de largeur, avec le CTA visible et les cartes sous le pli.

### F2 — P1 fonds : reprise LI.FI limitée à la mémoire de l'onglet

Preuves : `components/SwapCard.tsx:62` conserve la route d'exécution via `useState`. Les seules clés/relectures persistantes concernent Rango (`:103`, `:122-129`) et 1Click (`:162-183`). Le callback LI.FI met à jour l'état et la route affichée (`:227-229`) ; le `finally` relâche le verrou et renouvelle les quotes (`:241-243`). `lib/aggregators/lifi/execute.ts:19` délègue à `executeRoute`. Le SDK dispose potentiellement de mécanismes internes, mais aucun parcours applicatif de rechargement/reprise LI.FI n'est câblé dans ces fichiers.

Parcours : fermer/recharger l'onglet après l'envoi source ou pendant l'attente destination fait perdre au formulaire sa route et ses actions LI.FI. Lors d'une erreur après envoi, la page affiche un conseil de consulter le wallet (`SwapCard.tsx:291`), puis libère son verrou ; la présence d'un transfert toujours en cours n'est pas conservée dans le même mécanisme que les autres providers. Ce constat doit être croisé avec la politique exacte du SDK en cas d'échec/attente : il ne prouve pas qu'une seconde transaction sera signée automatiquement.

Recommandation : un journal de transfert LI.FI lié à la quote, au compte, aux chaînes, aux hashes source et à la route SDK ; reprise de suivi sans signatures. Tant qu'un transfert est ambigu, conserver l'état de réconciliation et donner un accès visible au suivi existant. Toute nouvelle signature doit rester une action explicite, jamais un effet de reprise.

Critère QA : reload après signature source, après receipt source et pendant panne du suivi destination ; vérifier conservation hash/minimum/identités, absence de nouvelle signature et reprise de suivi. Vérifier aussi le rejet de signature avant envoi, qui ne doit pas créer un faux transfert financé.

### F3 — P2 démo et fonds : frais LI.FI malformés peuvent faire tomber le rendu de la liste

Preuves : `components/RouteList.tsx:23` appelle `BigInt(fee.amount)` sur les frais retournés par `lib/routing/details.ts:10` depuis `route.raw.steps[].estimate.feeCosts`. `lib/routing/normalize.ts:7-18` vérifie les sorties et la présence des étapes, mais ne valide pas ces frais avant leur insertion. Le dossier `app/` ne contient pas de `error.tsx` de récupération applicative. Le `try/catch` de l'orchestrateur entoure la requête/normalisation, pas le rendu React ultérieur.

Exemple statique : un frais LI.FI avec `amount: "unknown"` passe la normalisation si les autres champs sont valides, puis l'appel BigInt lève une exception dans RouteList. L'exception peut rendre toute la section indisponible, au lieu d'isoler le provider. Ce n'est pas une preuve qu'un fournisseur envoie actuellement cette donnée.

Recommandation : valider les champs de présentation de la route avant publication, isoler les routes malformées et rendre défensivement les frais inconnus. Ajouter une récupération UI qui propose un rafraîchissement sans effacer un transfert financé.

Critère QA : fees non numériques, négatifs, extrêmement longs, token/decimals manquants ; aucune exception de rendu, aucune somme inventée, autres providers conservés.

### F4 — P2 produit : indisponibilité totale et absence économique de route sont confondues

Preuves : `lib/routing/orchestrator.ts:33-40` distingue les échecs providers et l'échec total ; `lib/routing/useSwapQuotes.ts:49` ne transmet pas `onWarning`, et `:62-68` place l'erreur dans l'état. `components/SwapCard.tsx:309` ne rend que la liste vide avec « No routes for this pair and amount » ; l'état `quotes.error` n'est jamais affiché. `ARCHITECTURE.md:293-299` et `tests/swap-refresh.test.tsx:125-140` documentent explicitement le choix de retry silencieux.

Ce comportement est donc intentionnel, pas une régression non prévue. Sa conséquence produit : une paire peut sembler non couverte alors que tous les services sont simplement indisponibles ; après échec partiel la comparaison peut paraître complète alors qu'un provider a échoué. Le countdown indique néanmoins une nouvelle tentative.

Recommandation compatible avec le silence des erreurs techniques : conserver les diagnostics techniques en console, afficher un état non alarmant de comparaison partielle ou de nouvelle tentative, et réserver « aucune route » à un cycle terminé avec réponses valides vides. Ne pas afficher les payloads/erreurs brutes. Pour les incompatibilités permanentes de configuration, expliquer la disponibilité du provider dans son contrôle (ex. frais plateforme non nuls et 1Click). De même, 1Click actif sur la paire native ETH initiale retourne silencieusement une liste vide (`lib/aggregators/oneclick/client.ts:69-71`) : annoncer que les dépôts source natifs ne sont pas supportés éviterait de faire passer cette absence pour une comparaison 1Click effectuée et complète. Ce dernier état a été confirmé visuellement par le coordinateur.

Critère QA : tous providers timeout ; un provider HTTP 429 et l'autre retourne une route ; un provider désactivé par configuration ; distinguer ces états sans détails techniques ni multiplication de popups.

### F5 — P2 présentation : un prix USD ancien peut être conservé sans limite visible

Preuves : `lib/pricing.ts:4-18` possède un cache d'une minute, puis renvoie null en cas d'échec. `components/SwapCard.tsx:146-153` ne fusionne que les paires non nulles ; l'ancienne valeur de `priceLookup` reste donc conservée en cas d'échec. `:97` privilégie cette valeur et utilise sinon `token.priceUSD`. Il n'y a ni timestamp ni statut périmé dans l'état React. La devise affichée continue donc à utiliser le dernier prix réussi pendant une panne prolongée. Les nombres flottants sont limités à la valorisation indicative (`:98-99`) ; les montants de transaction restent entiers.

Recommandation : stocker `{price, checkedAt}` par identité, marquer les valeurs périmées ou les retirer après une limite définie, conserver les montants token exacts. Une baisse de disponibilité du prix ne doit jamais bloquer la sélection locale. Utiliser le montant de sortie exact pour la valeur indicative plutôt que le `receivePreview` tronqué (`:99`).

Critère QA : un prix réussi puis cinq échecs successifs, sortie inférieure à six décimales, jeton changeant de chaîne avec même symbole ; absence de prix récent présenté comme courant, identités séparées.

### F6 — P2/P3 : les transferts ambigus sont bien bloqués mais le dossier de réconciliation est trop peu exposé

Preuves : Rango conserve un dossier avant envoi et le verrou global (`SwapCard.tsx:90,95,103,122-129`). L'UI sans hash rend le message générique et un bouton de reprise désactivé (`:295`) ; l'intention contient pourtant compte, transaction, montant et date (`lib/aggregators/rango/tracking.ts:12-20`). 1Click conserve son dossier (`SwapCard.tsx:162-183`), mais l'UI rend principalement le statut brut et les liens existants (`:296-300` ; `lib/i18n.tsx:124,285`). La clé n'est pas un historique multi-transferts.

Parcours : un utilisateur reçoit « résultat de l'envoi inconnu » sans hash cliquable et doit réconcilier manuellement ; le formulaire ne fournit pas toutes les données utiles pour retrouver le bon envoi. Il peut rester bloqué sur toutes les cotations dans ce navigateur. C'est conservateur et préférable à un renvoi, mais le dépannage dépend de la lecture de stockage navigateur ou d'une aide extérieure.

Recommandation : panneau réconciliation/export en lecture seule avec provider, compte, chaîne, date, montant, destinataire/dépôt, minimum et hashes connus. Instructions précises de comparaison avec le wallet. Un ajout de hash éventuel nécessite un contrôle d'identité et de transaction ; aucun bouton « effacer et réessayer » sans preuve de non-envoi/échec. Localiser les statuts 1Click tout en gardant le statut technique dans les détails.

Critère QA : localStorage indisponible, reload, account switch/disconnect, envoi sans réponse, ancien dossier reconnu, statut destination incomplet ; verrou conservé, dossier exportable, aucune signature de polling/reprise.

### F7 — P2 lancement mobile : seuls les wallets injectés sont supportés

Preuves : `lib/wallet.ts:11-15` configure uniquement `injected()` et aucun WalletConnect. `README.md:34-37` décrit MetaMask/Rabby injectés. `app/page.tsx:24-28` et `SwapCard.tsx:281` proposent « Connect wallet » sans expliciter cette restriction.

Limitation réelle : un navigateur mobile standard sans provider injecté ne dispose pas d'un parcours wallet externe/QR/deep link installé dans Hermes. Le navigateur interne d'un wallet mobile peut fournir l'injection et doit être testé. L'affichage responsive seul ne qualifie pas l'utilisation mobile de fonds.

Recommandation : annoncer le support navigateur desktop injecté et, si validé, navigateur intégré des wallets mobiles. Fournir un état d'aide si aucun wallet n'est détecté. L'ajout WalletConnect est un choix produit futur, pas une condition implicite ni une installation recommandée dans cet audit.

Critère QA : Chromium+MetaMask, Chromium+Rabby, plusieurs injections EIP-6963, navigateur sans wallet, wallet mobile intégré, compte/réseau refusé, chaîne unsupported ; aucun connecteur annoncé sans parcours validé.

### F8 — P2/P3 information : l'état du classement de marché est global, pas détaillé par réseau

Preuves : `lib/tokens/market-universe.ts:9` conserve des échecs par provider/réseau ; `components/TokenSelectModal.tsx:131-132` affiche « ranked (source) » sur la base du seul statut/source global. Il ne regarde ni les échecs du réseau actif, ni le nombre de tokens classés sur ce réseau. Les tokens sans métrique restent correctement non classés ; `lib/tokens/ranking.ts:20-26` n'invente pas une capitalisation zéro.

Conséquence : un univers partiellement enrichi peut afficher l'indication générale de classement alors que le réseau actif a peu ou pas de contrats avec capitalisation. Un refresh échoué conserve la liste précédente, sans date de marché rendue.

Recommandation : provenance et date du snapshot, statut complet/partiel pour le réseau actif, classement limité aux métriques réellement disponibles. Garder le natif prioritaire et la recherche libre.

Critère QA : CoinGecko disponible mais enrichissement d'un seul réseau en échec ; chaîne sans contrat classé ; anciennes données après panne ; pas d'impression de top 100 garanti sur chaque chaîne.

### F9 — P2/P3 accessibilité et présentation à qualifier en navigateur

Preuves positives : focus visible global (`app/globals.css:25-27`), navigation fléchée/recherche réseau (`ChainSelect.tsx:33-57`), modal nommée/focus trap/restauration (`TokenSelectModal.tsx:48-58,103-114`), labels de montant, live region d'erreurs (`SwapCard.tsx:258-289`), réduction des animations (`app/globals.css:279-280`), layout deux colonnes à partir de 960 px (`:286-291`).

Points à vérifier : le focus trap inclut les `input` sans exclure les disabled (`TokenSelectModal.tsx:108`) ; les radios annoncent provider/montant/protocole mais pas minimum/gas/durée (`RouteList.tsx:27-28`) ; ces informations existent visuellement mais devraient pouvoir être associées via description accessible au choix. La modal utilise une superposition et `aria-modal` sans rendre le reste de l'app `inert` ; le clavier est piégé mais l'exploration au lecteur d'écran doit être vérifiée. Plusieurs contrôles sont petits (refresh 28 px `globals.css:108`, pourcentages 26 px `:81`, détails 30×32 px `:144`), sans que cette inspection permette de conclure à une non-conformité WCAG car l'espacement et les exceptions doivent être mesurés.

Recommandation : QA clavier et lecteur d'écran réelle, `aria-describedby` pour les éléments de décision, cibles tactiles confortables, inert/focus disabled traité si le test confirme une fuite. Pas de certificat a11y fondé sur le seul DOM simulé.

### F10 — P3 documentation : preuves historiques et parcours actuel sont entremêlés

Preuves : `README.md:13-21` décrit encore les routes sous les champs et 189 tests ; `:229` cite 350 tests ; `TOKEN_SECURITY.md:1-20` précise bien que la suite décrit un mécanisme antérieur, mais les sections héritées contiennent encore « every provider authorizes » et blocage obligatoire. Le layout actuel desktop est à droite (`globals.css:286-291`).

Recommandation : faire du parcours actuel et de sa dernière qualification datée la référence principale ; archiver les états anciens sous des titres explicites. Un lecteur ne doit pas prendre les anciennes gates comme contrôle de signature actif ni les anciens comptes de tests comme preuve actuelle.

## Mécanismes favorables observés

- Recherche ouverte et locale : `TokenSelectModal.tsx:38` supprime la recherche distante pour une adresse exacte du catalogue ; `:87-90` rend le catalogue immédiatement ; `:60-76` débounce et annule les recherches ; `:93-99,125-128` garde les blocages/consentements pour les autres tokens. La sélection locale n'est pas conditionnée par le prix.
- Classement : `ranking.ts:15-24` fait exact match, natif, capitalisation connue. `:47-69` conserve les métadonnées épinglées, ne récupère pas le consentement upstream et garde le verdict le plus restrictif. Le classement ne transforme pas une source marché en certificat de sécurité.
- Quotes anonymes : wallet vide dans `SwapCard.tsx:88-89`, adresses omises pour LI.FI (`lifi/routes.ts:32`), 1Click `dry: true` (`oneclick/client.ts:72`) ; l'exécution exige un compte (`routing/quote.ts:19`). La connexion change la quoteKey et invalide l'aperçu.
- Concurrence : `orchestrator.ts:25-31` lance les providers en parallèle et bloque les callbacks après annulation ; le hook montre les réponses partielles en gardant `loading: true` (`useSwapQuotes.ts:49-55`) ; l'exécution reste désactivée tant que la recherche n'est pas terminée (`SwapCard.tsx:95,311`).
- Renouvellement : debounce initial 500 ms, TTL 30 s, retry 15 s ; un seul `inFlight` ; document hidden/offline attendu au prochain cycle ; événements de reprise ; abort à changement de paramètres ; invalidation au rendu avant l'effet (`useSwapQuotes.ts:16,38-48,71-91`). Les refresh ne signent pas.
- Valeurs financières : entiers BigInt pour amount et tri ; parser accepte point/virgule sans groupements/exposants (`amounts.ts:1-8`) ; minimum complet (`RouteList.tsx:21,37`) ; montant exact dans les détails (`:47`) ; distinction frais additionnels/inclus (`:23,39,49`) ; gas inconnu 1Click rendu `—` sans montant inventé (`oneclick/client.ts:74`, `RouteList.tsx:20,34`).
- EUR : clé `(chain,address)` (`pricing.ts:6-7`), taux BCE daté, timeout et borne d'ancienneté sept jours (`:21-28`), EUR indisponible sans taux (`SwapCard.tsx:76,250,280`). Les frais non nuls très petits affichent `< 0.01` plutôt que zéro (`presentation.ts:14-21`).
- Rango/1Click : dossier durable avant envoi, verrou après issue ambiguë, pas de signature depuis tracking, suivi Rango sans hash interdit, receipt source distincte de la livraison. Ces caractéristiques sont présentes dans le code ; leur résultat live reste non qualifié.

## Matrice QA pour la décision de lancement

1. **Démo anonyme sans fonds** : 320/375/768/960/1440 px, zoom 200 %, FR/EN, absence de wallet, sélection locale sans token API, recherche symbol/name/address, native first, imposteur même symbole, pagination, classement partiel, providers lent/429/timeout, CTR choix route avant et après refresh, devise EUR sans service de taux, aucune erreur console ou requête obsolète acceptée.
2. **Clavier/a11y** : Tab/Shift-Tab dans modal et réseau, Escape restaure le déclencheur, flèches et Home/End, lecteur d'écran annonce montant/minimum/gas/choix, fermeture par backdrop, reduced motion, liens et détails accessibles sans modifier la sélection.
3. **Wallet simulé puis QA autorisée distincte avec fonds** : connexion invalide previews, compte/réseau changeant pendant async, refus network switch, solde/gas indisponible, ERC-20 sans natif, native 25/50/75 %, valeur avec virgule, quote expirée après approval, frais/minimum reconstruits, confirmation explicite. Aucun test d'audit ici n'envoie de fonds.
4. **Transfert financé/reprise** : reload à chaque stade, déconnexion/account switch, storage bloqué, RPC timeout après broadcast, receipt source seule, provider bare SUCCESS, wrong destination asset/minimum, refund/intermediate, poll outage ; hash et dossier conservés, aucun renvoi ni signature automatique, aide réconciliation exploitable. Couvrir LI.FI autant que Rango/1Click.
5. **Charge/ disponibilité réelle à mesurer séparément** : latence p50/p95 d'une comparaison complète, taux de disponibilité par provider, coût du preload neuf réseaux et de la valorisation à plusieurs onglets/utilisateurs, limites serveur par processus. Aucun chiffre live n'est revendiqué dans ce rapport.

## Preuve navigateur transmise par le coordinateur

Le coordinateur a réalisé une QA de la version production servie localement sur `127.0.0.1:3187` via CUA, le 2026-10-04. À 1265 px desktop et 390×844 px mobile, le rendu a été jugé globalement correct ; le français fonctionne ; EUR devient disponible après récupération du taux. La saisie anonyme `0,01 ETH` Base → ETH Ethereum a retourné neuf routes : Rango Across et LI.FI Stargate, Glacis → Wrapper, Layerswap, Relay, AcrossV4, LI.FI Intents, Mayan, Symbiosis. Le premier radio Rango était déjà coché. Aucun log error/warn n'a été vu au moment de la lecture. 1Click était activé mais son absence sur la source native n'était pas expliquée.

Cette preuve confirme un rendu et une paire à un instant donné ; elle ne valide ni plusieurs navigateurs/lecteurs d'écran, ni les wallets, ni les signatures, ni une livraison bridge, ni les cas de panne/reprise du présent rapport. Aucun wallet ou fonds n'a été utilisé dans cette QA. La validation navigateur a été exécutée par le coordinateur, pas par l'agent qui rédige ce rapport.

## Limites et provenance

Lecture des instructions AGENTS, README, ARCHITECTURE, RANGO_INTEGRATION, TOKEN_CATALOG/TOKEN_SECURITY ; sources frontend/routing/token/pricing/wallet et tests existants cités. La mémoire Hermes a uniquement fourni les préférences natif premier et identité réseau/adresse/decimals, puis ces comportements ont été vérifiés dans l'arbre courant (`MEMORY.md:140-150`, rollout `01a0f9ce-dc4c-7640-9f01-9a583e98d83c`). Aucun ancien succès de build/test n'a été utilisé pour qualifier le présent arbre.
