# Démo Terraform sur Clever Cloud — script de tournage

> **Public** : développeurs, débutants en infrastructure as code, décideurs
> **Format** : enregistré, avec des coupes pendant les attentes
> **Durée montée** : 5 minutes
> **Périmètre** : bootstrap → plan → apply → passage à 2 instances → destroy
> **Synchronisé avec le code** du dépôt (commit de ce fichier). Les durées viennent de la preuve du 4 novembre 2026.

## Principe

Tout est décrit en HCL : une app Node.js, sa base PostgreSQL chiffrée, la liaison entre les deux, la taille et le nombre d'instances. Le state Terraform lui-même est rangé chez Clever Cloud, dans un bucket Cellar, avec un verrou. L'app affiche ce qui a été déclaré face à ce qui tourne vraiment. On change un chiffre, on relit le plan, on applique : la page suit.

## Coupes au montage

| Moment | Attente masquée |
|---|---|
| `terraform init` (téléchargement des providers) | ~10 s |
| Après le premier `apply` de staging : build et démarrage de l'app | **~80 s** |
| Après le passage à 2 instances : déploiement progressif | **~3 min** |

## Avant d'enregistrer (5 min)

- [ ] `clever login` fait, puis dans le terminal :
  ```bash
  export CC_ORGANISATION=orga_xxx
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  ```
  Aucune de ces trois valeurs n'est un secret : elles peuvent apparaître à l'écran.
- [ ] Orga vide de toute ressource `blueprint-*` (`clever applications`, `clever addon`).
- [ ] Aucun fichier `infra/cellar.s3.tfbackend` ni state local restant (sinon `terraform destroy` dans `infra/bootstrap`).
- [ ] `infra/staging/main.tf` contient `min_instances = 1` et `max_instances = 1`.
- [ ] Un run complet à blanc dans la journée.
- [ ] Trois fenêtres : terminal (police 18+, dans `infra/bootstrap`), éditeur (`infra/bootstrap/main.tf`, `infra/modules/webapp/main.tf`, `infra/staging/main.tf`), Console Clever Cloud sur l'orga.

**À ne jamais montrer** : le contenu de `infra/cellar.s3.tfbackend`, un `terraform state pull`, un `terraform output` du bootstrap avec `-json`, l'onglet des variables de l'app dans la Console.

## Scène 1 — Intro (~30 s)

> « Sur Clever Cloud, on peut tout créer en quelques clics dans la Console. Mais ce qui est cliqué n'est ni relu, ni versionné, ni reproductible. Clever Cloud maintient un provider Terraform officiel. En cinq minutes, on va décrire deux environnements en code, staging et production, avec une base chiffrée, et même ranger la mémoire de Terraform chez Clever Cloud. »

## Scène 2 — Le code (~45 s)

**`infra/bootstrap/main.tf`** : `clevercloud_cellar`, `clevercloud_cellar_bucket`, `local_sensitive_file`.

> « Une étape d'amorçage : un Cellar, le stockage S3 de Clever Cloud, et un bucket. Terraform écrit lui-même le réglage du backend dans un fichier protégé : les clés ne passent jamais par l'écran ni par le terminal. »

**`infra/modules/webapp/main.tf`** : `clevercloud_postgresql` avec `plan = "xxs_sml"` et `encryption = true`, puis `clevercloud_nodejs` avec `dependencies = [clevercloud_postgresql.db.id]`.

> « Le module : une base PostgreSQL dédiée, chiffrée au repos, ce n'est même pas une option qu'on peut oublier. Et l'app, liée à la base : Clever Cloud lui injecte l'adresse de connexion. Aucun mot de passe dans le code. »

**`infra/staging/main.tf`** : le bloc `backend "s3"` (`key = "staging.tfstate"`, `use_lockfile = true`) et l'appel du module (`nano`, 1 instance).

> « Staging et production appellent le même module, avec leur taille. Le state de chacun va dans le bucket, avec un verrou : deux personnes ne peuvent pas appliquer en même temps. »

## Scène 3 — Bootstrap (~30 s)

```bash
terraform init          # coupe possible
terraform apply
```

