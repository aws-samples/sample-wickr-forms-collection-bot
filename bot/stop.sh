#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# Run by the Wickr IO console when the client is paused or stopped. Console import path only;
# the ECS path never invokes this.
#
# Deliberately NOT `npm stop`. Routing through npm/wpm2 is what produces the dual-process
# split-brain bug, and this branch's package.json correctly defines only `start`. The pid comes
# from the path named in pidLocation.json, matching the convention Wickr's own integrations use,
# with a command-line match as a fallback.
#
# Without a working stop.sh the console has no way to stop the integration, which is how orphaned
# node bot.js and wickrio_bot processes accumulate across add and delete cycles -- and orphans
# make every later console operation behave unpredictably.
if [ -f "/usr/local/nvm/nvm.sh" ]; then
  . /usr/local/nvm/nvm.sh
fi

PID_FILE="$(tr -d '"[:space:]' < pidLocation.json 2>/dev/null)"
[ -n "$PID_FILE" ] || PID_FILE=bot.pid

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "[stop.sh] stopping node bot.js (PID ${PID})"
    kill -TERM "$PID" 2>/dev/null || true
    for _ in $(seq 1 8); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
else
  echo "[stop.sh] no pid file; falling back to command-line match"
  pkill -TERM -f "node bot.js" 2>/dev/null || true
fi

echo "[stop.sh] done"
