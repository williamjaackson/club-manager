#!/usr/bin/env bash
# One-shot VPS hardening for club-manager deploys.
#
# Creates a dedicated `deploy` user on the VPS, installs a fresh ed25519 key,
# grants it docker + /opt/club-manager access, verifies it can deploy, then
# rotates the GitHub Actions secrets so deploy.yml stops using root:
#   VPS_SSH_KEY     -> new private key (deploy user)
#   VPS_SSH_USER    -> deploy
#   VPS_KNOWN_HOSTS -> pinned host key (enables StrictHostKeyChecking=yes)
#
# Root SSH access is not modified; this only stops CI from using it.
# You will be prompted for the root password once by ssh.
#
# Usage: ./scripts/setup-deploy-user.sh [host]

set -euo pipefail

HOST="${1:-72.61.210.78}"
REPO="williamjaackson/club-manager"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 1; }

echo "==> Generating deploy key"
ssh-keygen -t ed25519 -f "$WORKDIR/deploy_key" -N "" -C "club-manager-deploy" -q
PUBKEY="$(cat "$WORKDIR/deploy_key.pub")"

echo "==> Pinning host key for $HOST"
ssh-keyscan -t ed25519 "$HOST" > "$WORKDIR/known_hosts" 2>/dev/null
[ -s "$WORKDIR/known_hosts" ] || { echo "ssh-keyscan returned nothing" >&2; exit 1; }

echo "==> Creating deploy user on $HOST (enter the root password when asked)"
ssh -o UserKnownHostsFile="$WORKDIR/known_hosts" -o StrictHostKeyChecking=yes \
  "root@$HOST" /bin/bash -s << EOF
set -e
id -u deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf '%s\n' '$PUBKEY' > /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
getent group docker >/dev/null && usermod -aG docker deploy
chown -R deploy:deploy /opt/club-manager
su - deploy -c 'git config --global --add safe.directory /opt/club-manager' || true
echo REMOTE-SETUP-OK
EOF

echo "==> Verifying deploy user can reach the repo and docker"
ssh -o UserKnownHostsFile="$WORKDIR/known_hosts" -o StrictHostKeyChecking=yes \
  -i "$WORKDIR/deploy_key" "deploy@$HOST" \
  'cd /opt/club-manager && git rev-parse --short HEAD && docker compose ps >/dev/null && echo DEPLOY-USER-OK'

echo "==> Rotating GitHub Actions secrets on $REPO"
gh secret set VPS_SSH_KEY --repo "$REPO" < "$WORKDIR/deploy_key"
gh secret set VPS_KNOWN_HOSTS --repo "$REPO" < "$WORKDIR/known_hosts"
gh secret set VPS_SSH_USER --repo "$REPO" --body "deploy"

echo "==> Done. CI now deploys as 'deploy' with a pinned host key."
echo "    Root SSH access was not modified."