Répondre `yes`. Environ 15 s. Basculer sur la Console : le Cellar `blueprint-tfstate` apparaît.

> « Le stockage du state est prêt. »

## Scène 4 — Staging (~1 min après montage)

```bash
cd ../staging
terraform init -backend-config=../cellar.s3.tfbackend
```

Montrer la ligne `Successfully configured the backend "s3"!`.

```bash
terraform plan -out=tfplan
```

Faire défiler le plan : `encryption = true`, `plan = "xxs_sml"`, `min_instance_count = 1`, `password = (sensitive value)`, `Plan: 2 to add`.

> « Le plan se relit comme une revue de code. Ce qui est secret reste masqué. »

```bash
terraform apply tfplan
terraform output url
```

`Acquiring state lock`, puis 4 s. **Coupe** (~80 s), puis ouvrir l'URL : *This is staging*, `1 alive · 1 declared`, PostgreSQL 18.6, chiffrement **on**.

> « À gauche ce qu'on a déclaré, à droite ce qui tourne. Chaque instance signe sa présence dans la base toutes les trois secondes. »

## Scène 5 — Le changement (~1 min après montage) ⭐

Dans l'éditeur, `infra/staging/main.tf` : `min_instances = 2`, `max_instances = 2`.

```bash
terraform plan -out=tfplan
```

Montrer les deux lignes `min_instance_count = 1 -> 2` et `max_instance_count = 1 -> 2`, et `instances = "1" -> "2"`.

> « Un changement, deux lignes dans le plan. C'est ce qu'on relit avant de valider. »

```bash
terraform apply tfplan
```

Garder la page ouverte : une deuxième tuile apparaît. **Coupe** pendant le déploiement progressif (~3 min). Les anciennes instances, marquées *Previous deployment*, s'éteignent après le démarrage des nouvelles. Reprendre sur `2 alive · 2 declared`.

> « Clever Cloud démarre les nouvelles instances avant d'arrêter l'ancienne : pas de coupure. »

## Scène 6 — Destroy (~30 s)

```bash
terraform destroy       # staging : 2 destroyed
cd ../bootstrap
terraform destroy       # bucket vidé, Cellar supprimé : 4 destroyed
```

Basculer sur la Console : plus rien.

> « Deux commandes, plus rien ne reste. Demain matin, on recrée tout à l'identique. »

Remettre `min_instances = 1` et `max_instances = 1` dans `infra/staging/main.tf` après la prise.

## Scène 7 — Conclusion (~30 s)

> « Ce qu'on a vu : un provider Terraform officiel, maintenu par Clever Cloud ; des environnements relus comme du code ; une base chiffrée imposée par le module ; et le state de Terraform hébergé à Paris, chez Clever Cloud. Le code est sur github.com/Vitiosum/demo-iac-terraform. »

## Si quelque chose bloque

| Problème | Solution |
|---|---|
| `terraform init` de staging échoue sur le backend | Le bootstrap n'a pas été appliqué, ou le terminal n'est pas dans `infra/staging` |
| `XAmzContentSHA256Mismatch` à l'écriture du state | Les deux `export AWS_…_CHECKSUM_…=when_required` manquent dans ce terminal |
| L'app reste *stopped* après le premier `apply` | Vu une fois : refaire un commit et un `apply`, il déploie aussitôt |
| `/health/deep` reste en 503 plusieurs minutes | Base pas démarrée (vu une fois) : `terraform apply -replace=module.webapp.clevercloud_postgresql.db` |
| Bootstrap détruit avant staging | À éviter : le bucket est vidé avec les states, et l'app et la base de staging restent sans state. Toujours `terraform destroy` dans l'environnement d'abord |

## Aide-mémoire

```bash
# Bootstrap
cd infra/bootstrap
terraform init
terraform apply

# Staging
cd ../staging
terraform init -backend-config=../cellar.s3.tfbackend
terraform plan -out=tfplan
terraform apply tfplan
terraform output url

# Le changement : min_instances = 2, max_instances = 2
terraform plan -out=tfplan
terraform apply tfplan

# Nettoyage, dans cet ordre
terraform destroy
cd ../bootstrap
terraform destroy
```
