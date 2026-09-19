#!/usr/bin/env bash
# Activate a staged release; run as root after runtime/model/reference validation.
set -euo pipefail
release_dir="${1:?Usage: install-service.sh /srv/crispert/releases/RELEASE RELEASE_ID}"
release_id="${2:?Release identifier required}"
test "$(id -u)" -eq 0
mountpoint -q /srv/crispert
case "$release_dir" in /srv/crispert/releases/*) ;; *) echo 'Release must be on the data volume'; exit 1;; esac
test -f "$release_dir/backend/offtargetpred/api.py"
test -x /srv/crispert/venv/bin/python
test -f /srv/crispert/models/k1/model.ckpt
test -f /srv/crispert/models/k2/model.ckpt
test -f /srv/crispert/models/k3/model.ckpt
if ! id offtarget >/dev/null 2>&1; then
    useradd --system --home-dir /srv/crispert --shell /usr/sbin/nologin offtarget
fi
install -d -o offtarget -g offtarget -m 0700 /srv/crispert/data /srv/crispert/tmp
install -d -o www-data -g www-data -m 0700 /srv/crispert/nginx-body
install -d -o root -g root -m 0755 /etc/offtarget-web
chown -R root:root "$release_dir" /srv/crispert/models /srv/crispert/bin /srv/crispert/references /srv/crispert/venv
chmod -R go-w "$release_dir" /srv/crispert/models /srv/crispert/bin /srv/crispert/references /srv/crispert/venv
chgrp -R offtarget /srv/crispert/models /srv/crispert/references
chmod -R u=rwX,g=rX,o= /srv/crispert/models /srv/crispert/references
if [ ! -f /etc/offtarget-web/runtime.env ]; then
    install -m 0640 -o root -g offtarget "$release_dir/deploy/runtime.env.example" /etc/offtarget-web/runtime.env
fi
sed -i "s/^OFFTARGET_RELEASE_ID=.*/OFFTARGET_RELEASE_ID=$release_id/" /etc/offtarget-web/runtime.env
ln -sfn "$release_dir" /srv/crispert/current
install -m 0644 "$release_dir/deploy/offtarget-api.service" /etc/systemd/system/offtarget-api.service
install -m 0644 "$release_dir/deploy/offtarget-worker.service" /etc/systemd/system/offtarget-worker.service
install -m 0644 "$release_dir/deploy/offtarget-web.nginx" /etc/nginx/sites-available/offtarget-web
ln -sfn /etc/nginx/sites-available/offtarget-web /etc/nginx/sites-enabled/offtarget-web
# The dedicated fresh VM's packaged welcome page is not part of this service.
if [ -L /etc/nginx/sites-enabled/default ]; then unlink /etc/nginx/sites-enabled/default; fi
nginx -t
systemctl daemon-reload
systemctl enable offtarget-api offtarget-worker nginx
systemctl restart offtarget-api offtarget-worker
systemctl reload nginx
systemctl is-active offtarget-api offtarget-worker nginx
