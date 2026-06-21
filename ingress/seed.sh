#!/bin/sh
# Seed the shared theme volume fresh on every ingress boot, then exec nginx.
#
# The built-in templates are baked into this image at /usr/share/plandrop/
# templates. The built-in theme volume (mounted at THEME_DIR) is wiped and
# re-populated from them each boot, so the built-in set is always exactly what
# shipped — a stale entry from a prior boot never survives. Operator templates
# live on a *separate* mount (a later phase) that this seed never touches, so
# wiping this volume wholesale is safe.
#
# For each template folder, the seeder assembles template.html from the three
# parts (header.html + plan.html + footer.html) so the parts stay the single
# source of truth and a custom template need only drop in its own plan.html.
set -eu

SRC="${PLANDROP_TEMPLATE_SRC:-/usr/share/plandrop/templates}"
export THEME_DIR="${PLANDROP_THEME_DIR:-/srv/templates}"
export PLANDROP_THEME_DIR="$THEME_DIR"
export PLANDROP_INGRESS_PORT="${PLANDROP_INGRESS_PORT:-80}"
export PLANDROP_CONTROL_HOST="${PLANDROP_CONTROL_HOST:-control}"
export PLANDROP_CONTROL_PORT="${PLANDROP_CONTROL_PORT:-8081}"

# Fresh seed: clear the built-in volume entirely, then re-copy from the image.
mkdir -p "$THEME_DIR"
rm -rf "${THEME_DIR:?}"/*

for dir in "$SRC"/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  cp -R "$dir" "$THEME_DIR/$name"
  # Assemble the starter from the three parts.
  cat "$THEME_DIR/$name/header.html" \
      "$THEME_DIR/$name/plan.html" \
      "$THEME_DIR/$name/footer.html" > "$THEME_DIR/$name/template.html"
done

# Render the nginx config from its template (nginx does not interpolate env).
envsubst '${PLANDROP_INGRESS_PORT} ${PLANDROP_THEME_DIR} ${PLANDROP_CONTROL_HOST} ${PLANDROP_CONTROL_PORT}' \
  < /etc/nginx/nginx.conf.template > /tmp/nginx.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
