FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node . /opt/agent-pipeline

WORKDIR /workspace
USER node

EXPOSE 4399

HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4399/api/snapshot').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "/opt/agent-pipeline/dashboard/server.mjs", "--host", "0.0.0.0", "--allow-non-loopback"]
