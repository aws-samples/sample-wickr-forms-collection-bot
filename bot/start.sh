#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# Console import path only. WickrIOSvr runs this script and WAITS FOR IT TO RETURN, so node must
# be backgrounded here. A foreground `node bot.js` (or `exec node bot.js`) never returns: the
# start never completes, no integration process survives, and the console still reports the
# client Running while the daemon logs "Failed to send async message!" for every message it
# cannot hand to an integration that is not there.
#
# Deliberately not `npm start` or `wpm2` -- routing through either produces a second node process
# alongside the one already running, splitting messages between two in-memory states.
#
# The ECS path does not use this file. There the container entrypoint (../start-bot.sh) starts
# node itself and tees to stdout so the container log driver captures it.
export NVM_DIR="/usr/local/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Written by configure.sh from the bot username the console was configured with. On the console
# path this is the ONLY thing that supplies BOT_USERNAME, which bot.js requires and logs
# missing_env for when absent. On the ECS path the entrypoint exports it from Secrets Manager
# before WickrIOSvr starts, this file does not exist, and the guard makes the block a no-op.
if [ -f "client_bot_username.txt" ]; then
  export BOT_USERNAME=$(cat client_bot_username.txt)
fi

mkdir -p logs

# Output goes to wpm2.output because WickrIOSvr watches that filename to decide whether a paused
# client is still producing output. Keep the name even though wpm2 is not involved.
nohup node bot.js >> wpm2.output 2>&1 &
NODE_PID=$!

# Record the pid where stop.sh will look for it. Without this the console has no way to stop the
# integration, and orphaned processes accumulate across add and delete cycles.
PID_FILE="$(tr -d '"[:space:]' < pidLocation.json 2>/dev/null)"
[ -n "$PID_FILE" ] || PID_FILE=bot.pid
echo "$NODE_PID" > "$PID_FILE"

echo "[start.sh] node bot.js started in background, PID ${NODE_PID} (pid file: ${PID_FILE})"
