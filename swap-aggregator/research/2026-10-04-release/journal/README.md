# Journal durable et reprise — 4 octobre 2026

Statut : implémenté et vérifié avec stockage, wallets et RPC simulés. Aucune signature, aucun fonds, aucune qualification de livraison réelle ni de déploiement cible.

Les preuves historiques du dossier `2026-10-04-finalisation` sont conservées. E3/E6 décrivaient correctement l'absence de journal LI.FI, le verrou React par onglet et les dossiers Rango/1Click mono-record. Le nouveau journal ne réintroduit aucun registre de tokens, aucune allowlist ni revue ABI.

## Modèle et frontières

`lib/intent/journal.ts` conserve plusieurs dossiers version 2, chacun sous une clé distincte `hermes:intent:v2:<id>`. Il conserve la demande exacte, réseau/adresse/décimales, compte/destinataire, quote complète sélectionnée, minimum, expiration, frais plateforme/slippage et gas coté. Chaque action conserve l'enveloppe EVM exacte, son état et son hash. L'adapter ajoute son intention reconstruite et les instructions de suivi dans `providerState`.

Le journal initial est écrit et relu avant la première action wallet possible. Chaque action est durablement `emitting` avant d'appeler le wallet. Une erreur d'écriture bloque l'appel. Une erreur après émission possible conserve le verrou durable et une copie mémoire exportable des preuves nouvelles (dont un hash reçu mais non sauvegardé). Ne pas fermer/recharger l'onglet avant l'export si une erreur de persistance survient après émission : la copie mémoire ne survit pas à la fermeture ; l'ancien dossier durable demeure bloquant.

Les états distinguent refus explicite, action non demandée, émission, ambiguïté, source connue/révertie, approval seule confirmée, destination en attente, livraison attendue, sortie alternative, remboursement annoncé/vérifié et intervention. Un code wallet 4001 ou `UserRejectedRequestError` peut établir le refus ; un message texte, timeout, 404 ou FAILED fournisseur ne libère jamais une émission possible.

Après une approval confirmée et une expiration du devis, aucune signature ne termine automatiquement le swap. Le dossier garde le hash et l'état `approval_only`. Une nouvelle exécution exige un nouveau choix explicite et les contrôles usuels ; l'approval payée et l'allowance préexistante demeurent sur le réseau.

## Coordination et périmètre

Un Web Lock exclusif par wallet couvre toute l'exécution, tous providers et toutes chaînes de ce wallet. L'acquisition concurrente avec `ifAvailable` refuse le deuxième onglet. Le navigateur libère le verrou après fermeture de l'onglet ; les dossiers `emitting`/ambigus restent bloquants après perte du verrou. Aucun TTL ou ancien verrou localStorage n'efface cette incertitude. Les écritures de suivi et réconciliation utilisent ce même verrou.

En l'absence de Web Locks ou de stockage accessible, Hermes refuse l'exécution. Un événement storage sert à actualiser l'affichage, jamais à remplacer l'acquisition atomique. Protection limitée à la même origine et au même profil navigateur : pas de coordination multi-appareils, autre origine ou autre profil. L'effacement volontaire des données navigateur et les extensions/scripts compromettant la même origine peuvent supprimer les preuves ; ce journal local n'est pas un registre serveur ni une sauvegarde financière indépendante.

## Restauration, migration, export et réconciliation

La lecture/restauration ne possède aucun chemin vers un wallet, SDK `resumeRoute`, approval ou envoi. Les anciennes clés Rango/1Click restent intactes. Une copie de migration conserve les anciens dossiers, même malformés, sous `intervention_required`. Une identité illisible bloque tous les nouveaux wallets jusqu'à diagnostic. Les dossiers legacy dont `journalId` correspond déjà à un dossier v2 du même provider/wallet ne sont pas dupliqués.

`exportIntentJournal()` produit un diagnostic volontaire avec les dossiers bruts, même corrompus, et les preuves mémoire disponibles après échec d'écriture. Cet export contient des adresses et intentions financières ; il n'est jamais envoyé ni journalisé automatiquement.

`reconcileSourceHash(intentId, actionId, hash)` effectue uniquement des lectures RPC. Le hash proposé doit correspondre exactement au compte, réseau, destinataire de la transaction, calldata et valeur persistés. Une receipt source réussie laisse la destination en attente ; une receipt révertie établit l'échec source. Une approval source confirmée rétablit l'état approval seule. Aucun remboursement ni livraison destination n'est inféré d'une receipt source, d'un solde ou d'une assertion isolée. Le hash récupéré est attaché aux informations provider existantes afin de reprendre leur suivi en lecture seule. Un legacy incomplet ne peut pas être reconstruit artificiellement : export et réconciliation indépendante restent nécessaires.

