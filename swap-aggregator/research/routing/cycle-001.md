# Cycle 001 — moteur générique de comparaison de routes Hermes

Date : 2026-09-23. Snapshot audité : `991core/swap-greg`, commit `550d8bb`.
Méthode : protocole OSINT-IA fourni pour cette tâche ; découverte, validation
technique, observations, réfutation, synthèse. Une mesure sur un seul corridor ne
devient pas une règle pour toutes les paires.

## Décision et périmètre

Décider si Hermes peut obtenir, pour une même entrée et un même actif cible, plus
de tokens nets qu'une référence LI.FI. Le prototype est générique pour les actifs
EVM et les réseaux pris en charge par les fournisseurs. USDC Polygon → EURe Gnosis
est un cas de test ; USDC Base → WETH Arbitrum vérifie une autre classe de destination.

Le livrable autorisé est un prototype de mesure, les tests et les preuves, poussés
sur une branche GitHub. L'activation d'une nouvelle politique de routage en production
n'est pas déduite des recherches web. `AUTOMATED_WATCH=OFF`, `AUTO_POLICY_CHANGE=OFF`.

## 1/5 — Découverte

Hypothèses suivies dans [claims.json](claims.json) et sources dans
[sources.json](sources.json). Questions décisives :

- Un pont puis un échange local peut-il améliorer le devis global ?
- Le gain vient-il de la sélection des intermédiaires, des contrats de tokens,
  du fournisseur, de sa tarification ou d'un décalage de mesure ?
- Une fois le gaz et les approbations inclus, le gain persiste-t-il ?
- Le comportement tient-il sur une autre paire, un autre montant, un autre instant ?

## 2/5 — Validation technique

**Documenté** : LI.FI `/advanced/routes` accepte `allowSwitchChain: true` et
`order: CHEAPEST`. Son moteur peut déjà proposer plusieurs étapes. La référence
doit utiliser ces possibilités afin d'éviter un contrôle artificiellement dégradé.

**Documenté** : Relay `/quote/v2` accepte des montants exacts ; CoW expose une API
locale de devis et définit `sellAmountBeforeFee` comme le budget incluant les frais.
Les catalogues de tokens ne prouvent pas l'existence d'une route exécutable.

**Mesuré dans le dépôt** : `lib/routing/orchestrator.ts` trie sur `toAmount`.
Il ne soustrait pas le gaz externe. Les modules de normalisation/déduplication sont
des squelettes. La version du fichier AGENTS décrit en partie un état antérieur au
code présent ; l'implémentation réelle a été inspectée avant de choisir l'emplacement
du prototype. L'interface et son parcours d'exécution ne sont pas branchés au moteur
de recherche expérimental.

## 3/5 — Observations de terrain

**Observation externe** : l'issue LI.FI SDK #383 rapporte, pour des pools Uniswap v4
avec hooks sur Base, des échanges exécutables directement mais sans route LI.FI.
Ce signal porte sur ces contrats ; il ne prouve rien concernant USDC/EURe.

**Observation fournie avant ce cycle** : trois rounds de devis Relay du 21 septembre
2026 concernent USDT Ethereum → EURe Gnosis. Au premier round, direct EURe V2 :
173.450345806929113307 ; via USDC.e puis Relay local : 173.434766154706270525.
La séparation produit donc moins de tokens dans ce cas, avant même une validation
complète des approbations. Elle ne prouve aucun gain face à LI.FI ou CoW, absents
de ce jeu de données. Empreinte SHA-256 du ZIP fourni :
`dbb529947ce0876de34d04dc3db5441402b8cf7f1c991bd7847668bbbbe53953`.

**Mesures locales de ce cycle** : deux recherches réelles avec une adresse publique
de test, sans signature. Les résultats compacts, les fenêtres temporelles et les
incertitudes figurent dans [validation.json](validation.json). Les réponses utiles
ont aussi été projetées en fixtures de tests. Les traces complètes restent dans les
dossiers de mesure ignorés par Git.

Les essais réels prouvent l'interopérabilité des adaptateurs pour les requêtes
testées. Ils ne prouvent ni une exécution réussie ni une économie nette répétable.

## 4/5 — Réfutation

Le contre-exemple Relay historique affaiblit toute règle « toujours séparer les
étapes ». Des tests reproductibles vérifient aussi les situations suivantes :

- Une sortie brute supérieure devient moins avantageuse après le gaz.
- Un devis retourne un token homonyme au mauvais contrat.
- La quantité dépasse la précision des nombres JavaScript.
- Un fournisseur échoue, expire, se bloque ou manque des coûts.
- Un frais déjà intégré ou des étapes imbriquées sont comptés deux fois.
- Deux chemins arrivent au même token avec des quantités différentes ; les devis
  suivants doivent être redemandés pour chacune, sans taux extrapolé.
- Une route n'est bonne qu'à partir d'un pivot sur la chaîne source.
- L'élagage, le budget ou le délai tronquent la recherche : la couverture reste explicite.

Les tests de calcul peuvent établir un invariant du programme. Ils ne transforment
pas un devis synthétique favorable en preuve commerciale.

## 5/5 — Synthèse

**CANDIDATE_RULE** : générer plusieurs chemins, conserver les identités exactes des
actifs et comparer les résultats après coûts externes. Le programme teste cette
méthode ; aucune promesse de supériorité globale n'est faite.

**REJECT** : considérer une route en deux étapes comme automatiquement moins chère ;
assimiler les versions d'un token ; traiter un coût absent comme zéro ; annoncer
un minimum global en combinant des minima locaux cotés à des entrées différentes.

**TEST_LOCALLY / UNRESOLVED** : économie nette et répétabilité. Les coûts d'approbation,
le traitement du champ CoW `protocolFeeBps`, les allowances et le financement du gaz
restent à vérifier avant de qualifier un gagnant économique. Le prototype les
signale au lieu d'installer une règle de routage.

## Plan de validation suivant

1. Fixer les contrats exacts, le montant, le portefeuille, les frais Hermes et
   les bornes de recherche. Comparer la référence LI.FI et les candidats dans une
   fenêtre proche ; enregistrer aussi les échecs.
2. Lire les allowances, déterminer les approbations nécessaires et en estimer le gaz.
   Valider dans le code CoW l'application du frais protocolaire pour ces devis.
3. Faire un premier passage sur plusieurs classes : stable/stable, stable/actif
   volatil, actif volatil/stable, même chaîne, puis actifs moins liquides. Les
   contrats non standards demandent une validation dédiée.
4. Varier les montants en unités du token source, puis répéter uniquement les
   cas non dominés ou proches. Rapporter taux de succès, gain net médian et dispersion,
   durée, nombre d'appels et fréquence d'indisponibilité de la référence.
5. Rafraîchir les finalistes avant toute exécution. Pour une route séquentielle,
   coter l'étape suivante sur les fonds réellement arrivés. Une validation
   d'exécution avec fonds n'est pas incluse dans ce cycle de devis.

L'acceptation d'une règle opérationnelle exige des résultats complets et une
décision explicite. Le protocole de recherche n'est pas copié dans AGENTS.md.
