# Version-specific packaging layer: authentication logic and encryption stay
# upstream; only the two cookie names get a distinct instance suffix.
FROM ghcr.io/aientech/dossier:v1.15.1
ARG COOKIE_NAMESPACE
USER root
COPY namespace-cookies.mjs /tmp/namespace-cookies.mjs
RUN node /tmp/namespace-cookies.mjs /app/.next/server "${COOKIE_NAMESPACE}" \
    && rm /tmp/namespace-cookies.mjs
LABEL org.opencontainers.image.source="https://github.com/psb7/dossier"
LABEL io.dossier.cookie-namespace="${COOKIE_NAMESPACE}"
USER node