Rango conserve FAILED, sorties alternatives et remboursements annoncés, avec la réponse provider et les diagnostics disponibles ; ces états restent bloquants. Son succès correspond à la preuve fournisseur d'un DESIRED_OUTPUT sur le réseau/actif/décimales et montant minimum attendus, interrogée par requestId/hash source. Ce n'est pas une preuve on-chain indépendante ni une vérification cryptographique du provider. 1Click conserve sa validation de quote/signature déclarée/hash source/preuve destination/minimum ; un SUCCESS nu ne suffit pas.

## Vérifications

`tests/intent-journal.test.ts` teste la persistance avant wallet, plusieurs dossiers, course entre onglets, fermeture/perte de verrou/reload et ancien lease, échec stockage avant/après émission avec export hash, refus vs ambiguïté, corruption, migration prudente, suivi sans nouvelle action, approval expirée et récupération source exacte (incluant from/to/data/value/chaîne/hash receipt incorrects).

Les suites Rango et 1Click conservent leurs régressions économiques et identité/wallet. Le test 1Click qui essayait une deuxième émission après un timeout de receipt a été corrigé pour vérifier son refus ; la receipt inconnue est testée dans une intention indépendante. La modification renforce le comportement observable de non-réémission.

Restent à qualifier dans l'environnement cible : HTTPS et Web Locks sur les navigateurs supportés, persistance réelle et quotas du profil navigateur, exports/reload réels, accès RPC/providers de production, et recette financière explicitement autorisée. Les tests de verrou simulent le contrat Web Locks avec stockage commun ; ils ne démontrent pas le support de tous les navigateurs.

## Corrections issues de la revue indépendante

IR-1 : `lib/intent/tracking.ts` reconstruit le suivi depuis le journal complet après reload, même si les anciennes clés mono-record ont disparu. LI.FI reprend les identités/minimum du seed et le hash source conservé ; Rango valide le providerState et effectue une seule interrogation ; 1Click valide la quote expirée conservée puis lit une réponse bornée à 64 KiB. Le résultat retourne état, preuve et providerState à persister ; il n'appelle aucun wallet ni fonction SDK d'exécution. Les tests de reload couvrent les trois providers.

IR-2 : après l'attente du contrôle runtime de release, les adapters Rango/1Click relisent fonds/gas et recontrôlent compte/réseau/devis ; des tests injectent une baisse du solde pendant cette attente et vérifient zéro demande wallet.

IR-5 : une enveloppe source identique ne distingue pas à elle seule une ancienne transaction. Les nouveaux adapters Rango/1Click conservent le nonce source pending avant émission et le fournissent explicitement à leur demande wallet. La réconciliation automatique exige le nonce conservé et vérifie celui de la transaction lue. Sans nonce sauvegardé, le dossier reste bloquant et exige une réconciliation indépendante ; aucune reconstruction du nonce après émission ne prétend établir l'identité de l'action. Les régressions rejettent une ancienne transaction identique de nonce différent et un dossier sans nonce. Un nonce choisi manuellement autrement dans le wallet peut nécessiter un traitement indépendant ; aucune remise à zéro du dossier n'est effectuée.

Le périmètre EOA est aussi vérifié avant chaque action Rango/1Click par lecture du code de l'adresse source. Un wallet contractuel ou une délégation EIP-7702 non vide est refusé avant wallet, avec recontrôle du compte/réseau après la lecture RPC.

IR-6 : un arrêt contrôlé avant tout appel wallet marque l'action `not_sent`, conserve l'archive et libère seulement le pending UI mono-record : Rango publie pending null ; 1Click publie FAILED avec sourceOutcome `not_sent` et sans hash. Un refus après appel possible reste bloquant sauf code de rejet wallet explicite. Les tests vérifient ces callbacks et l'absence d'émission.

Les RPC de nonce sont effectuées avant publication d'un pending UI. Une seconde lecture pending du nonce accompagne la dernière lecture des fonds ; un changement bloque la demande wallet. Le journal refuse aussi de réutiliser un nonce déjà associé à un hash conservé pour ce compte/réseau, y compris après approval seule ou échec source établi ; un RPC en retard ne peut ainsi faire accepter une transaction ancienne comme nouvelle preuve.

Une intention initiale `prepared` sans aucune action est distinguée d'une émission possible : aucune méthode wallet n'est atteignable sans écriture durable de l'action. Un échec du stockage initial bloque la tentative, puis permet une nouvelle tentative si le stockage redevient disponible et aucune action n'existe. Une session fermée après libération de son Web Lock refuse toute nouvelle `beforeAction`, même depuis un ancien callback SDK ou timer.
