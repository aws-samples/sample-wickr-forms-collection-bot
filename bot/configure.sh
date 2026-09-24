#!/bin/sh
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# Invoked by the Wickr IO console when you configure the integration. Runs configure.js,
# which prompts for the tokens in configTokens.json and writes processes.json.
#
# Optional argument: a file of pre-seeded answers, for a non-interactive run. It is both
# sourced (so CLIENT_NAME is visible below) and copied to .env.configure (which configure.js
# reads via dotenv, because a plain FOO=bar without export is not inherited by node).
rm -f .env.configure
if [ -n "$1" ]; then
  if [ -f "$1" ]; then
    . "$1"
    cp "$1" .env.configure
  fi
fi
# Node comes from the base image via nvm. Never hardcode a version or path -- see the
# comments in the Dockerfile.
if [ -f "/usr/local/nvm/nvm.sh" ]; then
  . /usr/local/nvm/nvm.sh
fi
if [ -z "$CLIENT_NAME" ]; then
  node configure.js
else
  echo $CLIENT_NAME > client_bot_username.txt
  WICKRIO_BOT_NAME=$CLIENT_NAME node configure.js
fi
