#!/bin/sh
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# Invoked by the Wickr IO console when upgrading the integration in place.
if [ -f "/usr/local/nvm/nvm.sh" ]; then
  . /usr/local/nvm/nvm.sh
fi
# Plain npm install, deliberately not --unsafe-perm. Nothing in this dependency tree compiles
# at install time: wickrio_addon is pure JavaScript, and its zeromq and deasync dependencies
# ship prebuilt binaries per Node.js version. --unsafe-perm was carried over from an era when
# a native build ran here and it only widens what install scripts may do.
npm install
