#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# Builds the bot container image and pushes it to ECR.
#
# Must run on Linux or macOS. Building on Windows loses the execute bit on the bot's
# shell scripts, which makes the Wickr IO integration fail silently at container start.
#
# Two modes:
#   Local  (default)      -- builds from this repository checkout. Run from the repo root.
#   Staged (STAGING_S3_URI) -- fetches build inputs from S3 first. Use when the Docker
#                              host cannot reach your checkout, e.g. an EC2 build box you
#                              reach over AWS Systems Manager Session Manager.
#
# Required environment variables:
#   AWS_ACCOUNT_ID   Account owning the ECR repository, e.g. 111122223333
#   IMAGE_TAG        Immutable tag, e.g. 20260729-1. Do not use "latest" -- ECS caches
#                    by tag, so a mutable tag makes deployments non-reproducible.
#
# Optional:
#   AWS_REGION       Default us-gov-west-1
#   ECR_REPO_NAME    Default wickr-form-collection-bot. Must match ecrRepositoryName
#                    in config.yaml.
#   ECR_DOMAIN       Registry hostname. Defaults to the GovCloud/commercial form
#                    <account>.dkr.ecr.<region>.amazonaws.com, which is correct for both.
#   STAGING_S3_URI   Enables staged mode, e.g. s3://<your-build-bucket>/build-staging
#   INTEGRATION_NAME Wickr integration name. Default wickr-form-collection-bot. MUST match
#                    integrationName in config.yaml -- WickrIOSvr looks for the tarball at
#                    /usr/lib/wickr/integrations/software/<name>/ and the bot silently
#                    never starts if they disagree.
#   BASE_IMAGE       Wickr IO base image, pinned by digest. Defaults to the GovCloud
#                    image. For commercial AWS use the bot-cloud repository instead:
#                    public.ecr.aws/x3s2s6k3/wickrio/bot-cloud@sha256:<digest>
#
# Example (local):
#   AWS_ACCOUNT_ID=111122223333 IMAGE_TAG=20260729-1 ./build-and-push-image.sh
#
# Example (staged, from the build host):
#   AWS_ACCOUNT_ID=111122223333 IMAGE_TAG=20260729-1 \
#     STAGING_S3_URI=s3://<your-build-bucket>/build-staging ./build-and-push-image.sh

set -euo pipefail

: "${AWS_ACCOUNT_ID:?Set AWS_ACCOUNT_ID to the account owning the ECR repository}"
: "${IMAGE_TAG:?Set IMAGE_TAG to an immutable tag, e.g. 20260729-1}"

AWS_REGION="${AWS_REGION:-us-gov-west-1}"
ECR_REPO_NAME="${ECR_REPO_NAME:-wickr-form-collection-bot}"
ECR_DOMAIN="${ECR_DOMAIN:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
ECR_REPO="${ECR_DOMAIN}/${ECR_REPO_NAME}"
STAGING_S3_URI="${STAGING_S3_URI:-}"
INTEGRATION_NAME="${INTEGRATION_NAME:-wickr-form-collection-bot}"
BASE_IMAGE="${BASE_IMAGE:-}"

if [ "$IMAGE_TAG" = "latest" ]; then
  echo "ERROR: IMAGE_TAG must not be 'latest'. Use an immutable tag so deployments" >&2
  echo "       are reproducible and so ECS actually pulls the new image." >&2
  exit 1
fi

BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

if [ -n "$STAGING_S3_URI" ]; then
  echo "=== Staged mode: fetching build inputs from ${STAGING_S3_URI} ==="
  aws s3 cp "${STAGING_S3_URI}/software.tar.gz" "$BUILD_DIR/software.tar.gz"
  aws s3 cp "${STAGING_S3_URI}/Dockerfile"      "$BUILD_DIR/Dockerfile"
  aws s3 cp "${STAGING_S3_URI}/start-bot.sh"    "$BUILD_DIR/start-bot.sh"
else
  echo "=== Local mode: building from this checkout ==="
  if [ ! -d bot ] || [ ! -f Dockerfile ]; then
    echo "ERROR: run this from the repository root (expected ./bot and ./Dockerfile)." >&2
    exit 1
  fi
  cp Dockerfile start-bot.sh "$BUILD_DIR/"
  tar -czf "$BUILD_DIR/software.tar.gz" \
    --exclude=node_modules --exclude=test --exclude=package-lock.json -C bot .
fi

cd "$BUILD_DIR"

# Repack with execute bits set. A tarball created on Windows carries 0644 on *.sh, and
# the Wickr IO console then fails to run install.sh/start.sh with no useful error.
mkdir -p bot-src
tar -xzf software.tar.gz -C bot-src
chmod 755 bot-src/*.sh
tar -czf software.tar.gz --owner=0 --group=0 -C bot-src .

echo "=== Forms included in the image ==="
tar -tzf software.tar.gz | grep 'forms/' || {
  echo "ERROR: no form definitions found in the tarball." >&2
  exit 1
}

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_DOMAIN"

# The Dockerfile expects the entrypoint at pipeline/templates/start-bot.sh.
mkdir -p pipeline/templates
cp start-bot.sh pipeline/templates/start-bot.sh

build_args=(--build-arg "INTEGRATION_NAME=${INTEGRATION_NAME}")
if [ -n "$BASE_IMAGE" ]; then
  build_args+=(--build-arg "BASE_IMAGE=${BASE_IMAGE}")
fi

docker build "${build_args[@]}" -t "${ECR_REPO}:${IMAGE_TAG}" -f Dockerfile .
docker push "${ECR_REPO}:${IMAGE_TAG}"

echo "BUILD_COMPLETE"
echo "IMAGE=${ECR_REPO}:${IMAGE_TAG}"
echo
echo "INTEGRATION_NAME=${INTEGRATION_NAME}"
echo
echo "Next, in config.yaml set:"
echo "  imageTag: \"${IMAGE_TAG}\""
echo "  integrationName: \"${INTEGRATION_NAME}\""
echo "then run 'npx cdk deploy'."
