#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

export NVM_DIR="/usr/local/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Read bot username from the client file written by Wickr IO during setup
if [ -f "client_bot_username.txt" ]; then
  export BOT_USERNAME=$(cat client_bot_username.txt)
fi

mkdir -p logs
nohup node bot.js >> logs/log.output 2>&1 &
echo $! > .bot.pid
