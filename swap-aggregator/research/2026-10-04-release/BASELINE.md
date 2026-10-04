# Baseline avant corrections

Relevé au début de cette mission, avant édition par cette équipe : branche
`feat/hermes-oneclick`, HEAD `86159fb636d1b779c85818a261b07e05512cd9f0`,
Node `v22.23.3`, npm `12.2.0`. L'arbre avait déjà 20 fichiers suivis modifiés
et `research/` non suivi. Aucun reset, clean ou checkout n'a été fait.

Fichiers suivis déjà modifiés : `.env.example`, `AGENTS.md`, `ARCHITECTURE.md`,
`README.md`, `TOKEN_SECURITY.md`, `components/SwapCard.tsx`,
`components/TokenSelectModal.tsx`, `lib/aggregators/lifi/client.ts`,
`lib/aggregators/lifi/execute.ts`, `lib/aggregators/oneclick/execute.ts`,
`lib/aggregators/rango/execute.ts`, `lib/routing/execute.ts`,
`lib/security/lifi-wallet.ts`, `tests/client.test.ts`,
`tests/execution.test.ts`, `tests/oneclick.test.ts`,
`tests/rango-execution.test.ts`, `tests/security-api.test.ts`,
`tests/security-wallet.test.ts`, `tests/swap-refresh.test.tsx`.

La capture de l'audit historique `research/2026-10-04-finalisation/evidence/baseline.json`
contient les empreintes SHA-256 de chaque fichier suivi de cet arbre et
`integrity-final.json` confirme qu'elles correspondaient encore avant mission.
Nous ne les avons pas modifiés. Quelques empreintes relevées directement avant
édition : `AGENTS.md` `83df155362a8857075858e04842565a743dd969e4d0db838ab923101fd2881c7`,
`README.md` `abebc686e566203766356007c349c5d18fdae2e21500ad4b9ad94ac11e1210a6`,
`ARCHITECTURE.md` `a0bebfe64b82174948712fdccffc98b9d04722bf3c04363a854630e98bff4823`,
`.env.example` `8333ddff66300525b538b606a1aa635f5655fb1e6a4485bb5ecb7344fcf84ae5`.

`checkpoint-after-initial-edits.json` est un **point intermédiaire**, enregistré
après le début des corrections. Il ne doit pas être présenté comme la baseline.

## Reproductions avant correction

Les quatre scripts historiques ont été rejoués sans réseau et sans fonds :

| Défaut | Résultat observé |
| --- | --- |
| Minimum LI.FI | route `1000000`, étape reconstruite `995001`, hook appelé `0` fois |
| Destination LI.FI | `REFUNDED` et `PARTIAL` produisent `DONE` et l'ancienne condition UI de succès est vraie |
| Nouvelle garde | 3 essais, 2 appels d'envoi mock ; une nouvelle garde n'hérite pas du verrou de l'ancienne |
| Valeur native | principal `100`, `value` `100000000`, solde `50000`, gas `25200`, 1 envoi mock |

Les scripts et leurs résultats historiques demeurent dans le dossier d'audit.
Ces appels d'envoi sont des mocks RPC, pas des transactions réelles.
