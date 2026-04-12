# Commercial Wickr IO base image
# For GovCloud, use: public.ecr.aws/x3s2s6k3/wickrio/bot-cloud-govcloud:latest
FROM public.ecr.aws/x3s2s6k3/wickrio/bot-cloud:latest

SHELL ["/bin/bash", "-c"]

ARG NODE_VERSION=20.20.1
ENV NODE_VERSION=${NODE_VERSION}
ENV PATH="/usr/bin:/usr/local/bin:/usr/local/nvm/versions/node/v${NODE_VERSION}/bin:${PATH}"

# Install AWS CLI via pip (v2 binary segfaults on some Wickr base images)
RUN (apt-get update && apt-get install -y python3-pip 2>/dev/null || true) \
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
RUN cd /tmp/bot-src \
    && chmod 755 *.sh \
    && tar -czf /tmp/software.tar.gz \
       --owner=0 --group=0 \
       . \
    && rm -rf /tmp/bot-src

# Stage tarball for WickrIOSvr
RUN mkdir -p /usr/lib/wickr/integrations/software/wickr-form-collection-bot \
    && mv /tmp/software.tar.gz /usr/lib/wickr/integrations/software/wickr-form-collection-bot/software.tar.gz

# Copy entrypoint
COPY scripts/start-bot.sh /home/wickriouser/start-bot.sh
RUN chmod +x /home/wickriouser/start-bot.sh

WORKDIR /home/wickriouser

HEALTHCHECK --interval=60s --timeout=10s --start-period=180s --retries=3 \
  CMD pgrep -l wickrio_bot || exit 1

USER root

ENTRYPOINT ["./start-bot.sh"]
