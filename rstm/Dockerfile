# RSTM build of Chatwoot: the official release image plus small RSTM patches (see README.md).
# Built by Coolify from this folder (build context .../helpdesk.git#<commit>:rstm).
ARG CHATWOOT_VERSION=v4.18.0
FROM chatwoot/chatwoot:${CHATWOOT_VERSION}
COPY config/initializers/ /app/config/initializers/
COPY app/ /app/app/
