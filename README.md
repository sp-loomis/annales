# Sheaf

A worldbuilding platform built around **notebook entries** with attached
artifacts — documents, images, Excalidraw sketches, date ranges, and map
geometries — connected by a typed relation graph.

Backend: TypeScript + Fastify + Prisma + Postgres, with S3-backed file storage
(LocalStack in dev). All creative payload lives in files; the database holds
only metadata and derived/cached fields.

## Status

- ✅ Backend API — implemented, 105/105 contract tests green
- 🔜 React frontend — see [docs/ROADMAP.md](docs/ROADMAP.md)
- 🔜 Deploy (Terraform) — see [docs/ROADMAP.md](docs/ROADMAP.md)

## Quickstart

```sh
podman machine start          # once per boot (docker here is a podman shim)
npm run compose:up            # postgres :5433 + LocalStack S3 :4566
npm install --cache /tmp/npm-cache-sheaf   # see GUIDE.md → Troubleshooting
npx prisma migrate deploy && npx prisma generate
docker exec sheaf_localstack_1 awslocal s3 mb s3://sheaf-dev   # first time only
cp .env.example .env
npm run dev                   # API on http://localhost:3000
```

Then either run the guided tour:

```sh
./scripts/demo.sh             # seeds a demo world end-to-end via the API
```

or poke it by hand — `requests.http` has every endpoint ready to fire from
VS Code (REST Client extension) / IntelliJ.

```sh
npm test                      # contract suite (needs containers up)
```

## Documentation

| Doc | What's in it |
|---|---|
| [docs/STACK.md](docs/STACK.md) | Stack choices, data model, indexing strategy — the original design cheat sheet |
| [docs/API.md](docs/API.md) | The API contract: every endpoint, error taxonomy, artifact lifecycle, calendar/tick semantics |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the repo is organized: request lifecycle, the artifact lifecycle engine, raw-SQL islands, two-stage search, testing approach |
| [docs/GUIDE.md](docs/GUIDE.md) | Running it: setup, curl walkthrough, inspecting the live S3 bucket and database, troubleshooting |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Next steps: frontend plan, deploy plan, known gaps |
