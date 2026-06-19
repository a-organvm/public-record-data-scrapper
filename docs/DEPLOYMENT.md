# Deployment

This guide covers shipping the **UCC-MCA Intelligence API** (the Express server
+ BullMQ worker + PostgreSQL + Redis). The React frontend (`apps/web`) is a
static SPA that deploys separately to a CDN/static host (Vercel or Cloudflare
Pages); it talks to this API over HTTPS.

| Target | Best for | Effort |
| --- | --- | --- |
| **One-command Docker stack** | self-hosting, VPS, staging, demos | `npm run deploy` |
| **Render Blueprint** | managed cloud, zero-ops Postgres/Redis | push + 1 click |
| **GHCR image** | Kubernetes / ECS / any container host | pull & run |
| **AWS (Terraform)** | full production infra (VPC/RDS/ElastiCache) | `terraform apply` |
| **Cloudflare Worker** | the edge/strangler component (`cloudflare/`) | auto on push |

---

## 🚀 One-command deploy (self-hosted Docker)

The fastest path to a running stack. Requires only **Docker** + **Docker Compose**.

```bash
cp .env.example .env          # then set JWT_SECRET and POSTGRES_PASSWORD
npm run deploy                # build → migrate → start → health-check
```

That single command (`scripts/deploy.sh`, wired to `docker-compose.prod.yml`):

1. Verifies Docker is installed and running.
2. Ensures `.env` exists and the required secrets (`JWT_SECRET`,
   `POSTGRES_PASSWORD`) are set — it refuses to boot with insecure defaults.
3. Builds the application image from the multi-stage `Dockerfile`.
4. Runs database migrations as a one-shot step that **must** succeed before the
   API and worker start (no booting against an unmigrated schema).
5. Starts the API, worker, PostgreSQL, and Redis, then polls
   `http://localhost:3000/api/health` until healthy.

When it finishes you'll have:

| Service | URL |
| --- | --- |
| API | `http://localhost:3000` |
| Health | `http://localhost:3000/api/health` |
| API docs (Swagger) | `http://localhost:3000/api/docs` |

### Useful variants

```bash
npm run deploy                              # build + deploy (default)
bash scripts/deploy.sh --no-build           # redeploy without rebuilding
bash scripts/deploy.sh --image ghcr.io/<owner>/public-record-data-scrapper:latest
                                            # deploy a prebuilt image (no build)
bash scripts/deploy.sh --logs               # deploy, then tail logs
npm run deploy:down                         # stop the stack (keeps data volumes)
```

Override the host port or image with env vars (or in `.env`):

```bash
PORT=8080 APP_IMAGE=ucc-mca:rc1 npm run deploy
```

> The named volumes `postgres-data` and `redis-data` persist across
> `--down`/redeploys. To wipe data, remove them with `docker volume rm`.

---

## ⚙️ CI: automatic image publishing (GHCR)

`.github/workflows/deploy.yml` builds and publishes the runtime image to the
GitHub Container Registry. It needs **no external secrets** — it authenticates
with the built-in `GITHUB_TOKEN`.

| Trigger | Result |
| --- | --- |
| push to `main` | publishes `:latest` and `:main-<sha>` |
| push tag `v*` | publishes `:1.2.3`, `:1.2`, `:1` (semver) |
| pull request | builds only (validates the Dockerfile; no push) |
| manual dispatch | builds/publishes on demand |

Pull and run any published image with the one-command flow:

```bash
docker pull ghcr.io/<owner>/public-record-data-scrapper:latest
bash scripts/deploy.sh --image ghcr.io/<owner>/public-record-data-scrapper:latest
```

The build uses GitHub Actions layer caching, so repeat builds are fast.

---

## ☁️ Render (managed cloud, Blueprint)

`render.yaml` is a [Render Blueprint](https://render.com/docs/blueprint-spec)
that provisions everything in one shot: the **API web service**, the **worker**,
a managed **PostgreSQL** database, and a **Redis** instance.

1. Push this repo to GitHub.
2. In Render: **New +** → **Blueprint** → select the repo.
3. Render reads `render.yaml`, builds the `Dockerfile`, and wires
   `DATABASE_URL`, `REDIS_URL`, and a generated `JWT_SECRET` automatically.
4. Set `CORS_ORIGIN` (the only `sync: false` var) to your frontend's origin.

Migrations run automatically via the web service's `preDeployCommand`
(`npm run db:migrate`) before each release receives traffic. Health checks hit
`/api/health`. Bump the `free`/`starter` plans for production durability.

---

## 📦 Any container host (Kubernetes, ECS, Fly, …)

The published GHCR image is portable. Provide these environment variables and
run the two commands the image expects:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | `postgresql://user:pass@host:5432/ucc_mca` |
| `REDIS_URL` | ✅ | `redis://host:6379` |
| `JWT_SECRET` | ✅ | strong random secret |
| `CORS_ORIGIN` | ✅ | your frontend origin(s), comma-separated |
| `PORT` / `HOST` | – | default `3000` / `0.0.0.0` |
| `LOG_LEVEL` | – | default `info` |

```bash
# API server (default entrypoint)
docker run -p 3000:3000 --env-file .env ghcr.io/<owner>/public-record-data-scrapper:latest

# Worker (same image, different command)
docker run --env-file .env ghcr.io/<owner>/public-record-data-scrapper:latest node dist/worker.cjs

# Migrations (run once per release, before the API starts)
docker run --env-file .env ghcr.io/<owner>/public-record-data-scrapper:latest npm run db:migrate
```

Kubernetes manifests live in [`k8s/`](../k8s/).

---

## 🏗️ AWS (Terraform)

`terraform/` provisions the full production footprint — VPC with multi-AZ
subnets, encrypted RDS PostgreSQL, encrypted ElastiCache Redis, S3 with
lifecycle policies, and CloudWatch + SNS alerting.

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # configure
terraform init && terraform plan                # review
terraform apply                                 # provision
```

Then deploy the GHCR image to your compute (ECS/EKS/EC2) pointing
`DATABASE_URL`/`REDIS_URL` at the provisioned RDS/ElastiCache endpoints.

---

## 🌐 Frontend (Vercel / Cloudflare Pages)

The SPA in `apps/web` builds with `npm run build` (config in `vercel.json`) and
deploys to Vercel automatically on push to `main`. Point its API base URL
(`VITE_API_BASE_URL`) at the deployed API origin and add that origin to the
API's `CORS_ORIGIN`.

The `cloudflare/` directory holds an independent edge Worker (strangler
pattern) with its own deploy workflow (`.github/workflows/deploy-cloudflare.yml`).

---

## Health & verification

After any deploy, confirm the API is live:

```bash
curl -fsS https://<your-host>/api/health | jq .
```

A healthy response returns HTTP 200 with database and Redis connectivity status.
The container's `HEALTHCHECK` and the compose/Render health checks all probe the
same `/api/health` endpoint.
