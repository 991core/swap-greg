# Statut actuel — 4 octobre 2026

À la demande de l'utilisateur, les contrôles obligatoires par registre et revue
locale des contrats/ABI sont retirés du parcours d'exécution. Le bouton Swap et
les adapters LI.FI, Rango et 1Click ne consultent plus les API du registre pour
autoriser les signatures. Des callbacks de validation optionnels restent
utilisables par les outils isolés, mais Hermes ne les installe pas.

Les contrôles de cotation, métadonnées, verdicts négatifs et consentement,
compte/réseau, soldes/gas, confirmation wallet et suivi restent actifs.
LI.FI utilise le SDK EVM, avec un transport qui vérifie le wallet et les fonds
sans exiger de liste de routeurs ni décoder chaque protocole. Aucun swap réel
n'a été signé pour valider ce changement.

Le registre et sa CLI restent disponibles pour les diagnostics et la découverte.
Les API historiques sont fermées en production. Les fichiers de diagnostic ne
sont pas une condition de signature ; le nouveau journal local des transferts
reste, lui, obligatoire avant toute émission.

Le parcours actif et le rôle des outils historiques sont précisés ci-dessous.

---

# Parcours actif de cette release

- Le profil public construit avec `NEXT_PUBLIC_RELEASE_MODE=quotes` sert les devis
  mais refuse toute préparation de dépôt exécutable et tout appel wallet d'envoi.
  Le mode `enabled` n'est pas livré comme capacité qualifiée pour fonds réels.
- L'identité utilisée pour sélectionner et comparer les tokens est le réseau,
  l'adresse et les décimales. Le catalogue local est une commodité vérifiée,
  pas une restriction sur la découverte. Un verdict négatif observé reste
  bloquant ; un actif non vérifié exige le consentement explicite prévu.
- Avant un envoi, la quote, le minimum, les frais, le compte, le réseau, les
  soldes, la valeur native et le gas sont revérifiés. Les méthodes wallet
  supportées sont les transactions EVM standard d'un EOA injecté. Les approvals
  sont finies. Les méthodes batch, permits typés, AA et EIP-7702 sont refusées.
- Chaque provider passe par un journal local versionné et un verrou Web Locks
  par wallet avant la première action wallet. Un résultat ambigu ou une sortie
  non prouvée bloque une nouvelle émission ; les dossiers sont exportables et
  le suivi restauré ne signe jamais. Cette protection couvre un profil
  navigateur, pas plusieurs appareils ni un stockage volontairement effacé.
- Le succès exige une sortie correspondant à l'actif, au réseau et au minimum
  conservés. La preuve fournisseur est identifiée comme telle ; une receipt
  source et une simple variation de solde ne prouvent pas la livraison.

# Outils historiques autonomes

`lib/security/` conserve un registre, une CLI et une validation indépendante
pour diagnostic. Leur ancienne politique de routeurs/spenders/ABI **n'autorise
pas** le parcours actif et n'est pas exigée pour signer. Les anciennes API
`/api/security/registry` et `/api/security/validate` répondent 410 dans le
profil public. Les composants de marché et la garde wallet encore utilisés
restent actifs. Le catalogue et les sources de marché sont documentés dans
`TOKEN_CATALOG.md` et `ARCHITECTURE.md`.

La documentation détaillée de l'ancienne politique reste consultable dans
l'historique Git et les dossiers d'audit. Ses anciennes commandes de registre
ne sont pas des étapes de publication d'Hermes. Les simulations, les builds et
les réponses HTTP n'ont pas qualifié de transfert avec fonds.
