#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# Builds source.zip for the CodeBuild image build (docs/DEPLOY-CDK-CODEBUILD.md, "Package the
# source"), then verifies it before you upload.
#
# Runs anywhere bash does, including Git Bash on Windows, which is what option B's later
# steps already require. It exists as a script rather than a block of commands in the guide
# because pasting a multi-line block into a console loses newlines and silently runs the
# statements as one line.
#
#   ./package-source.sh
#
# The archive gets exactly four members at its root -- bot/, Dockerfile, start-bot.sh, and
# buildspec.yml -- because those are the only paths the build reads. CodeBuild looks for
# buildspec.yml at the top level, so the CONTENTS are zipped, never the folder itself.

set -euo pipefail

# Resolve the repository root from this script's own location, so it works no matter which
# directory you invoke it from.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

for required in bot Dockerfile start-bot.sh buildspec.yml; do
  if [ ! -e "$required" ]; then
    echo "ERROR: $REPO does not look like the bot repository root ($required missing)." >&2
    exit 1
  fi
done

# Probe by RUNNING each tool, not with `command -v`. Git for Windows has been seen with
# /usr/bin/zip present on PATH while executing it fails with 127; `command -v` passes, and the
# `zip -q` below then dies under `set -e` with no message at all. Note unzip needs -v, because
# `unzip --version` exits 10.
check_tool () {
  tool="$1"; shift
  if "$tool" "$@" >/dev/null 2>&1; then
    return 0
  fi
  located="$(command -v "$tool" 2>/dev/null || true)"
  if [ -n "$located" ]; then
    echo "ERROR: '$tool' is on PATH at $located but fails to execute." >&2
    echo "       Git for Windows ships a non-functional zip on some installs." >&2
  else
    echo "ERROR: '$tool' not found on PATH." >&2
  fi
  if [ "$tool" = "zip" ]; then
    echo >&2
    echo "       On Windows, build the archive with the bsdtar that ships in Windows 10 and 11" >&2
    echo "       instead. It writes correct forward-slash paths:" >&2
    echo >&2
    echo "         C:\\Windows\\System32\\tar.exe -a -cf source.zip \\" >&2
    echo "           -C <staging-dir> bot Dockerfile start-bot.sh buildspec.yml" >&2
    echo >&2
    echo "       Do NOT use PowerShell's Compress-Archive: on PowerShell 5.1 it stores" >&2
    echo "       backslash separators, which Linux extracts as literal filenames." >&2
  fi
  exit 1
}

check_tool tar --version
check_tool unzip -v

# Choose an archiver. `zip` is preferred and is what Linux and macOS have. Where it is missing
# or broken, Windows 10 and 11 ship a bsdtar at C:\Windows\System32\tar.exe that writes zip
# with correct forward-slash paths -- unlike PowerShell's Compress-Archive. Note the GNU tar in
# Git Bash CANNOT do this; only the Windows one can, so it is invoked by absolute path.
WINDOWS_BSDTAR=/c/Windows/System32/tar.exe
if zip --version >/dev/null 2>&1; then
  ARCHIVER=zip
elif [ -x "$WINDOWS_BSDTAR" ] && command -v cygpath >/dev/null 2>&1; then
  ARCHIVER=bsdtar
  located="$(command -v zip 2>/dev/null || true)"
  if [ -n "$located" ]; then
    echo "NOTE: 'zip' at $located does not run (a known Git for Windows defect)."
  else
    echo "NOTE: 'zip' is not installed."
  fi
  echo "      Falling back to Windows bsdtar, which produces an equivalent archive."
else
  check_tool zip --version
fi

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

echo "=== Staging build inputs ==="
cp Dockerfile start-bot.sh buildspec.yml "$STAGING/"
mkdir -p "$STAGING/bot"
# node_modules is excluded because bot/install.sh runs npm install inside the container at
# startup. Everything else under bot/ is copied; the build applies its own tar excludes.
tar -c --exclude=node_modules -C bot . | tar -x -C "$STAGING/bot"
echo "  staged bot/, Dockerfile, start-bot.sh, buildspec.yml"

ARCHIVE="$REPO/source.zip"
rm -f "$ARCHIVE"
if [ "$ARCHIVER" = "zip" ]; then
  ( cd "$STAGING" && zip -qr "$ARCHIVE" . )
else
  # Members are named explicitly rather than using '.', so entries are 'bot/bot.js' and not
  # './bot/bot.js', matching what zip -r produces. Windows bsdtar needs Windows-style paths.
  "$WINDOWS_BSDTAR" -a -cf "$(cygpath -w "$ARCHIVE")" \
    -C "$(cygpath -w "$STAGING")" bot Dockerfile start-bot.sh buildspec.yml
fi

echo "=== Verifying $ARCHIVE ==="
entries="$(unzip -Z1 "$ARCHIVE")"
fail=0

require_entry() {
  if printf '%s\n' "$entries" | grep -qx "$1"; then
    echo "  ok: $1"
  else
    echo "  FAIL: missing $1" >&2
    fail=1
  fi
}

# buildspec.yml at the root is the one that produces a confusing failure if wrong:
# CodeBuild reports "YAML_FILE_ERROR: YAML file does not exist" rather than a path problem.
require_entry 'buildspec.yml'
require_entry 'Dockerfile'
require_entry 'start-bot.sh'
require_entry 'bot/bot.js'
require_entry 'bot/install.sh'
require_entry 'bot/start.sh'

if printf '%s\n' "$entries" | grep -q '^bot/forms/..*'; then
  echo "  ok: $(printf '%s\n' "$entries" | grep -c '^bot/forms/..*') form definition(s)"
else
  echo "  FAIL: no form definitions under bot/forms/" >&2
  fail=1
fi

if printf '%s\n' "$entries" | grep -q 'node_modules'; then
  echo "  FAIL: node_modules leaked into the archive" >&2
  fail=1
else
  echo "  ok: no node_modules"
fi

# A zip written by Windows PowerShell 5.1's Compress-Archive stores backslash separators,
# which Linux extracts as filenames containing literal backslashes rather than directories.
# This script uses zip so that cannot happen, but the check is cheap and the failure mode
# is otherwise very hard to recognize.
if printf '%s\n' "$entries" | grep -q '\\'; then
  echo "  FAIL: entries contain backslashes; Linux cannot extract this correctly" >&2
  fail=1
else
  echo "  ok: forward-slash paths"
fi

if [ "$fail" -ne 0 ]; then
  echo "=== NOT READY -- fix the failures above before uploading ===" >&2
  exit 1
fi

echo "=== Ready ==="
echo "  $ARCHIVE  ($(du -h "$ARCHIVE" | cut -f1), $(printf '%s\n' "$entries" | wc -l | tr -d ' ') entries)"
echo
echo "Next: upload and start the build (docs/DEPLOY-CDK-CODEBUILD.md)."
