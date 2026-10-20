# VPS setup and deploys

How the one VPS that runs troba is set up by hand, and how a deploy works. The design is in [SPEC-platform.md](../../SPEC-platform.md) (P5, P7) and [ADR-0008](../adr/0008-vps-docker-compose-caddy.md). Commands assume Ubuntu 24.04 LTS; another Debian-family release works the same way.

Placeholders: `<vps>` is the server's IP address, `<domain>` the domain, `<sha>` a full 40-character commit sha on `main`. Nothing real goes into this file or the repo: the domain, IP, emails and secrets live only on the VPS.

## What runs where

Three Compose projects on one Docker host:

| Project | From | Env file | Publishes |
|---|---|---|---|
| `edge` | [deploy/edge/](../../deploy/edge/) | `/srv/troba/edge/.env` | 80, 443 |
| `troba-staging` | [deploy/app/compose.yaml](../../deploy/app/compose.yaml) | `/srv/troba/staging/.env` | nothing |
| `troba-prod` | the same file | `/srv/troba/prod/.env` | nothing |

Caddy reaches each environment's web container as `staging-web` / `prod-web` on the shared `edge` network. Postgres sits only on its own project's network. Each environment has its own database, `postgres-data` and `uploads` volumes, secrets and users.

The app runs as `node` (uid 1000) and writes users' files to `/data/uploads`. The `uploads` named volume is seeded from the image's `/data/uploads`, which is owned by `node`, so it needs no `chown`. If it is ever replaced by a bind mount of a host folder, that folder must be owned by uid 1000.

```
/srv/troba/
  deploy/            a copy of this repo's deploy/ folder
  edge/.env          DOMAIN, ACME_EMAIL
  staging/.env       mode 600
  staging/deployed-sha   written by deploy.sh: the last healthy sha
  prod/.env          mode 600
  prod/deployed-sha
```

## 1. Before you start

- A VPS with a public IPv4 address (IPv6 is fine too), root or sudo access, and your SSH public key installed for that account.
- DNS: `A` (and `AAAA` if the VPS has IPv6) records for `<domain>` and `staging.<domain>` pointing at the VPS. Caddy can only get certificates once these resolve.

## 2. Deploy user and SSH

As root (or with sudo):

```bash
apt update && apt full-upgrade -y
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
passwd deploy   # a sudo password; SSH login stays key-only
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
```

Key-only login, no root login:

```bash
cat > /etc/ssh/sshd_config.d/10-troba.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sshd -t && systemctl reload ssh
```

**Before closing the root session**, open a second terminal and check `ssh deploy@<vps>` works and `sudo -v` accepts the password. Then `ssh root@<vps>` and a password login (`ssh -o PubkeyAuthentication=no deploy@<vps>`) must both be refused.

Later, the GitHub deploy job (T8) gets its own key in `/home/deploy/.ssh/authorized_keys`; its private key is the only deploy secret GitHub holds.

## 3. Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

