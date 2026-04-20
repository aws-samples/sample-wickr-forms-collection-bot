#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# bot/scripts/start-bot.sh
# Entrypoint for Wickr IO bot containers (ECS Fargate or standalone Docker).
#
# Supports two credential modes:
#   Mode 1 (ECS/Secrets Manager): Set CREDENTIALS_ARN env var
#   Mode 2 (Direct env vars):     Set BOT_USERNAME and BOT_PASSWORD env vars
#
# CRITICAL: WPM does not reliably start node in -notty mode. This script
# kills any WPM-started node processes, then starts node manually so that
# only ONE node process exists. Two node processes cause messages to split
# between them, breaking the in-memory pending confirmation state.

set -euo pipefail

# --- Node.js version ---
NODE_VERSION="${NODE_VERSION:-20.20.1}"
export PATH="/usr/local/nvm/versions/node/v${NODE_VERSION}/bin:${PATH}"
echo "[start-bot] Node.js: $(node --version 2>/dev/null || echo 'NOT FOUND at v'${NODE_VERSION})"

INTEGRATION_NAME="${INTEGRATION_NAME:-wickr-form-collection-bot}"
echo "[start-bot] INTEGRATION_NAME=${INTEGRATION_NAME}"

# --- Resolve credentials ---
if [ -n "${CREDENTIALS_ARN:-}" ]; then
  echo "[start-bot] Mode: Secrets Manager (CREDENTIALS_ARN)"
  echo "[start-bot] CREDENTIALS_ARN=${CREDENTIALS_ARN}"

  echo "[start-bot] Retrieving credentials from Secrets Manager..."
  if ! CREDS=$(aws secretsmanager get-secret-value \
    --secret-id "$CREDENTIALS_ARN" \
    --query SecretString \
    --output text); then
    echo "[start-bot] ERROR: Failed to retrieve credentials from Secrets Manager"
    exit 1
  fi

  WICKR_BOT_USERNAME=$(echo "$CREDS" | jq -r '.username')
  WICKR_BOT_PASSWORD=$(echo "$CREDS" | jq -r '.password')

elif [ -n "${BOT_USERNAME:-}" ] && [ -n "${BOT_PASSWORD:-}" ]; then
  echo "[start-bot] Mode: Direct environment variables"
  WICKR_BOT_USERNAME="${BOT_USERNAME}"
  WICKR_BOT_PASSWORD="${BOT_PASSWORD}"

else
  echo "[start-bot] ERROR: Provide either CREDENTIALS_ARN or (BOT_USERNAME + BOT_PASSWORD)"
  exit 1
fi

if [ -z "$WICKR_BOT_USERNAME" ] || [ "$WICKR_BOT_USERNAME" = "null" ]; then
  echo "[start-bot] ERROR: Username is empty or null"
  exit 1
fi

export BOT_USERNAME="${WICKR_BOT_USERNAME}"
echo "[start-bot] Bot username: ${WICKR_BOT_USERNAME}"

# --- Write clientConfig.json ---
echo "[start-bot] Writing clientConfig.json..."
cat > /usr/local/wickr/WickrIO/clientConfig.json <<CLIENTCONFIG
{
  "clients": [
    {
      "name": "${WICKR_BOT_USERNAME}",
      "password": "${WICKR_BOT_PASSWORD}",
      "integration": "${INTEGRATION_NAME}",
      "tokens": [
        { "name": "CLIENT_NAME", "value": "${WICKR_BOT_USERNAME}" },
        { "name": "WICKRIO_BOT_NAME", "value": "${WICKR_BOT_USERNAME}" }
      ]
    }
  ]
}
CLIENTCONFIG

# Clear password from memory
unset WICKR_BOT_PASSWORD
unset BOT_PASSWORD

echo "[start-bot] clientConfig.json written successfully"

# --- Derived paths ---
INTEGRATION_DIR="/opt/WickrIO/clients/${WICKR_BOT_USERNAME}/integration/${INTEGRATION_NAME}"
LOG_DIR="${INTEGRATION_DIR}/logs"
LOG_FILE="${LOG_DIR}/log.output"

# --- Start WickrIOSvr in the background ---
echo "[start-bot] Starting WickrIOSvr -notty in background..."
WickrIOSvr -notty &
WICKR_PID=$!
echo "[start-bot] WickrIOSvr PID: ${WICKR_PID}"

