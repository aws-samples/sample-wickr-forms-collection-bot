#!/bin/sh
rm -f .env.configure

if [ -n "$1" ]; then
  if [ -f "$1" ]; then
    . "$1"
    cp "$1" .env.configure
  fi
fi

if [ -f "/usr/local/nvm/nvm.sh" ]; then
  . /usr/local/nvm/nvm.sh
fi

if [ -z "$CLIENT_NAME" ]; then
  node configure.js
else
  echo $CLIENT_NAME > client_bot_username.txt
  WICKRIO_BOT_NAME=$CLIENT_NAME node configure.js
fi