**Docker bypasses ufw for published ports**: a `ports:` entry in any compose file is reachable from the internet whatever ufw says. That is why only Caddy publishes anything, Postgres has no `ports:`, and the `nmap` check in [Verification](#7-verification) scans from outside.

## 4. Unattended security updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # answer Yes
cat /etc/apt/apt.conf.d/20auto-upgrades           # both lines should be "1"
sudo unattended-upgrade --dry-run --debug 2>&1 | tail -5
```

Kernel updates need a reboot. Either reboot by hand when `/var/run/reboot-required` exists, or set `Unattended-Upgrade::Automatic-Reboot "true";` and a quiet `Automatic-Reboot-Time` in `/etc/apt/apt.conf.d/50unattended-upgrades`. Every container has `restart: unless-stopped`, so the stack comes back after a reboot.

## 5. Docker

Install Docker Engine and the Compose plugin from Docker's apt repository, following [the official guide](https://docs.docker.com/engine/install/ubuntu/), not the distribution's `docker.io` package. Then:

```bash
sudo usermod -aG docker deploy   # log out and back in for it to apply
docker compose version
```

Membership of `docker` is root-equivalent; only `deploy` gets it.

Cap container logs, or they grow until the disk is full:

```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{ "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
sudo systemctl restart docker
```

The image `ghcr.io/<owner>/troba-web` must be pullable from the VPS. Either make the package public (GitHub → Packages → troba-web → Package settings → Change visibility; the repo is public anyway), or log in once with a classic token that has only `read:packages`: `docker login ghcr.io -u <github user>`.

## 6. troba

As `deploy`. The deploy files come from this repo, copied from a checkout of `main` on your machine:

```bash
sudo install -d -o deploy -g deploy -m 755 /srv/troba
# on your machine, from the repo root:
scp -r deploy deploy@<vps>:/srv/troba/
# back on the VPS:
chmod +x /srv/troba/deploy/*.sh
```

Copy it again whenever `deploy/` changes on `main`. Until a deploy copies it itself, the VPS runs whichever `deploy/` was copied last, whatever sha it deploys.

### The edge

```bash
docker network create --ipv6 edge
install -d -m 700 /srv/troba/edge
(umask 077; cat > /srv/troba/edge/.env <<'EOF'
DOMAIN=<domain>
ACME_EMAIL=<an address that gets certificate expiry warnings>
EOF
)
docker compose -p edge -f /srv/troba/deploy/edge/compose.yaml --env-file /srv/troba/edge/.env up -d
docker compose -p edge -f /srv/troba/deploy/edge/compose.yaml --env-file /srv/troba/edge/.env logs -f
```

The log shows `certificate obtained successfully` for both names once DNS resolves. Until an environment runs, its name answers 502.

The network needs `--ipv6` when the VPS has IPv6. Without it, Docker relays IPv6 connections through a proxy that replaces the client's address with the network gateway's (`172.x.0.1`). Caddy's `X-Forwarded-For`, and so sign-in rate limiting, would then lump every IPv6 visitor into one address. To check: `curl -6 https://staging.<domain>/` from the VPS, then the last log line's `remote_ip` is the VPS's own IPv6 address. An existing network can't be switched: stop the edge, `docker network rm edge`, create it again with `--ipv6` before any environment is attached, and start the edge again.

### An environment

For `<env>` = `staging`, then later `prod`. Secrets are hex so they need no escaping inside the database URL.

```bash
install -d -m 700 /srv/troba/<env>
(umask 077; cat > /srv/troba/<env>/.env <<EOF
TROBA_ENV=<env>
TROBA_IMAGE=ghcr.io/<owner>/troba-web
POSTGRES_PASSWORD=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=https://staging.<domain>
EOF
)
ls -l /srv/troba/<env>/.env   # -rw------- deploy deploy
```

For prod, `BETTER_AUTH_URL=https://<domain>`. Never copy staging's secrets to prod.

`POSTGRES_PASSWORD` is set when the database volume is first created. Changing it later in `.env` doesn't change the database's password; do that with `ALTER USER` in `psql` first.

### Deploy

```bash
/srv/troba/deploy/deploy.sh <env> <sha>
```

[deploy.sh](../../deploy/deploy.sh) does, in order:

1. pulls `ghcr.io/<owner>/troba-web:<sha>` (skipped when the image is already on the VPS);
2. starts Postgres and waits for it to be healthy;
3. runs migrations with the new image (`docker compose run --rm migrate`);
4. starts the new web container;
5. waits up to 2 minutes, with [wait-healthy.sh](../../deploy/wait-healthy.sh), for `/api/health` inside the container to answer `"status":"ok"` with `"version":"<sha>"`, printing what it sees every 10 seconds;
6. on success, writes `<sha>` to `/srv/troba/<env>/deployed-sha`; on failure, prints the web log, starts the sha from `deployed-sha` again, waits for it to be healthy, and exits 1.

Once the new web container has started, being interrupted also rolls back: Ctrl+C does it in the terminal (a second Ctrl+C stops the rollback), and a lost SSH session or a cancelled CI job does it with the output going to `/srv/troba/<env>/deploy.log`.

If steps 1–3 fail, web was never touched and the script exits non-zero without a rollback. A rollback only swaps the web image, so migrations must keep working with the previous release ([ADR-0008](../adr/0008-vps-docker-compose-caddy.md)). The very first deploy has nothing to roll back to.

Only one deploy per environment runs at a time (`/srv/troba/<env>/.deploy.lock`). If a deploy was killed and left the lock behind, check nothing is running (`ps aux | grep deploy.sh`), then `rmdir /srv/troba/<env>/.deploy.lock`.

Going back to an older release by hand is just `deploy.sh <env> <older sha>`, as long as the current database schema still works with it.

### Everyday commands

The compose command for an environment is long and needs the running sha. This function (put it in `~/.bashrc`) supplies both:

```bash
c() { TROBA_SHA=$(cat "/srv/troba/$1/deployed-sha") docker compose -p "troba-$1" -f /srv/troba/deploy/app/compose.yaml --env-file "/srv/troba/$1/.env" "${@:2}"; }
c staging ps
c staging logs -f web
c staging exec postgres psql -U troba troba
```

The first admin, after an environment's first deploy (it prompts for the password):

```bash
c <env> exec -it web node scripts/create-admin.js <email>
```

Old images pile up with every deploy. Remove those unused for a week: `docker image prune -a --filter until=168h`.

Off-VPS backups (nightly `pg_dump` and the `uploads` volume) are not set up yet; they are a gate before real data goes to prod ([ADR-0008](../adr/0008-vps-docker-compose-caddy.md)).

## 7. Verification

Run these once the VPS exists, and again after changing the firewall, Docker or `deploy/`. Record the date and result under [Results](#results).

**A known sha on staging.** Pick the newest sha on `main` whose image is in GHCR (the Deliver workflow's `image` job built it), and:

```bash
/srv/troba/deploy/deploy.sh staging <sha>
curl -s https://staging.<domain>/api/health   # {"status":"ok","version":"<sha>","db":"ok"}
```

**A broken image rolls back.** With a healthy deploy in place, build an image that exits on start, tagged with a sha that isn't real, and deploy it. Its migrations are the good image's, so only the health check fails.

```bash
good=$(cat /srv/troba/staging/deployed-sha)
image=ghcr.io/<owner>/troba-web
broken=$(printf 'b%.0s' {1..40})
printf 'FROM %s:%s\nENV GIT_SHA=%s\nCMD ["node", "-e", "process.exit(1)"]\n' "$image" "$good" "$broken" \
  | docker build -t "$image:$broken" -
/srv/troba/deploy/deploy.sh staging "$broken"; echo "exit $?"
cat /srv/troba/staging/deployed-sha   # still $good
curl -s https://staging.<domain>/api/health   # version is still $good
docker rmi "$image:$broken"
```

Expected: a progress line every 10 seconds (`web keeps exiting and restarting`), then after 2 minutes `failed its health check`, `rolled staging back to <good>`, exit 1. Let it run: Ctrl+C would also roll back, but then it tests the interruption path instead of the health check.

**Only 22, 80 and 443 are open.** From another machine, not the VPS:

```bash
nmap -Pn -p- <vps>
nmap -Pn -6 -p- <vps ipv6>   # if the VPS has IPv6
```

Expected: `22/tcp`, `80/tcp` and `443/tcp` open, everything else closed or filtered.

### Results

| Date | Check | Result |
|---|---|---|
| 2026-10-20 | deploy, rollback and Caddy routing, rehearsed on a local Docker host with a local registry and test images (no VPS yet) | first deploy, a second deploy, and a broken image rolled back to the previous sha after the 2-minute timeout, after Ctrl+C and after a SIGHUP (output in `deploy.log`); Caddy served staging over HTTPS, redirected HTTP, answered 502 for the absent prod; no container port published except Caddy's |
| 2026-10-20 | known sha on staging (VPS) | first deploy of `c8d7f80` passed; staging `/api/health` over HTTPS reported that sha with `db: ok` |
| 2026-10-20 | broken image rolled back (VPS) | passed: progress every 10 s, gave up after 120 s, rolled back to `c8d7f80`, exit 1, staging healthy. An earlier attempt stopped with Ctrl+C left the broken image running; deploy.sh now rolls back on interruption too |
| 2026-10-20 | `nmap -Pn -p-` from outside, IPv4 | passed: 22, 80 and 443 open, the other 65532 ports filtered |
| | `nmap -6` from outside, IPv6 | not run yet: the owner's connection has no IPv6 route. ufw shows the same 22/80/443 rules for v6 and only Caddy publishes ports; scan from an IPv6 network (e.g. a phone hotspot) to close this |
| 2026-10-20 | Caddy over IPv6 (VPS) | the edge network was first created without `--ipv6`, and IPv6 clients reached the app as the gateway address; recreated with `--ipv6`, real addresses arrive |
