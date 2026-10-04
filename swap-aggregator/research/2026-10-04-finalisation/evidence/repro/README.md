# Reproductions locales Hermes — 2026-10-04

Exécuter chacun avec Node 22+, par exemple `node research/2026-10-04-finalisation/evidence/repro/minimum.mjs`.
Les chemins SDK pointent vers le checkout actuel. `lifi-wallet.mjs` et `quote-validator.mjs` sont transpilés depuis les sources du checkout, sans altérer le code et sans remplacer les règles de validation ; seuls les chemins d'import sont adaptés.

Ces scripts n'accèdent à aucun réseau ni wallet réel. Les réponses sont simulées. `actualBroadcastRequests` / `forwardedRequests` désignent les appels du mock RPC, pas des transactions réelles. Les fixtures prouvent des chemins de code ; elles ne prouvent pas qu'un fournisseur a renvoyé un payload de cette forme en production.

- minimum.mjs : SDK réel laisse baisser le minimum du seul step, route top-level inchangée, hook false non appelé.
- destination-status.mjs : SDK réel retourne DONE pour REFUNDED/PARTIAL avec token destination alternatif, condition de succès Hermes vraie.
- guard-scope.mjs : garde A bloque sa deuxième demande après erreur ambiguë ; une garde B sur nouvelle exécution peut transmettre de nouveau.
- native-value.mjs : préflight natif compare le principal original au solde au lieu de la valeur réelle de transaction, permettant de transmettre un payload non finançable au mock.

La correction des bornes de consentement et de suivi ne requiert pas de rétablir une allowlist ou une revue ABI obligatoire.

Les quatre scripts ont été relancés indépendamment par le coordinateur depuis ce dossier ; résultats dans `verification-coordinateur.json`. Les imports absolus visent le checkout analysé et ses versions installées ; aucune dépendance n’a été installée. Les modules transpilés sont des copies de preuve, pas des corrections.