# --- Wait for setup to complete ---
echo "[start-bot] Waiting for setup to complete..."
MAX_WAIT=300
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  if ! kill -0 $WICKR_PID 2>/dev/null; then
    echo "[start-bot] ERROR: WickrIOSvr exited unexpectedly"
    wait $WICKR_PID || true
    exit 1
  fi

  if pgrep -l wickrio_bot >/dev/null 2>&1 && [ -f "${INTEGRATION_DIR}/bot.js" ]; then
    echo "[start-bot] Setup complete: wickrio_bot running, integration extracted"
    break
  fi

  sleep 5
  ELAPSED=$((ELAPSED + 5))
  if [ $((ELAPSED % 30)) -eq 0 ]; then
    echo "[start-bot] Still waiting... (${ELAPSED}s)"
  fi
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "[start-bot] ERROR: Setup did not complete within ${MAX_WAIT}s"
  kill $WICKR_PID 2>/dev/null || true
  exit 1
fi

# --- Kill any WPM-started node processes ---
# WPM may have started node via start.sh during WickrIOSvr setup.
# In -notty mode, WPM-started processes are unreliable and their output
# goes to wpm2.output instead of stdout (CloudWatch). Kill them so we
# can start a single, clean node process ourselves.
echo "[start-bot] Checking for WPM-started node processes..."
WPM_PIDS=$(pgrep -f "node bot.js" 2>/dev/null || true)
if [ -n "$WPM_PIDS" ]; then
  echo "[start-bot] Found WPM-started node process(es): ${WPM_PIDS} -- killing"
  for pid in $WPM_PIDS; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 2
  # Force kill if still alive
  for pid in $WPM_PIDS; do
    kill -9 "$pid" 2>/dev/null || true
  done
  echo "[start-bot] WPM-started processes killed"
else
  echo "[start-bot] No WPM-started node processes found"
fi

# Also kill any wpm2 process manager instances
WPM2_PIDS=$(pgrep -f "wpm2" 2>/dev/null || true)
if [ -n "$WPM2_PIDS" ]; then
  echo "[start-bot] Found wpm2 process(es): ${WPM2_PIDS} -- killing"
  for pid in $WPM2_PIDS; do
    kill "$pid" 2>/dev/null || true
  done
fi

# Brief pause to let ZMQ sockets release
sleep 3

# --- Start node process manually (drop to wickriouser) ---
# WickrIOSvr runs as root (platform requirement). The node bot application
# drops to wickriouser via gosu for least-privilege runtime execution.
# See: https://openillumi.com/en/en-docker-security-entrypoint-privilege-drop/
echo "[start-bot] Starting node bot.js as wickriouser (privilege drop)..."
cd "$INTEGRATION_DIR"
mkdir -p "$LOG_DIR"
chown -R wickriouser:wickriouser "$INTEGRATION_DIR"
gosu wickriouser node bot.js 2>&1 | tee -a "$LOG_FILE" &
NODE_PID=$!
echo "[start-bot] Node process started, PID: ${NODE_PID}"
sleep 5
if kill -0 $NODE_PID 2>/dev/null; then
  echo "[start-bot] Node process is running"
  # Log how many node bot.js processes exist (should be exactly 1)
  NODE_COUNT=$(pgrep -fc "node bot.js" 2>/dev/null || echo "0")
  echo "[start-bot] Active node bot.js processes: ${NODE_COUNT}"
  if [ "$NODE_COUNT" -gt 1 ]; then
    echo "[start-bot] WARNING: Multiple node processes detected! This will cause message routing bugs."
  fi
else
  echo "[start-bot] ERROR: Node process exited immediately"
  cat "$LOG_FILE" 2>/dev/null || true
  exit 1
fi

# --- Monitor loop: keep container alive, restart node if it dies ---
echo "[start-bot] Entering monitor loop..."
while true; do
  if ! kill -0 $WICKR_PID 2>/dev/null; then
    echo "[start-bot] WickrIOSvr died -- exiting"
    exit 1
  fi

  # Check for duplicate node processes (WPM may restart them)
  NODE_COUNT=$(pgrep -fc "node bot.js" 2>/dev/null || echo "0")
  if [ "$NODE_COUNT" -gt 1 ]; then
    echo "[start-bot] WARNING: ${NODE_COUNT} node processes detected -- killing extras"
    # Kill all except our tracked PID
    for pid in $(pgrep -f "node bot.js" 2>/dev/null || true); do
      if [ "$pid" != "$NODE_PID" ]; then
        echo "[start-bot] Killing extra node process PID: ${pid}"
        kill "$pid" 2>/dev/null || true
      fi
    done
  fi

  if ! pgrep -f "node bot.js" >/dev/null 2>&1; then
    echo "[start-bot] Node process died -- restarting as wickriouser..."
    cd "$INTEGRATION_DIR"
    mkdir -p "$LOG_DIR"
    gosu wickriouser node bot.js 2>&1 | tee -a "$LOG_FILE" &
    NODE_PID=$!
    echo "[start-bot] Node process restarted, PID: ${NODE_PID}"
  fi

  sleep 30
done
