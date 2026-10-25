#!/usr/bin/env bash
# Cek bentrok SEBELUM `docker compose up`. Aman: hanya membaca, tidak mengubah apa pun.
# Jalankan dari folder proyek:  bash deploy/preflight.sh
set -u
cd "$(dirname "$0")/.."
RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; RST=$'\e[0m'
fail=0
ok()   { echo "${GRN}OK  ${RST} $*"; }
warn() { echo "${YEL}CEK ${RST} $*"; }
bad()  { echo "${RED}GAGAL${RST} $*"; fail=1; }

command -v docker >/dev/null || { bad "docker tidak ditemukan"; exit 1; }
docker compose version >/dev/null 2>&1 && ok "docker compose tersedia" || bad "docker compose (plugin v2) tidak tersedia"

[ -f .env ] || { bad ".env belum ada (cp .env.example .env lalu isi)"; exit 1; }
# baca variabel dari .env tanpa meng-source (nilai bisa mengandung karakter khusus)
getv() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }
PORT="$(getv AGENT_PORT)"; PORT="${PORT:-3210}"
SECRET="$(getv MCP_SECRET)"
PROXYNET="$(getv PROXY_NETWORK)"

# 1. rahasia
[ "${#SECRET}" -ge 16 ] && ok "MCP_SECRET terisi (${#SECRET} karakter)" || bad "MCP_SECRET kosong / kurang dari 16 karakter"
perm=$(stat -c %a .env 2>/dev/null || echo "?")
[ "$perm" = "600" ] || warn ".env berizin $perm; disarankan: chmod 600 .env"

# 2. port host
own=$(docker ps --filter name=^delova-shopee-agent$ --format '{{.Ports}}' | grep -c "127.0.0.1:$PORT->" || true)
inuse=0
if command -v ss >/dev/null; then
  ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . && inuse=1
elif (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then inuse=1; fi   # tanpa ss: berhasil konek = ada yang mendengarkan
if [ "$inuse" -eq 1 ]; then
  [ "$own" -ge 1 ] && ok "port $PORT dipakai container ini sendiri (update)" || bad "port $PORT SUDAH dipakai proses lain. Isi AGENT_PORT=<port bebas> di .env"
else ok "port 127.0.0.1:$PORT bebas"; fi

# 3. nama container
for n in delova-shopee-agent delova-shopee-agent-redis; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$n"; then
    proj=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$n" 2>/dev/null)
    [ "$proj" = "delova-shopee-agent" ] && ok "container $n milik project ini (update)" || bad "nama container $n sudah dipakai project lain ($proj)"
  else ok "nama container $n bebas"; fi
done

# 4. volume & network
docker volume ls -q | grep -qx "delova-shopee-agent_redis-data" && ok "volume redis-data sudah ada (data lama dipakai ulang)" || ok "volume baru akan dibuat: delova-shopee-agent_redis-data"
if [ -n "$PROXYNET" ]; then
  docker network ls --format '{{.Name}}' | grep -qx "$PROXYNET" && ok "network proxy '$PROXYNET' ada" || bad "network proxy '$PROXYNET' tidak ditemukan (docker network ls)"
  # alias tabrakan di network proxy?
  if docker network inspect "$PROXYNET" >/dev/null 2>&1; then
    clash=$(docker network inspect "$PROXYNET" -f '{{range .Containers}}{{.Name}} {{end}}' | tr ' ' '\n' | grep -vx 'delova-shopee-agent' | grep -x 'delova-shopee-agent' || true)
    [ -z "$clash" ] && ok "alias delova-shopee-agent bebas di network $PROXYNET"
  fi
else
  warn "PROXY_NETWORK kosong: mode host-port (proxy di host). Bila Caddy berjalan di Docker, isi PROXY_NETWORK + COMPOSE_FILE (lihat DEPLOY-VPS.md)"
fi

# 5. domain/port lain yang sedang berjalan (info)
echo; echo "Container lain yang sedang berjalan (pastikan tidak ada yang memakai port $PORT):"
docker ps --format '  {{.Names}}\t{{.Ports}}' | grep -v 'delova-shopee-agent' || true

# 6. memori
if [ -r /proc/meminfo ]; then
  avail=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)
  swap=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  if [ "$avail" -lt 1200 ] && [ "$swap" -lt 1024 ]; then warn "RAM bebas ${avail} MB & swap ${swap} MB: build bisa gagal (OOM). Tambah swap 1-2 GB atau build di mesin lain"; else ok "RAM bebas ${avail} MB, swap ${swap} MB (cukup untuk build)"; fi
fi
df -Pm . | awk 'NR==2 { if ($4 < 2500) print "\033[33mCEK \033[0m ruang disk bebas " $4 " MB (disarankan >= 2.5 GB untuk build)"; else print "\033[32mOK  \033[0m ruang disk bebas " $4 " MB" }'

# 7. validasi compose
docker compose config -q 2>/tmp/preflight-compose.err && ok "docker-compose valid" || { bad "docker-compose tidak valid:"; cat /tmp/preflight-compose.err; }

echo
[ "$fail" -eq 0 ] && echo "${GRN}Siap deploy: docker compose up -d --build${RST}" || { echo "${RED}Ada yang harus diperbaiki sebelum deploy.${RST}"; exit 1; }
