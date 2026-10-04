# Distribution locale Hermes — 4 octobre 2026

Profil livré : **Docker Standalone provisoire**, une instance, cotations seules,
frais Hermes zéro, proxy HTTPS existant sur l'hôte. Aucune publication ni recette
avec fonds n'est autorisée par ces fichiers. Le serveur, son architecture CPU,
Portainer, DNS/TLS et le proxy n'ont pas été inspectés. Docker est absent de
l'environnement de correction : construction, scan OS, permissions conteneur,
healthcheck Docker, Compose et rollback conteneur restent à vérifier sur une
machine locale disposant de Docker, avant toute publication.

## Construction reproductible

Node `22.23.3-bookworm-slim` est épinglé au digest de son index multiarchitecture
`sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c`.
Il a été lu sur le registry officiel Docker Hub le 4 octobre 2026. `npm ci`
respecte `package-lock.json`. Le build copie explicitement les sources utiles,
puis le runtime copie uniquement standalone, `.next/static` et `public`.
L'utilisateur est UID/GID 10001 ; aucune installation au démarrage.
Le digest épinglé ne signifie pas que l'image OS a été scannée.

Exemple de préparation **locale** (les valeurs de release sont à établir dans
le dossier de preuves ; une référence commit seule ne décrit pas l'arbre sale) :

```bash
node deploy/source-manifest.mjs > /tmp/hermes-source-manifest.json
# Choisir une architecture correspondant au serveur avant la construction.
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_RELEASE_MODE=quotes \
  --build-arg NEXT_PUBLIC_PLATFORM_FEE_PERCENT=0 \
  --build-arg HERMES_SOURCE_REVISION=<commit-verifie> \
  --build-arg HERMES_SOURCE_TREE=<empreinte-manifeste> \
  -t hermes:recette-locale .
docker image inspect hermes:recette-locale
```

Les paramètres `NEXT_PUBLIC_*` sont intégrés au JavaScript au **build**. Changer
une variable Portainer ne transforme pas une image cotations en image exécution.
Les clés LI.FI/Rango/1Click/CG/CMC ne sont jamais des ARG de build. Ne copier aucun
`.env.local`, `stack.env`, export navigateur ou clé privée dans le contexte.
Les placeholders `<...>` des commandes sont volontairement non exécutables.

## Vérifications Docker avant promotion

Sur une machine de recette locale, lancer l'image sans clés et sans exposition
publique ; monter seulement `/tmp` et `/app/.next/cache` en tmpfs avec UID 10001.
Vérifier `/`, `/api/health`, `/api/release`, les SVG et fichiers statiques,
les erreurs d'entrée API, les 410 diagnostics, les 403 préparations exécutables,
et l'accès en lecture aux statuts. Vérifier SIGTERM, redémarrage et disparition
des seuls caches, ainsi que les permissions sous racine en lecture seule.
Ne faire aucun appel `/swap` en mode enabled et ne brancher aucun wallet.

```bash
docker run --name hermes-recette --init --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:size=32m,mode=1777 \
  --tmpfs /app/.next/cache:size=32m,uid=10001,gid=10001,mode=0700 \
  -p 127.0.0.1:3187:3000 \
  -e HERMES_EXECUTION_DISABLED=true hermes:recette-locale
# Dans un autre terminal local :
curl --fail http://127.0.0.1:3187/api/health
curl --fail http://127.0.0.1:3187/api/release
docker inspect hermes-recette
docker stop --time 30 hermes-recette
```

Scanner l'image via l'outil disponible sur la machine de recette, conserver
SBOM/version des outils/résultats et analyser l'exposition réelle des avis.
Aucune mise à jour massive ou `audit fix --force` n'est requise. Comparer image ID
locale (configuration) et RepoDigest après une éventuelle publication autorisée :
ce sont des objets distincts. Une promotion future doit utiliser **le même digest**
qualifié, un tag de release et la configuration publique conservée.

## Adapter Portainer et le proxy existant

`compose.portainer.yml` n'utilise ni `env_file`, ni directives Swarm : fournir
ses variables dans l'interface Standalone de Portainer. `env.example` décrit
les valeurs ; les secrets restent dans le moyen protégé de l'opérateur.
Les administrateurs Portainer/daemon peuvent lire les variables : ce n'est pas
un coffre-fort. `HERMES_IMAGE` doit être une référence réelle
`registry/hermes:release-id@sha256:<digest vérifié>`, jamais `latest`.

Le profil publie seulement `127.0.0.1:3187`. Pour un proxy **conteneurisé**,
retirer `ports`, connecter Hermes au réseau externe existant du proxy, faire
pointer ce proxy vers le service `hermes:3000` et ne pas exposer directement
Hermes. Ne pas inventer le nom du réseau ni installer un nouveau proxy.
Les limites 1 CPU/768 MiB sont des valeurs initiales à mesurer, pas une mesure
du serveur. `json-file` est borné à 3 fichiers de 10 MiB, arrêt gracieux 30 s,
`restart: unless-stopped`. Un conteneur unhealthy exige une alerte ; Docker ne
redémarre pas automatiquement un processus encore vivant uniquement pour ce motif.

`HERMES_PUBLIC_ORIGIN` est l'origine HTTPS canonique sans chemin. Les handlers
ignorent `X-Forwarded-Proto`/`X-Forwarded-For` pour établir leur autorité.
Activer `HERMES_TRUST_PROXY=true` **uniquement** après avoir vérifié que l'accès
direct public est impossible et que le proxy écrase `X-Hermes-Client-IP` avec
l'IP qu'il a lui-même établie. Un seul IP valide est accepté ; les listes XFF
ne sont jamais interprétées. Sans ce mode, tous les clients partagent le budget
non attribué : il protège les coûts, mais n'isole pas les clients abusifs.
`proxy.example.conf` est un exemple Nginx à intégrer au proxy réellement retenu,
pas une configuration déployée. Si un CDN précède le proxy, définir ses plages
fiables exactes. Tester faux Host, Origin, protocole et IP avant ouverture.

## Sauvegarde, mise à jour, restauration

Conserver le manifeste source, lockfile, paramètres publics de build, référence
d'image/digest et configuration proxy/stack ; protéger les secrets séparément.
Les intentions financières sont dans le **navigateur** : une sauvegarde Docker
ne les restaure pas. L'export du journal est volontaire et contient des données
financières sensibles. Ne pas effacer le stockage pour débloquer une émission.

Pour une future mise à jour autorisée : checks/revue → image locale vérifiée →
recette privée → promotion du même digest → smoke HTTPS/statuts. Conserver le
digest et la configuration précédents. Tester que la version précédente peut
relire les journaux créés par la nouvelle version ; sinon fermer les nouvelles
exécutions et conserver le suivi compatible avant de revenir en arrière.
Exercer ce rollback localement avant d'autoriser des fonds.

## Informations restant à fournir

- Docker Standalone confirmé, version Portainer et architecture CPU.
- Proxy existant, domaine HTTPS, accès réseau et ressources réelles.
- Accès production/providers, quotas et conditions compatibles avec le trafic.
- Autorisations distinctes de publication d'image, déploiement et recette financière.

Sources officielles consultées le 4 octobre 2026 :
[Next standalone](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output),
[services Compose](https://docs.docker.com/reference/compose-file/services/),
[stacks Portainer](https://docs.portainer.io/user/docker/stacks/add).
