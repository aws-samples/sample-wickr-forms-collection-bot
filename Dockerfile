# Pinned to the GovCloud Wickr IO container digest validated 2026-07-27.
# This digest ships: WickrIO console v6.66.2.1, Ubuntu 24.04.4 (glibc 2.39),
# Node.js 24.15.0 (npm 11.13.0) via nvm.
#
# Do NOT use :latest -- pin by digest. The image's Node.js runtime and the native
# wickrio_addon (built with nan, which is ABI-specific) form one compatibility set
# together with the wickrio-bot-api version pinned in bot/package.json.
# Re-validate the container end-to-end before changing this digest.
# Override for a commercial (non-GovCloud) deployment, which uses a different repository:
#   --build-arg BASE_IMAGE=public.ecr.aws/x3s2s6k3/wickrio/bot-cloud@sha256:<digest>
# Always pin by digest, never :latest.
# checkov:skip=CKV_DOCKER_7: BASE_IMAGE defaults to a full immutable digest; Checkov does not resolve ARG defaults.
ARG BASE_IMAGE=public.ecr.aws/x3s2s6k3/wickrio/bot-cloud-govcloud@sha256:3ba2b33c9f1386713580294ba2a8bf5f0a6394f145bb7c8263728ed1b3c92141
FROM ${BASE_IMAGE}

SHELL ["/bin/bash", "-c"]

# Must match `integrationName` in config.yaml. WickrIOSvr looks for the tarball at
# /usr/lib/wickr/integrations/software/<integrationName>/software.tar.gz -- if the two
# disagree it does not find the bot code, and the container starts but never runs the bot.
# build-and-push-image.sh passes this through as INTEGRATION_NAME.
ARG INTEGRATION_NAME=wickr-form-collection-bot

# Node.js is supplied by the base image and selected through nvm. Do NOT hardcode a
# version or bake an nvm path into PATH -- the native wickrio_addon must compile against
# whatever runtime the image ships. scripts/start-bot.sh sources nvm at container start.
# This step fails the build early if the runtime or jq (used by start-bot.sh to parse
# Secrets Manager output) is missing from a future base image.
RUN source /usr/local/nvm/nvm.sh \
    && echo "base image node: $(node --version), npm: $(npm --version)" \
    && command -v jq >/dev/null || { echo "ERROR: jq missing from base image"; exit 1; }

# Install AWS CLI via pip (pure Python, no native deps).
# The v2 binary installer segfaults on some Wickr base images due to native library
# incompatibility. --break-system-packages is required on Ubuntu 24.04 (PEP 668).
# Pinned so image builds are reproducible; bump deliberately after testing.
ARG AWSCLI_VERSION=1.46.1
RUN (apt-get update && apt-get install -y python3-pip 2>/dev/null || true) \
    && pip3 install --break-system-packages "awscli==${AWSCLI_VERSION}" 2>/dev/null \
    || pip3 install "awscli==${AWSCLI_VERSION}" \
    && aws --version

RUN mkdir -p "/usr/lib/wickr/integrations/software/${INTEGRATION_NAME}"
COPY software.tar.gz /usr/lib/wickr/integrations/software/${INTEGRATION_NAME}/software.tar.gz

COPY pipeline/templates/start-bot.sh /home/wickriouser/start-bot.sh
RUN chmod +x /home/wickriouser/start-bot.sh

WORKDIR /home/wickriouser

HEALTHCHECK --interval=60s --timeout=10s --start-period=180s --retries=3 \
  CMD pgrep -l wickrio_bot || exit 1

# WickrIOSvr must start as root to manage wickrio_bot. The entrypoint launches only that daemon
# as root, then runs node bot.js through su-exec wickriouser for initial start and restarts.
# checkov:skip=CKV_DOCKER_8: Required root daemon with an explicit non-root application boundary.
# nosemgrep: dockerfile.security.last-user-is-root.last-user-is-root
USER root

ENTRYPOINT ["./start-bot.sh"]
