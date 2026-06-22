#!/bin/sh
# Render the front-proxy config from its template (nginx does not interpolate
# env), then exec nginx. Mirrors the ingress seed.sh envsubst pattern so the two
# nginx configs are rendered the same way.
set -eu

export PLANDROP_PROXY_PORT="${PLANDROP_PROXY_PORT:-8080}"
export PLANDROP_PROXY_DOMAIN="${PLANDROP_PROXY_DOMAIN:-localhost}"
export PLANDROP_INGRESS_HOST="${PLANDROP_INGRESS_HOST:-ingress}"
export PLANDROP_INGRESS_PORT="${PLANDROP_INGRESS_PORT:-8082}"
export PLANDROP_APACHE_HOST="${PLANDROP_APACHE_HOST:-apache}"
export PLANDROP_APACHE_PORT="${PLANDROP_APACHE_PORT:-8080}"

envsubst '${PLANDROP_PROXY_PORT} ${PLANDROP_PROXY_DOMAIN} ${PLANDROP_INGRESS_HOST} ${PLANDROP_INGRESS_PORT} ${PLANDROP_APACHE_HOST} ${PLANDROP_APACHE_PORT}' \
  < /etc/nginx/nginx.conf.template > /tmp/nginx.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
