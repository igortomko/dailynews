#!/usr/bin/env bash
# Развёртывание ленты на общую машину.
#
# Машина общая: рядом живут чужие продукты. Поэтому здесь нет ни одной
# команды по всем контейнерам, каждая compose-команда называет свой файл,
# а rsync идёт с явными исключениями — он не читает .gitignore, и --delete
# без них сносит .env.production вместе с данными.
set -euo pipefail

HOST=${HOST:-root@91.108.126.101}
DIR=/opt/dailynews
DOMAIN=news.tomko.io
COMMIT=$(git rev-parse HEAD)

echo "→ коммит $COMMIT"

if [ -n "$(git status --porcelain)" ]; then
  echo "! рабочая копия грязная — разворачивается только то, что в git" >&2
  exit 1
fi

echo "→ отправка файлов"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.production' \
  --exclude 'magazines' \
  --exclude 'legacy' \
  --exclude 'supabase' \
  ./ "$HOST:$DIR/"

ssh "$HOST" "cp $DIR/deploy/docker-compose.yml $DIR/docker-compose.yml"

echo "→ сборка и переключение"
ssh "$HOST" "cd $DIR && GIT_COMMIT=$COMMIT docker compose -f $DIR/docker-compose.yml up -d --build"

echo "→ страница сайта в Caddy"
ssh "$HOST" "cp $DIR/deploy/$DOMAIN.caddy /etc/caddy/sites/$DOMAIN.caddy && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy"

echo "→ проверка: обслуживает ли запущенный контейнер отправленный код"
for attempt in $(seq 1 20); do
  SERVED=$(ssh "$HOST" "curl -fsS --max-time 5 http://127.0.0.1:8085/api/version 2>/dev/null" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' || true)
  [ "$SERVED" = "$COMMIT" ] && break
  sleep 3
done

if [ "${SERVED:-}" != "$COMMIT" ]; then
  echo "! запущен код $SERVED, отправлен $COMMIT — переключение не состоялось" >&2
  ssh "$HOST" "docker compose -f $DIR/docker-compose.yml logs --tail 40 web" >&2
  exit 1
fi

echo "✓ $DOMAIN обслуживает $COMMIT"
ssh "$HOST" "docker inspect --format '{{.Name}} {{.State.Health.Status}} mem={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}} ro={{.HostConfig.ReadonlyRootfs}}' dailynews"
