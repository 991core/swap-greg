# Exploitation et incidents

Une instance initiale. Les limites/cache sont par processus ; plusieurs instances
ou appareils exigent une analyse de coordination et de quotas partagés. Le suivi
ne signe jamais et reste accessible pendant l'arrêt des nouvelles exécutions.

## Modes et arrêt d'incident

L'image publique initiale est construite avec `NEXT_PUBLIC_RELEASE_MODE=quotes` :
Rango `/swap` et 1Click `dry:false` refusent avant tout travail upstream ; les
cotations 1Click restent `dry:true`. Le dispatcher client contrôle aussi le mode.
Le mode `incident` ferme les nouveaux parcours et conserve le suivi. `enabled`
est un profil de recette, à ouvrir uniquement sur les classes réellement qualifiées.

`HERMES_EXECUTION_DISABLED=true` ferme les nouvelles préparations côté serveur et
`/api/release` retourne `executionEnabled:false` sans cache. Le dispatcher lit
ce contrôle avant ses nouvelles actions wallet. Pour appliquer une modification
runtime sous Docker, recréer le conteneur avec le même digest et les variables
mises à jour. Vérifier la réponse de `/api/release` et les refus avant de rouvrir.
Une action déjà présentée au wallet peut encore être confirmée par l'utilisateur ;
un arrêt logiciel ne révoque pas les transactions signées. Aucune recette ne doit
supposer qu'il annule un transfert en cours. Les exports/journaux doivent survivre.

## Limites et capacité

Les quotas client exigent un proxy validé (voir DEPLOYMENT). Valeurs par minute :

| Handler | Client identifié | Processus | Actions HTTP simultanées |
| --- | ---: | ---: | ---: |
| Rango quote / swap / status | 20 / 12 / 60 | 60 / 60 / 120 | 8 / 4 / 8 |
| 1Click quote / status / tokens | 20 / 90 / 20 | 60 / 240 / 60 | 8 / 8 / 4 |
| Token search / universe | 40 / 15 | 240 / 240 | 16 / 4 |

Les limites d'entrée comptent aussi les lectures de cache et les requêtes
malformées. Le budget `LIFI_SERVER_REQUESTS_PER_MINUTE` (120 défaut, 1–1000) est partagé
entre recherche, univers et enrichissement LI.FI, avant chaque fetch.
Les budgets provider internes limitent le véritable travail upstream,
coalescent 1Click/recherche/marché et isolent le statut des cotations. LI.FI token
search a son budget configurable `TOKEN_SEARCH_REQUESTS_PER_MINUTE` (60 défaut),
8 travaux distincts et cache 256 entrées. Les neuf préchargements de tokens au
montage consomment cette capacité lorsqu'ils sont froids. Une requête univers
peut demander plusieurs lectures de marché puis enrichir des contrats ; mesurer
les appels réellement effectués et les quotas détenus avant de fixer la capacité.

À 30 s par refresh, un formulaire utilise environ deux quotes/min/provider :
60/min représente au plus 30 formulaires, avant marge et reprises. Ce calcul
n'est ni un SLA ni une preuve de charge. Les statuts sont séparés ; 429/timeout
restent une panne de suivi, jamais une permission de renvoyer. Le proxy a ses
propres limites et lecture corps 5 s. Corps JSON : 4096 octets, lecture maximum
5 s ; réponses Rango/1Click/token search : 2 MiB avant accumulation JSON.
Les streams upstream ont une limite de temps ; aucun retry d'émission.

## Observabilité minimale

`HERMES_API_LOGS=true` produit des objets JSON contenant seulement événement,
nom fixe d'opération, statut HTTP et latence. Aucun URL, body, clé, IP, adresse
wallet, requestId ou intention financière. Les IP sont hachées avec un sel
éphémère uniquement pour les quotas, jamais loggées. Les counters process-local
`apiMetricsSnapshot()` agrègent demandes, erreurs, 429, latence et hit/miss de
cache ; aucun endpoint public de métriques ni export automatique du journal.
Activer la collecte avec une rétention bornée et des accès opérateur restreints.
Le proxy exemple évite l'URL/IP dans l'access log ; son error log doit être
réexaminé sur le serveur réel car les diagnostics système peuvent être sensibles.

Alertes à configurer sur le système existant : hausse durable 429/5xx/latence,
containeur unhealthy, mémoire/disque/TLS, configuration provider incompatible.
Une absence économique de route n'est pas un incident de livraison. Le contrôle
`/api/health` teste seulement le processus, aucun provider : une panne fournisseur
ne doit pas créer une boucle de redémarrage.

## Réponse à un incident et clés

1. Fermer les nouvelles exécutions ; maintenir les status et les preuves navigateur.
2. Distinguer panne API/RPC, quota, refus wallet et émission ambiguë. Conserver
   hash, requestId, minimum et destination depuis un export volontaire, dans un
   espace protégé. Ne jamais demander seed/clé privée.
3. Vérifier source/destination via lecture explorateur/provider. Un timeout,
   bare success, FAILED isolé ou receipt source ne justifie aucun nouvel envoi.
4. En cas de clé compromise, révoquer/créer la clé dans le portail fournisseur
   avec l'autorisation opérateur, injecter uniquement au runtime, recréer avec
   le même digest et contrôler les cotations/statuts en lecture seule. Ne jamais
   copier la clé dans un ticket, log, image, ARG ou rapport.
5. Corriger et rejouer les régressions liées au défaut ; vérifier la compatibilité
   des journaux et obtenir les nouvelles preuves requises avant réouverture.

Les API `/api/security/registry` et `/api/security/validate` répondent 410 dans
toute production, même avec l'ancien opt-in. La CLI historique reste disponible
pour un diagnostic local explicite. Ni registre, ni allowlist de contrats, ni
review ABI ne sont réintroduits comme autorité d'exécution.
