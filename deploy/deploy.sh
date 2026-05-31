#!/usr/bin/env bash
# Deploy Multispire to the game server.
#
# Usage:   ./deploy/deploy.sh
# Override:  SERVER=root@host PORT=8090 ./deploy/deploy.sh
#
# What it does:
#   1. rsyncs the source tree to the server (skips node_modules / dist / .git)
#   2. installs Node 20 if missing
#   3. npm install + npm run build (bundles server, builds client)
#   4. installs/refreshes a systemd service and restarts it
#
# The server listens on $PORT and serves BOTH the website and the WebSocket
# on that single port (http://HOST:PORT  and  ws://HOST:PORT/ws).
set -euo pipefail

SERVER="${SERVER:-root@206.189.177.24}"
APP_DIR="${APP_DIR:-/opt/multispire}"
PORT="${PORT:-8090}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Deploying $ROOT  ->  $SERVER:$APP_DIR  (port $PORT)"

# 1. Sync source.
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '*.log' \
  "$ROOT/" "$SERVER:$APP_DIR/"

# 2-4. Build + run on the server.
ssh "$SERVER" "APP_DIR='$APP_DIR' PORT='$PORT' bash -s" <<'REMOTE'
set -euo pipefail
cd "$APP_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node 20 from official tarball (apt mirrors unreliable on this image)"
  NODE_VER=v20.18.1
  curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.gz" -o /tmp/node.tar.gz
  tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.gz
fi
NODE_BIN="$(command -v node)"
echo "==> Node $(node -v) at $NODE_BIN"

echo "==> Installing dependencies"
npm install --no-audit --no-fund

echo "==> Building"
npm run build

echo "==> Installing systemd service"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__PORT__|$PORT|g" -e "s|__NODE__|$NODE_BIN|g" \
  deploy/multispire.service > /etc/systemd/system/multispire.service
systemctl daemon-reload
systemctl enable multispire >/dev/null 2>&1 || true
systemctl restart multispire

sleep 2
echo "==> Service status:"
systemctl --no-pager --full status multispire | head -12 || true
echo "==> Health check:"
curl -fsS "http://localhost:$PORT/healthz" && echo " OK" || echo " (health check failed — check: journalctl -u multispire -n 50)"
REMOTE

echo ""
echo "==> Done. Open: http://${SERVER#*@}:$PORT"
