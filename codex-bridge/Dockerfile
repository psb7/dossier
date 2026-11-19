FROM node:24-bookworm-slim
ARG CODEX_VERSION=0.170.0
RUN npm install --global @openai/codex@${CODEX_VERSION} \
    && mkdir -p /home/node/.codex && chown node:node /home/node/.codex
WORKDIR /bridge
COPY --chown=node:node runner.mjs server.mjs ./
USER node
ENV CODEX_BRIDGE_HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "server.mjs"]
