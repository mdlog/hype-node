#!/usr/bin/env bash
# Hypenode (Sosovalue) — dijalankan di bawah pm2 agar auto-start setelah reboot.
# Mode: production (`next start -p 3002`). `next dev` compiled every route on
# first click (2–50 s, blocking all other requests) and shipped 37 MB of JS.
# Setelah mengubah kode: `npm run build && pm2 restart hypenode`.
# Butuh SESSION_PASSWORD (32+ karakter) di .env — production menolak start tanpanya.
# Resolve relative to this script so moving the repo doesn't break pm2 again.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
exec npm run start -- -p 3002
