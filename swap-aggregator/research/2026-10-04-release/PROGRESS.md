# Suivi de finalisation Hermes — 4 octobre 2026

État final de cette mission locale : corrections intégrées ; 718 tests, typecheck,
lint et build réussis ; revue indépendante clôturée. Le profil public de l'image
proposée reste **cotations seules**, frais Hermes zéro et arrêt runtime actif.
Aucune opération avec fonds ni déploiement n'a été autorisé ou réalisé.

| Ticket historique | État du code local | Vérification et limite |
| --- | --- | --- |
| D0-01 mode cotations | Implémenté | API, transports, UI et mode incident testés ; standalone `/api/release` renvoie `false` ; image Docker non construite. |
| D0-02 Docker/Portainer | Artefacts préparés | Next standalone démarre localement avec ses assets ; Docker absent, image/digest/Compose/Portainer non vérifiés. |
| D0-03 bornes et budgets API | Implémenté | Tests corps/réponses streaming, quotas et suivi ; proxy cible et trafic réel non vérifiés. |
| D0-04 frais/erreurs UI | Implémenté | Régressions fee/gas malformés, quota, configuration, partiel ; navigateur local contrôlé. |
| D0-05 production fournisseurs/information | Documentation et profil fermé | Clés, conditions, quotas, opérateur et HTTPS du serveur à vérifier avant publication. |
| F0-01 minimum LI.FI | Corrigé | Reproduction SDK et tests de transport refusent 1000000 → 995001 avant wallet. |
| F0-02 livraison LI.FI | Corrigé | PARTIAL, REFUNDED, mauvais actif/réseau/montant ou preuve absente ne deviennent pas succès. |
| F0-03 journal/réconciliation | Implémenté | Journal v2 et suivi lecture seule, nonce, stockage, crash, onglets testés ; aucune preuve on-chain réelle. |
| F0-04 capacités wallet | Implémenté | EOA EVM standard, approvals finies, routes incompatibles affichées mais non exécutables ; wallets réels non qualifiés. |
| F0-05 choix et onglets | Corrigé | Pas de première route substituée ; Web Locks et dossiers ambigus testés ; portée navigateur/profil. |
| F0-07 native value/gas | Corrigé | Fixture 100/100000000/50000 et ERC-20 avec frais/gas refusés avant émission. |
| F0-06 périmètre signé qualifié | Non réalisé | Autorisation financière séparée, wallet, budget et preuves destination requis. |
| P1-01 prix périmés | Corrigé | Affichage retiré quand obsolète ; classement ne bloque pas la sélection locale. |
| P1-02 observabilité | Implémenté | Logs minimisés, compteurs et export volontaire ; rétention/alertes opérateur à définir. |
| P1-03 mobile/a11y | Contrôle local partiel | FR/EN, 390/768/1280 px, tabulation, focus modal/Échap ; wallets et lecteurs d'écran réels non testés. |
| P1-04 dépendances/CI | Partiel | Lockfile conservé, `npm ls` réussi, tests de contrat SDK ; `npm audit` indisponible (DNS EAI_AGAIN) et image non scannée. |

Preuves détaillées : [rapport de release](./RELEASE_REPORT.md),
[revue indépendante](./INDEPENDENT_REVIEW.md), rapports des sous-missions
`lifi/`, `journal/`, `operations/`, et logs sous `verification/`.
