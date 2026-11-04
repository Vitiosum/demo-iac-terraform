# Blueprint — Terraform on Clever Cloud

> A platform team describes its environments in code. Here, `infra/staging` and `infra/production` call the same module: a Node.js app, its PostgreSQL database **encrypted at rest**, the link between them, a declared size and an instance count. `terraform plan` reads like a code review, `terraform apply` creates the lot in seconds, and the app shows what was declared next to what actually runs: every instance writes a heartbeat into PostgreSQL. Raise the instance count, read the diff in the plan, apply it, and a second instance lights up. `terraform destroy` leaves nothing behind. Built on the official provider [`CleverCloud/clevercloud`](https://registry.terraform.io/providers/CleverCloud/clevercloud/latest) v3.

![Staging after the change: two instances alive, as declared](docs/staging.png)

| Phone, the declaration | Phone, what runs |
|---|---|
| <img src="docs/phone-top.png" width="300" alt="The declaration on a phone"> | <img src="docs/phone-instances.png" width="300" alt="Two instances and the database on a phone"> |

**Run it yourself.** The hosted demo was taken down after the presales proof (November 2026). [Deploy on Clever Cloud](#deploy-on-clever-cloud) recreates an environment in about 5 minutes, most of it the first build.

## What Terraform does here

| Where | Terraform feature | What you see |
|---|---|---|
| `infra/modules/webapp` | A module: one shape for every environment | Staging and production differ by a few lines, never by structure |
| `infra/staging`, `infra/production` | One folder and one state per environment | A plan on staging can never touch production |
| `clevercloud_postgresql` | `plan = "xxs_sml"`, `encryption = true`, `backup = true` | **Database** card: plan, encryption at rest and backups, as read back from the API |
| `clevercloud_nodejs` | `smallest_flavor`, `biggest_flavor`, `min_instance_count`, `max_instance_count` | **Declared** card, and one tile per instance in **Running now** |
| `dependencies = [clevercloud_postgresql.db.id]` | The link between app and database | Clever Cloud injects `POSTGRESQL_ADDON_URI`; no credential is written in the code |
| `environment = { IAC_… }` | Environment variables | The values in **Declared** come from there |
| `deployment { repository = "file://…" }` | Terraform pushes the repository `HEAD` | No `clever deploy`: a new commit shows up in the next plan as `commit = "…" -> "…"` |
| `tags` | `env:staging`, `managed-by:terraform`, `demo:iac-terraform` | Tags on the app and the add-on, read back in every plan |
| `validation` blocks | Guardrails of the module | `terraform plan` stops on `The dev plan is refused` or on `min_instances` above `max_instances` |
| `output "declared"` | A readable summary in every plan | The provider marks `environment` as sensitive, so the plan shows `(sensitive value)` there; the output shows the size in clear |

Encryption at rest is not a variable: the module sets it on every database. It is chosen when the database is created, so changing it would mean a new database, and the provider says so (`# forces replacement`).

## The demo, step by step

Proof run of 4 November 2026, on staging, region `par`. Outputs are copied from the terminal; `...` marks lines left out.

**1. Plan.** Two resources, nothing hidden except what is secret:

```text
  # module.webapp.clevercloud_nodejs.app will be created
  + resource "clevercloud_nodejs" "app" {
      + app_folder         = "app"
      + biggest_flavor     = "nano"
      + dependencies       = [
          + (known after apply),
        ]
      + environment        = (sensitive value)
      + max_instance_count = 1
      + min_instance_count = 1
      + name               = "blueprint-staging"
      + region             = "par"
      + smallest_flavor    = "nano"
      ...
      + deployment {
          + commit     = (known after apply)
          + repository = "file:///Users/vitio/ClaudeByVitio/demo-iac-terraform"
        }
    }

  # module.webapp.clevercloud_postgresql.db will be created
  + resource "clevercloud_postgresql" "db" {
      + backup           = true
      + encryption       = true
      + name             = "blueprint-staging-db"
      + password         = (sensitive value)
      + plan             = "xxs_sml"
      + region           = "par"
      + uri              = (sensitive value)
      + version          = "18"
      ...
    }

Plan: 2 to add, 0 to change, 0 to destroy.
```

**2. Apply.** `terraform apply tfplan` returns in 5 seconds: the database and the app are created, the repository is pushed. The build and the first start take about a minute and a half. The page says *This is staging*, one instance, `1 alive · 1 declared`, PostgreSQL 18.6, encryption at rest **on**.

**3. Change one thing.** In `infra/staging/main.tf`, `min_instances = 2` and `max_instances = 2`, then `terraform plan`:

```text
  # module.webapp.clevercloud_nodejs.app will be updated in-place
  ~ resource "clevercloud_nodejs" "app" {
      ~ environment        = (sensitive value)
        id                 = "app_2a925ce2-24fa-4cb5-8e2f-c17e6a167850"
      ~ max_instance_count = 1 -> 2
      ~ min_instance_count = 1 -> 2
        name               = "blueprint-staging"
        tags               = [
            "demo:iac-terraform",
            "env:staging",
            "managed-by:terraform",
        ]
        # (10 unchanged attributes hidden)

        # (1 unchanged block hidden)
    }

Plan: 0 to add, 1 to change, 0 to destroy.

Changes to Outputs:
  ~ declared = {
      ~ instances  = "1" -> "2"
        # (3 unchanged attributes hidden)
    }
```

**4. Apply it.** The provider updates the scaling and, since `environment` changed, restarts the app. Clever Cloud starts the new instances before it stops the old one: for about two minutes **Running now** shows both generations, tagged *New deployment* or *Previous deployment*. Then it settles on `2 alive · 2 declared` (screenshots above).

**5. Destroy.**

```text
module.webapp.clevercloud_nodejs.app: Destroying... [id=app_2a925ce2-24fa-4cb5-8e2f-c17e6a167850]
module.webapp.clevercloud_nodejs.app: Destruction complete after 1s
module.webapp.clevercloud_postgresql.db: Destroying... [id=postgresql_572a974d-db05-4953-8bff-bfc0e67ed1c2]
module.webapp.clevercloud_postgresql.db: Destruction complete after 0s
Apply complete! Resources: 0 added, 0 changed, 2 destroyed.
```

`clever applications` and `clever addon` then list nothing named `blueprint-*`, and the app address answers 404.

A code change goes through the same loop: commit it, and the next plan shows `~ deployment { ~ commit = "cbf4ae8…" -> "ad6d6c8…" }` before Terraform pushes it.

`infra/production` was planned during the proof (`Plan: 2 to add`, flavor `nano to XS`), not applied: the loop above is the same in both folders.

### Seen during the proof

- **The first push started no deployment.** After the first `apply`, the app stayed *stopped* for five minutes with its commit recorded and no deployment listed. The next `apply`, which pushed a new commit, deployed it at once. Seen once.
- **One database never started.** The first `xxs_sml` database was `ACTIVE` in the API but its port stayed closed for 25 minutes, with no log. An identical database created with clever-tools at that time answered within a minute, so the provider was not the cause. `terraform apply -replace=module.webapp.clevercloud_postgresql.db` created a new one, reachable 45 seconds later. `/health/deep` tells you in one call (503 until the database answers).
- **A new link alone does not restart the app.** The provider restarts an app when its `environment` changes, not when `dependencies` change, so after a database replacement the app kept the old address. The module now puts the database ID in `environment` (`IAC_DB_ID`): a new database restarts the app by itself.

## Deploy on Clever Cloud

You need [Terraform](https://developer.hashicorp.com/terraform/install) 1.9 or later (tested with 1.16.5), [clever-tools](https://www.clever.cloud/developers/doc/cli/) with `clever login` done, and the ID of the organisation that will own the resources (`orga_…`, shown in the Console). OpenTofu was not tested here.

```bash
git clone https://github.com/Vitiosum/demo-iac-terraform.git
cd demo-iac-terraform/infra/staging            # or infra/production

export CC_ORGANISATION=orga_xxx                # the organisation, not a secret
terraform init
terraform plan -out=tfplan                     # read it: 2 to add
terraform apply tfplan
terraform output url
```

The first `apply` returns within seconds; the app answers about a minute and a half later, once built and started (`/health/deep` returns 200 when the database is reachable). If it stays stopped or the database does not answer, see [Seen during the proof](#seen-during-the-proof). Then make the change of [step 3](#the-demo-step-by-step).

Each folder deploys the repository it sits in (`repo_root = "../.."`, `app_folder = "app"`). From another layout, pass both: `terraform plan -var repo_root=<path to the git root, relative to the folder> -var app_folder=<path of app/ from that root>`.

To remove everything: `terraform destroy` in the same folder.

### Authentication

The provider reads the credentials of `clever login` from the clever-tools configuration file (`~/.config/clever-cloud/clever-tools.json`). Nothing is exported, nothing is written in the code. In a CI pipeline, export `CC_OAUTH_TOKEN` and `CC_OAUTH_SECRET` instead. According to the provider documentation, an API token (`CLEVER_API_TOKEN`, from `clever tokens create`) works for the API calls but cannot sign the git push: an app with a `deployment` block needs the OAuth credentials.

### Terraform state

The state of each environment is a local file, `terraform.tfstate`, next to its `main.tf`, and `.gitignore` excludes it. It holds the database password in clear text (`password` and `uri` are only hidden in the plan output), so it must never be committed. A team would keep it in a remote backend with locking; the provider documentation describes an S3 backend on Cellar, which this demo did not test.

## Variables

Set by Terraform on the app (`environment` map of the module):

| Variable | Role |
|---|---|
| `IAC_ENVIRONMENT` | `staging` or `production`: page title and colour |
| `IAC_SOURCE` | The file that declares the environment |
| `IAC_REGION`, `IAC_SMALLEST_FLAVOR`, `IAC_BIGGEST_FLAVOR`, `IAC_MIN_INSTANCES`, `IAC_MAX_INSTANCES` | The declared size, shown in **Declared** |
| `IAC_DB_PLAN`, `IAC_DB_VERSION` | The declared database |
| `IAC_DB_ENCRYPTION`, `IAC_DB_BACKUP` | Read back from the API by the provider, not copied from the file |
| `IAC_DB_ID` | The add-on ID: a new database changes it, so the provider restarts the app |
| `CC_HEALTH_CHECK_PATH` | `/health` |
| `APP_FOLDER` | `app`, from the `app_folder` attribute |

Injected by Clever Cloud through the link: `POSTGRESQL_ADDON_URI` and the other `POSTGRESQL_ADDON_*` variables. The app reads `POSTGRESQL_ADDON_URI` (or `DATABASE_URL` locally).

The **Running on Clever Cloud** card shows `CC_APP_NAME`, `APP_ID`, `INSTANCE_NUMBER`, `INSTANCE_TYPE`, `CC_PRETTY_INSTANCE_NAME`, `CC_COMMIT_ID` and `CC_DEPLOYMENT_ID`, and nothing else.

## Routes

`/` the page · `/api/state` what the page polls every 3 s (declaration, live instances, database) · `/health` (no database) · `/health/deep` (heartbeat round trip to PostgreSQL, 503 when unreachable).

## Code tour

```
infra/modules/webapp/   the module: main.tf (database, app, link), variables.tf (guardrails), outputs.tf
infra/staging/          main.tf: provider, module call with the staging size, outputs; .terraform.lock.hcl
infra/production/       same file, production size
app/server.js           Node.js server, no framework: routes, heartbeat into PostgreSQL, clean exit on SIGTERM
app/public/             index.html, app.js (rendering, polling), app.css; cc-brand.css and cc-logo.svg from the Clever Brand Kit
app/test/               smoke test: npm test starts the real server and calls every route, without a database
```

Node.js 24, one dependency (`pg`).

## Run locally

```bash
cd app && npm install
IAC_ENVIRONMENT=staging IAC_MIN_INSTANCES=1 IAC_MAX_INSTANCES=2 PORT=8080 npm start   # without a database
DATABASE_URL=postgres://user@localhost:5432/blueprint npm start                    # with one
npm test
```

MIT License.
