#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# pipeline/templates/start-bot.sh
# Entrypoint for Wickr IO bot containers (ECS Fargate or standalone Docker).
#
# Supports two credential modes:
#   Mode 1 (ECS/Secrets Manager): Set CREDENTIALS_ARN env var
#   Mode 2 (Direct env vars):     Set BOT_USERNAME and BOT_PASSWORD env vars
#
# Flow:
# 1. Resolve credentials (Secrets Manager or env vars)
# 2. Write clientConfig.json
# 3. Start WickrIOSvr -notty in background
# 4. Wait for wickrio_bot daemon + integration setup
# 5. Start node process manually (WPM is unreliable)
# 6. Monitor loop: restart node if it dies
#
# Required environment variables:
#   CREDENTIALS_ARN  OR  (BOT_USERNAME + BOT_PASSWORD)
#   INTEGRATION_NAME - Name of the integration (default: wickr-form-collection-bot)
#
# Optional environment variables (passed through to the bot process):
#   REPORTS_BUCKET_NAME, ALLOWLIST_TABLE_NAME, ADMIN_EMAILS
#   TEAMS_TENANT_ID, TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET
#   TEAMS_TEAM_ID, TEAMS_WEBHOOK_URL
#
# Reference: https://github.com/aws-samples/sample-bedrock-wickr-bot

set -euo pipefail

# --- Resolve the Node.js runtime supplied by the base image ---
# The Dockerfile deliberately does NOT bake an nvm path into PATH: the image's Node.js
# version changes between Wickr releases (20.x -> 24.x as of console v6.66.2.1) and the
# native wickrio_addon is compiled against whichever runtime ships. Sourcing nvm here
# keeps the entrypoint correct across image upgrades.
# nvm.sh references unset variables, so relax `set -u` while sourcing it.
if [ -f /usr/local/nvm/nvm.sh ]; then
  set +u
  . /usr/local/nvm/nvm.sh
  set -u
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[start-bot] ERROR: node not found on PATH after sourcing nvm"
  exit 1
fi
echo "[start-bot] Node.js: $(node --version) ($(command -v node))"

INTEGRATION_NAME="${INTEGRATION_NAME:-wickr-form-collection-bot}"
AWS_REGION="${AWS_REGION:-us-gov-west-1}"
echo "[start-bot] INTEGRATION_NAME=${INTEGRATION_NAME}"

# --- Resolve credentials ---
if [ -n "${CREDENTIALS_ARN:-}" ]; then
  # Mode 1: Secrets Manager
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
  # Mode 2: Direct env vars
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

# --- Own the node process outright ---
#
# This entrypoint starts node itself rather than letting WPM do it. Exactly one `node bot.js`
# may run: two processes hold two separate in-memory states, and the daemon hands each message
# to whichever ZeroMQ listener grabs it first. The symptom is intermittent -- a confirmation
# flow that needs two attempts, and logs that disappear for some interactions.
#
# Killing WPM's copy rather than deferring to it also keeps the bot's output on OUR stdout,
# which is what the container log driver captures. A WPM-started process writes to
# wpm2.output inside the container instead, where CloudWatch never sees it.
#
# bot/start.sh is the console path's launcher and is deliberately not used here.

start_node() {
  cd "$INTEGRATION_DIR"
  mkdir -p "$LOG_DIR"
  touch "$LOG_FILE"
  chown -R wickriouser:wickriouser "$INTEGRATION_DIR"
  # Process substitution rather than a pipe: with `node ... | tee &`, $! is tee's pid, so every
  # later liveness check watched the wrong process and never noticed node dying. WickrIOSvr
  # remains root, but the JavaScript integration runs without root privileges.
  su-exec wickriouser node bot.js > >(tee -a "$LOG_FILE") 2>&1 &
  NODE_PID=$!
  echo "[start-bot] node bot.js started by entrypoint as wickriouser, PID: ${NODE_PID}"
}

# Give WickrIOSvr a moment to finish extracting and, if it is going to, start its own copy.
echo "[start-bot] Waiting 30s for WickrIOSvr to settle..."
sleep 30

# Clear anything WPM started before claiming the role ourselves.
if pgrep -f "node bot.js" >/dev/null 2>&1; then
  echo "[start-bot] WPM started node bot.js -- stopping it so this entrypoint owns the process"
  pkill -TERM -f "node bot.js" 2>/dev/null || true
  pkill -TERM -f wpm2 2>/dev/null || true
  sleep 3
  pkill -KILL -f "node bot.js" 2>/dev/null || true
fi

start_node
sleep 5
if kill -0 "$NODE_PID" 2>/dev/null; then
  echo "[start-bot] Node process is running"
  tail -5 "$LOG_FILE" 2>/dev/null || true
else
  echo "[start-bot] ERROR: Node process exited immediately"
  cat "$LOG_FILE" 2>/dev/null || true
fi

# --- Monitor loop: keep container alive, restart node if it dies ---
echo "[start-bot] Entering monitor loop..."
while true; do
  if ! kill -0 "$WICKR_PID" 2>/dev/null; then
    echo "[start-bot] WickrIOSvr died -- exiting"
    exit 1
  fi

  # WPM can start a competing copy at any point, not just at startup.
  for stray in $(pgrep -f "node bot.js" 2>/dev/null || true); do
    if [ "$stray" != "$NODE_PID" ]; then
      echo "[start-bot] Killing stray node bot.js (PID ${stray}) -- only one may run"
      kill -TERM "$stray" 2>/dev/null || true
    fi
  done

  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "[start-bot] Node process died -- restarting..."
    start_node
  fi

  sleep 30
done
