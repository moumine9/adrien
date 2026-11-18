# Adrien, self-hosted: the read-only API and web visualizer for a decision log. See docs/self-hosting.md.
FROM node:24-slim

# `adrien@latest` by default; pass --build-arg ADRIEN_PACKAGE=adrien@<version> to pin one.
ARG ADRIEN_PACKAGE=adrien@latest

# git is how Adrien reads a log's default branch and follows a remote one.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*' \
 && npm install --global ${ADRIEN_PACKAGE} \
 && npm cache clean --force

# /data holds the cached clone of a remote log; /log is where a local log is mounted.
ENV ADRIEN_HOME=/data
RUN mkdir -p /data /log && chown node:node /data /log
USER node
WORKDIR /log

EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4310/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Beyond the machine, serve refuses to start without ADRIEN_TOKEN (or --no-auth behind an authenticating proxy).
ENTRYPOINT ["adrien"]
CMD ["serve", "--host", "0.0.0.0"]
