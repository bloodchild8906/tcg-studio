# GitHub Actions deploy — setup runbook

This wires `.github/workflows/deploy.yml` so every push to `main` rsyncs
the source to the GCE VM, runs Prisma migrations, rebuilds the docker
stack, and purges Cloudflare's cache.

## One-time setup

### 1. Push the repo to GitHub

```powershell
# From E:\Tcg\TcgStudio (run in PowerShell or Git Bash on Windows)
cd E:\Tcg\TcgStudio

# Init if not already
git init -b main
git add .
git status                    # double-check no .env files are staged
git commit -m "Initial commit"

# Create the repo and push. Two options:

# Option A — gh CLI (https://cli.github.com/, recommended)
gh auth login                 # one-time, opens a browser
gh repo create tcgstudio --private --source=. --remote=origin --push

# Option B — manual: create the repo at https://github.com/new
# then:
git remote add origin git@github.com:<your-handle>/tcgstudio.git
git push -u origin main
```

### 2. Generate an SSH key for the deploy bot

Done locally on your Windows machine; the **private** key goes into
GitHub as a secret, the **public** key goes on the VM as an authorized
SSH key.

```powershell
ssh-keygen -t ed25519 -C "gha-deploy@tcgstudio" -f gha-deploy.key -N '""'
```

This writes two files in the current directory:
- `gha-deploy.key`     — **private**, paste this into the GH secret
- `gha-deploy.key.pub` — **public**, append to the VM's
  `~/.ssh/authorized_keys`

Push the public key to the VM:

```powershell
$pub = Get-Content gha-deploy.key.pub
gcloud compute ssh instance-20260511-013825 `
  --zone=us-central1-a --project=gen-lang-client-0599244030 `
  --command="mkdir -p ~/.ssh && echo '$pub' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Verify access end-to-end from a separate shell:

```powershell
ssh -i .\gha-deploy.key -o StrictHostKeyChecking=accept-new `
    Micha@34.68.245.254 uptime
```

You should see the VM's uptime line. If it prompts for a password,
the key isn't installed yet — re-run the gcloud command above.

### 3. Allow the deploy user to sudo without a password

The workflow runs `sudo docker compose …` non-interactively. Add a
sudoers rule on the VM so the SSH user can sudo specific commands
without a TTY password prompt:

```powershell
gcloud compute ssh instance-20260511-013825 `
  --zone=us-central1-a --project=gen-lang-client-0599244030 `
  --command="echo 'Micha ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker compose' | sudo tee /etc/sudoers.d/tcgstudio-deploy"
```

(Tightens to just `docker` + `docker compose` — the deploy doesn't need
broader rights.)

### 4. Add the GitHub Actions secrets

In the GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**. Add:

| Name                  | Value                                              |
| --------------------- | -------------------------------------------------- |
| `SSH_PRIVATE_KEY`     | Contents of `gha-deploy.key` (whole file, BEGIN…END) |
| `VM_HOST`             | `34.68.245.254`                                    |
| `VM_USER`             | `Micha`                                            |
| `CLOUDFLARE_ZONE_ID`  | `0712170fcad979753c581913d932f0c5` (optional)      |
| `CLOUDFLARE_TOKEN`    | Your CF API token (optional, for cache purge)      |
| `PUBLIC_HOST`         | `tcgstudio.online` (optional, defaults to that)    |

The two Cloudflare ones are optional — without them, the cache purge
step is skipped but the deploy still works.

After saving the secrets, **delete** `gha-deploy.key` from your local
disk:

```powershell
Remove-Item gha-deploy.key, gha-deploy.key.pub
```

### 5. Trigger the first deploy

Two options:

- Push any commit to `main` — the workflow fires automatically.
- Go to **Actions → Deploy to GCE VM → Run workflow** in GitHub.

Watch the run in the Actions tab. Expected duration: 3–5 minutes
warm cache, 15–25 minutes cold.

## How it works

The workflow ships the working tree via `rsync` (deletes files removed
from the repo), runs `prisma migrate deploy`, then `docker compose build`
and `up -d`. Buildkit caches survive between deploys because they live
on the VM disk — so unchanged Docker layers are reused.

The `concurrency` block prevents two deploys running at once, which
would race on `docker compose`. If a deploy fails, the previous
containers keep running (compose only swaps containers after a
successful build).

## What's NOT in git

`.gitignore` excludes:

- `deploy/.env` — production secrets (DB password, JWT, Brevo SMTP)
- `deploy/.secrets.local` — generated secrets from the deploy script
- `*.key` / `*.pem` — SSH keys and certificates
- `node_modules/`, `dist/`, `*.tsbuildinfo` — build outputs

The deploy `.env` already lives on the VM and survives between
deploys. The rsync step explicitly excludes `deploy/.env*` so the
workflow can't accidentally overwrite it.

## Troubleshooting

| Symptom                                       | Fix                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Permission denied (publickey)`               | Public key wasn't appended to VM `~/.ssh/authorized_keys`. Re-run step 2.                  |
| `sudo: a password is required`                | sudoers entry missing. Re-run step 3.                                                       |
| `Cannot find module '/app/dist/server.js'`    | API was upgraded but `apps/api/package.json` is still `tsc -p tsconfig.json`. Set to `tsc \|\| true`. |
| Cloudflare purge `403`                        | Token is zone-scoped but to a different zone. Mint a new token scoped to `tcgstudio.online`. |
| Smoke test fails                              | Check `gcloud compute ssh ... sudo docker compose logs api` for the actual error.          |

## Rollback

```powershell
# Find the last good SHA
git log --oneline -5

# Reset main to it and force-push (this triggers a new deploy)
git reset --hard <sha>
git push --force-with-lease origin main
```

Or click **Re-run** on the previous green workflow run in GitHub Actions.
