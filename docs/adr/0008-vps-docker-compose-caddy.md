---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# One VPS with Docker Compose and Caddy

## Context and Problem Statement

troba is self-hosted on the owner's VPS with a staging and a production environment. How are they hosted, routed and deployed? ([stack-options §10](../ideas/stack-options.md#10-hosting-and-deploy), [SPEC-platform.md](../../SPEC-platform.md))

## Decision Drivers

- Free and self-hosted; one small VPS
- Staging and prod isolated from each other
- Automatic HTTPS with little configuration
- The pipeline should be visible and learnable, not hidden by a PaaS

## Considered Options

- Docker Compose + Caddy
- Docker Compose + Traefik
- Docker Compose + Nginx
- Coolify / Dokploy
- k3s

## Decision Outcome

Chosen option: "Docker Compose + Caddy", because Caddy gives automatic HTTPS in a few lines per subdomain and Compose is the simplest way to run the stack.

- An **edge** Compose project runs Caddy and is the only thing publishing ports (80, 443).
- **troba-staging** and **troba-prod** are separate Compose projects from the same `compose.yaml`, each with its own database, volumes, secrets and env file.
- GitHub Actions deploys over SSH by pulling an image from GHCR, running migrations, starting the new container and checking `/api/health`, with rollback to the previous image on failure.

### Consequences

- Good, because the whole deploy path is a few readable files in the repo.
- Good, because staging failures can't touch prod data.
- Bad, because a single VPS is a single point of failure. Off-VPS backups (nightly `pg_dump` and receipt files) are a gate before real data goes to prod.
- Bad, because rollback only swaps the web image, so migrations must stay backward-compatible with the previous release.

### Confirmation

The deploy tasks verify that only 80 and 443 are open (`nmap`) and that a failed health check rolls back.

## Pros and Cons of the Options

### Traefik

- Good, because label-based routing.
- Bad, because more moving parts than Caddy for the same result.

### Nginx

- Bad, because certificates are managed manually.

### Coolify / Dokploy

- Good, because fast to set up and free.
- Bad, because it hides the pipeline we want to learn.

### k3s

- Good, because Kubernetes experience.
- Bad, because overkill here. Possible later as a learning exercise.
