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

# Код, уехавший раньше миграции, роняет страницу на несуществующей колонке,
# и заметно это только при нажатии на ту самую настройку. Проверка идёт
# до отправки: развернуть и потом узнать — значит держать прод сломанным.
echo "→ проверка: знает ли база то, что требует код"
if ! npx tsx --env-file=.env db/ping.ts > /tmp/dailynews-ping.log 2>&1; then
  tail -20 /tmp/dailynews-ping.log >&2
  echo "! база отстаёт от кода — применяй миграции до развёртывания" >&2
  exit 1
fi

# Сессий несколько, машина одна. Два развёртывания внахлёст дают образ,
# собранный из файлов одной ветки поверх артефактов другой: 19 сентября 2026
# так получился контейнер, где /api/version отдавал новый коммит, а бандл
# содержал старые запросы к снесённой таблице. Отказ выглядел как успех —
# проверка «обслуживает ли отправленный код» сравнивала переменную окружения,
# а не код. Поэтому весь заход идёт под замком на хосте.
echo "→ замок развёртывания"
exec 9>/tmp/dailynews-deploy.lock
if ! ssh "$HOST" "mkdir -p $DIR && exec 9>$DIR/.deploy.lock && flock -w 600 -n 9 || flock -w 600 9"; then
  echo "! не удалось взять замок развёртывания на $HOST" >&2
  exit 1
fi

# Чей код сейчас живёт на проде. Не наш предок — значит рядом работает
# другая сессия, и мы перекрываем её ветку. Не отказ: чья ветка должна быть
# на проде, решает владелец, а не скрипт. Но молчать об этом нельзя.
LIVE=$(ssh "$HOST" "curl -fsS --max-time 5 http://127.0.0.1:8085/api/version 2>/dev/null" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' || true)
if [ -n "${LIVE:-}" ] && [ "$LIVE" != "$COMMIT" ] && ! git merge-base --is-ancestor "$LIVE" HEAD 2>/dev/null; then
  echo "! прод обслуживает $LIVE — это не предок $COMMIT." >&2
  echo "  Рядом развёртывается другая ветка; сейчас её код будет заменён." >&2
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
ssh "$HOST" "cd $DIR && GIT_COMMIT=$COMMIT docker compose -f $DIR/docker-compose.yml build --pull web && GIT_COMMIT=$COMMIT docker compose -f $DIR/docker-compose.yml up -d --force-recreate web"

echo "→ страница сайта в Caddy"
ssh "$HOST" "cp $DIR/deploy/$DOMAIN.caddy /etc/caddy/sites/$DOMAIN.caddy && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy"

# Секреты на хосте лежат рядом с кодом, поэтому исключаются и из rsync,
# и из контекста сборки (.dockerignore). Проверяем, что в образе их нет.
echo "→ проверка: нет ли секретов в образе"
if ssh "$HOST" "docker run --rm --entrypoint sh \$(docker compose -f $DIR/docker-compose.yml images -q web) -c 'ls -a /app | grep -c \"^\\.env\"' 2>/dev/null" | grep -qv '^0$'; then
  echo "! в образе остались файлы .env — сборка прошла с секретами" >&2
  exit 1
fi

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
