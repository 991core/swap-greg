# Corrections LI.FI — 4 octobre 2026

État : corrections implémentées et vérifiées automatiquement en local. Aucune signature, aucun transfert réel, aucune qualification de wallet injecté réel ni de livraison mainnet. Les fixtures RPC/HTTP n'accèdent à aucun fournisseur.

## Reproductions historiques

Les quatre scripts historiques ont été rejoués intactement avant correction. Résultats nouveaux : `minimum.before.json`, `destination-status.before.json`, `guard-scope.before.json`, `native-value.before.json`. Ils confirment le comportement historique du SDK et de la copie de garde conservée. Les fichiers `research/2026-10-04-finalisation/` restent intacts. La copie historique de garde ne doit pas servir de test du code corrigé.

`regressions.before.txt` montre trois régressions comportementales en échec avant correction : valeur native excessive transmise, capacité atomic exposée, approval illimitée acceptée. Les régressions des minima et sous-statuts utilisent ensuite les tâches réelles des SDK installés, avec HTTP/wallet remplacés.

| Ticket | Modification | Vérification | Limite |
| --- | --- | --- | --- |
| F0-01 minimum | Snapshot indépendant du devis, contrôle minimum de l'étape reconstruite et du global; hook officiel `updateTransactionRequestHook` et comparaison finale de la requête wallet avec celle préparée | Vraie `EthereumPrepareTransactionTask`: `1000000 → 995001` et `994900` bloqués; unchanged/hausse admis; transaction altérée bloquée | Contrôle de l'étape et enveloppe fournis par LI.FI, aucune interprétation ABI des contrats; confirmation wallet tardive/deadline on-chain restent dépendantes du fournisseur |
| F0-02 destination | Lecture `getStatus` liée au hash source, chaînes, tool/transactionId disponible, token/adresse/décimales, compte/destinataire, hash destination et minimum; evidence explicitement fournisseur | Vraie `WaitForTransactionStatusTask` retourne DONE pour PARTIAL/REFUNDED; nouveau classificateur conserve alternative/refund, jamais livraison attendue. Mauvaises identités/montants/preuve absente bloqués | Preuve API fournisseur, sans vérification cryptographique ou receipt destination indépendante; remboursement annoncé reste non vérifié |
| F0-03 ambiguïté | Journal requis; `beforeAction` avant émission; résultat hash conservé; rejet 4001 distinct; erreur ambiguë bloquante et sans retry; `notSent` si aucun appel émission tenté | Nouveau client de garde et nouvelle exécution/restauration bloqués après erreur ambiguë; un seul appel RPC simulé; stockage avant/après émission et export d'urgence couverts par journal commun | Protection navigateur/profil avec Web Locks et stockage intacts; le journal commun est responsable de la coordination et de la reprise |
| F0-04 capacité | `allowSwitchChain:false`, `executionType:transaction`; une étape wallet source; typedData/custom wallet workflows refusés; capacités atomic masquées; compte JSON-RPC sans code et enveloppe EVM type 0/1/2 | Vraie stratégie SDK reste standard malgré capacité atomic upstream; étapes wallet multiples/relay, AA/7702 et méthodes inconnues bloqués | Incluses étapes automatiques dans une transaction source restent disponibles; plusieurs étapes wallet explicites non supportées; aucun wallet réel qualifié |
| F0-07 budget natif | `value + gas` contre solde; valeur bornée au principal natif + frais natifs source explicitement cotés et non inclus; malformed fees bloquées | Fixture principal100/value100000000 rejetée avant demande; native/ERC20 avec frais explicites admis dans la borne; gas/solde lus après persistance | Gas est estimé avec marge et prix réseau/ceiling RPC; aucune garantie d'un coût final mainnet ni nouvelle politique d'ABI/allowlist |
| Approvals / asynchronisme | Approve limité au token source et montant exact ou reset zéro, sans allowlist de spender. SDK `disableMessageSigning:true`; quote/identité/frais/minimum relus après autorisation, incident check, stockage et estimations | Vraies tâches SDK allowances 0/1/100/101 et reset nécessaire; expiration/changement de fonds/mode après persistance empêchent l'envoi; proof source SDK associée au hash sauvegardé | Une approval confirmée avant expiration peut avoir un coût réel et rester on-chain; la quote expirée empêche le swap et n'autorise aucun renvoi automatique |

## Interfaces intégrées

- `executeLifiRoute` requiert `security.check` et un journal; renvoie la route étendue avec `hermesDelivery` optionnel pour compatibilité de type. Le succès UI doit exiger `hermesDelivery.state === delivered`.
- `LifiWalletSecurity.journal` expose `beforeAction`, `sent`, `rejected`, `ambiguous`, avec `notSent`, `saveProviderState`, `snapshot`, `confirmed` lorsqu'ils existent. Le dispatcher commun transmet la vraie session atomique.
- Les étapes SDK source/approval DONE liées à un hash connu sont enregistrées comme `sdk_source_receipt`; elles ne constituent jamais une preuve de livraison destination.
- Après persistance, la garde relit le mode serveur via `assertExecutionEnabled`, les fonds/gas, puis compte/réseau/code et la politique de devis. Quotes/incident et endpoint indisponible bloquent les nouvelles émissions. Le tracker n'obtient aucun wallet.
- `lifiTrackingIntent`, `trackLifiDelivery`, `classifyLifiStatus` permettent une reprise de suivi en lecture seule, sans `resumeRoute`.

## Tests et limites de qualification

`verification.after.txt` contient les tests LI.FI dédiés et tests de garde/client existants. Typecheck et ESLint des modules LI.FI/garde passent. La coordination UI, les contrôles globaux/build et la revue indépendante sont vérifiés par le coordinateur.

Le profil public demeure en cotations seules. L'ouverture avec fonds nécessite une autorisation de recette, la confirmation financière de l'utilisateur, une preuve source/destination réelle pour chaque classe annoncée et une autorisation de publication distincte. Aucun de ces éléments n'est déduit des tests ci-dessus.
