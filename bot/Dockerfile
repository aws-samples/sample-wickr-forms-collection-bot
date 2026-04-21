# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Commercial Wickr IO base image (pinned digest for reproducible builds)
# For GovCloud, use: public.ecr.aws/x3s2s6k3/wickrio/bot-cloud-govcloud:latest
FROM public.ecr.aws/x3s2s6k3/wickrio/bot-cloud:latest@sha256:364896e15a917c76f3511252a4b4322d5c4b14dbf6a4dd7100b0cd3c8c3b7d4a

SHELL ["/bin/bash", "-c"]

ARG NODE_VERSION=20.20.1
ENV NODE_VERSION=${NODE_VERSION}
ENV PATH="/usr/bin:/usr/local/bin:/usr/local/nvm/versions/node/v${NODE_VERSION}/bin:${PATH}"

# Install AWS CLI via pip (v2 binary segfaults on some Wickr base images)
# Install gosu for runtime privilege de-escalation (root -> wickriouser for node process)
RUN (apt-get update && apt-get install -y python3-pip gosu 2>/dev/null || true) \
    && pip3 install --break-system-packages awscli 2>/dev/null \
    || pip3 install awscli \
    && aws --version

# Create software tarball from bot source during build
# Sets 0755 on .sh files for Wickr IO import compatibility
COPY bot.js package.json install.sh start.sh processes.json wpm.json /tmp/bot-src/
COPY configTokens.json configure.js configure.sh stop.sh upgrade.sh /tmp/bot-src/
COPY data/ /tmp/bot-src/data/
COPY forms/ /tmp/bot-src/forms/
COPY services/ /tmp/bot-src/services/
WORKDIR /tmp/bot-src
RUN sed -i 's/\r$//' *.sh \
    && chmod 755 *.sh \
    && tar -czf /tmp/software.tar.gz \
       --owner=0 --group=0 \
       . \
    && rm -rf /tmp/bot-src

# Stage tarball for WickrIOSvr
RUN mkdir -p /usr/lib/wickr/integrations/software/wickr-form-collection-bot \
    && mv /tmp/software.tar.gz /usr/lib/wickr/integrations/software/wickr-form-collection-bot/software.tar.gz

# Copy entrypoint (convert CRLF to LF for Linux compatibility)
COPY scripts/start-bot.sh /home/wickriouser/start-bot.sh
RUN sed -i 's/\r$//' /home/wickriouser/start-bot.sh \
    && chmod +x /home/wickriouser/start-bot.sh

WORKDIR /home/wickriouser

HEALTHCHECK --interval=60s --timeout=10s --start-period=180s --retries=3 \
  CMD pgrep -l wickrio_bot || exit 1

# WickrIOSvr requires root to start and manage the wickrio_bot daemon.
# This is a platform constraint of the Wickr IO container, not our application code.
# Privilege drops to wickriouser via gosu in start-bot.sh.
USER root

ENTRYPOINT ["./start-bot.sh"]
