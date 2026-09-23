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
DOMAIN=news.reporta.club
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
# Замком здесь был flock внутри ssh — и он не держал ничего: ssh выходит
# сразу, а вместе с ним отпускается и замок. Выглядело это как работающая
# защита ровно до 19 сентября 2026, когда две сессии развернулись с разницей
# в минуту, и на проде осталась чужая ветка под чужим же коммитом.
#
# Каталог, а не файл: mkdir атомарен и на общей машине, и по ssh. Внутри —
# кто держит и с какого времени: «замок занят» без имени держателя
# не отличается от зависшего замка.
echo "→ замок развёртывания"
LOCK=$DIR/.deploy.lock.d
if ! ssh "$HOST" "mkdir -p $DIR && mkdir $LOCK 2>/dev/null"; then
  HOLDER=$(ssh "$HOST" "cat $LOCK/who 2>/dev/null" || true)
  # Брошенный замок: сессию могли прервать посреди развёртывания, и тогда
  # каталог остался бы навсегда. Двадцати минут хватает самой долгой сборке.
  if ssh "$HOST" "[ -n \"\$(find $LOCK -maxdepth 0 -mmin +20 2>/dev/null)\" ]"; then
    echo "  ~ замок брошен (${HOLDER:-неизвестно кем}), забираю" >&2
    ssh "$HOST" "rm -rf $LOCK && mkdir $LOCK"
  else
    echo "! рядом уже разворачивается ${HOLDER:-другая сессия}. Подожди её." >&2
    exit 1
  fi
fi
ssh "$HOST" "echo '$COMMIT ($(date -u +%H:%M) UTC)' > $LOCK/who"
trap 'ssh "$HOST" "rm -rf $LOCK" >/dev/null 2>&1 || true' EXIT

# Прод не должен ехать назад.
#
# Замок разводит две сессии во времени, но не мешает развернуть ветку,
# отпочкованную до чужого слияния: 19 сентября 2026 прод трижды за час терял
# уже влитую в main работу — каждый раз «успешно», с зелёной проверкой
# в конце. Поэтому проверяется не порядок во времени, а содержание:
# разворачиваемый коммит обязан содержать вершину main. Не содержит —
# значит на проде окажется меньше, чем в main, и это всегда ошибка,
# а не решение.
echo "→ проверка: не откатывает ли выкат main"
git fetch -q origin main 2>/dev/null || true
MAIN=$(git rev-parse origin/main 2>/dev/null || true)
if [ -n "${MAIN:-}" ] && ! git merge-base --is-ancestor "$MAIN" HEAD; then
  echo "! $COMMIT не содержит вершину main ($MAIN)." >&2
  echo "  Выкат увёз бы прод назад — влитая работа соседей исчезла бы молча." >&2
  echo "  Сначала: git merge origin/main" >&2
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

# Переменные модели жили только у прогона в Actions, а веб зовёт ту же модель
# из догрузки выпуска, отправки статьи на читалку и блогерских постов. На проде
# их не было, и отказ выглядел как успех: догрузка молча отдавала описания
# на языке источника, потому что writeDigest без ключа возвращает исходные
# заголовки. Поэтому окружение контейнера сверяется так же, как схема базы.
echo "→ проверка: есть ли у контейнера всё, что зовёт веб"
NEEDED="DATABASE_URL APP_SECRET APP_URL TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET \
POSTBOT_TOKEN POSTBOT_WEBHOOK_SECRET TELEGRAM_CHAT_ID \
LLM_API_KEY LLM_BASE_URL LLM_MODEL TYPESAFE_API_KEY RESEND_API_KEY KINDLE_FROM_DOMAIN"
MISSING=$(ssh "$HOST" "for key in $NEEDED; do grep -qs \"^\$key=.\" $DIR/.env.production || echo \$key; done")
if [ -n "$MISSING" ]; then
  echo "! в $DIR/.env.production нет: $(echo $MISSING)" >&2
  echo "  Без них веб не падает, а тихо отдаёт результат без модели." >&2
  exit 1
fi
# Рассуждение провайдера по умолчанию «high», и это вчетверо дороже на том же
# запросе (замер 19 сентября 2026: $0.0045 против $0.0011). Не отказ — выбор,
# но выбор должен быть сделан вслух.
if ! ssh "$HOST" "grep -qs '^LLM_REASONING_EFFORT=.' $DIR/.env.production"; then
  echo "  ~ LLM_REASONING_EFFORT не задан: провайдер рассуждает по умолчанию," >&2
  echo "    и каждый вызов из веба стоит вчетверо дороже" >&2
fi

# Что развёртывание заводит внутри $DIR само, то и исключается: в источнике
# этих файлов нет, а --delete сносит всё, чего там нет.
#
# Замок развёртывание отпускало себе само на первом же шаге отправки: соседняя
# сессия входила сразу за ним, её rsync сносил $DIR/docker-compose.yml у нас
# из-под ног, и следующие шаги падали на «no such file or directory» — 21 сентября
# 2026 именно так. Замок, который сам себя удаляет, выглядит работающей защитой
# ровно до второй сессии.
#
# Сам compose-файл сносился так же и возвращался шагом позже — но только
# если развёртывание до этого шага доживёт. Умерший между rsync и cp прогон
# оставлял хост без файла насовсем, и даже посмотреть логи контейнера было бы
# нечем: `docker compose -f` требует его же. Поэтому исключение с косой в начале:
# оно считается от корня передачи и не трогает исходник deploy/docker-compose.yml,
# без которого следующему cp было бы нечего копировать.
echo "→ отправка файлов"
rsync -az --delete \
  --exclude '.git' \
  --exclude '.claude' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.production' \
  --exclude '.deploy.lock.d' \
  --exclude '/docker-compose.yml' \
  --exclude 'magazines' \
  --exclude 'legacy' \
  --exclude 'supabase' \
  ./ "$HOST:$DIR/"

ssh "$HOST" "cp $DIR/deploy/docker-compose.yml $DIR/docker-compose.yml"

echo "→ сборка и переключение"
ssh "$HOST" "cd $DIR && GIT_COMMIT=$COMMIT docker compose -f $DIR/docker-compose.yml build --pull web && GIT_COMMIT=$COMMIT docker compose -f $DIR/docker-compose.yml up -d --force-recreate web"

echo "→ страница сайта в Caddy"
# Один файл на все адреса продукта: лента, корень reporta.club и редирект
# со старого news.tomko.io. Прежний файл снимается — иначе news.tomko.io
# объявлен дважды, и validate отвергает весь Caddyfile, включая соседей.
ssh "$HOST" "rm -f /etc/caddy/sites/news.tomko.io.caddy && cp $DIR/deploy/reporta.caddy /etc/caddy/sites/reporta.caddy && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy"

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

# Секреты на хосте лежат рядом с кодом, поэтому исключаются и из rsync,
# и из контекста сборки (.dockerignore). Проверяем, что в образе их нет.
#
# Спрашивается запущенный контейнер, а не compose-файл: имя образа через
# `compose images` требует файла на хосте, а тот живёт между rsync --delete
# и cp. 21 сентября 2026 соседнее развёртывание застало эту щель: compose
# ответил «no such file or directory» в stderr, на stdout не пришло ничего,
# а `grep -qv '^0$'` на пустом входе возвращает 1 — шаг засчитался
# пройденным, не проверив ничего. Контейнер к этому моменту уже отдаёт
# отправленный коммит — его /app и есть то, что собралось в образ.
#
# «Не смогли посмотреть» и «посмотрели, там пусто» — разные ответы,
# и первый останавливает развёртывание так же, как найденный секрет.
echo "→ проверка: нет ли секретов в образе"
if ! APP_FILES=$(ssh "$HOST" "docker exec dailynews ls -a /app") || [ -z "$APP_FILES" ]; then
  echo "! проверку выполнить не вышло: /app у контейнера не прочитан" >&2
  echo "  Пока список файлов не получен, о секретах в образе ничего не известно." >&2
  exit 1
fi
LEFTOVER=$(printf '%s\n' "$APP_FILES" | grep '^\.env' || true)
if [ -n "$LEFTOVER" ]; then
  echo "! в образе остались файлы .env — сборка прошла с секретами:" >&2
  printf '%s\n' "$LEFTOVER" | sed 's/^/  /' >&2
  exit 1
fi

echo "✓ $DOMAIN обслуживает $COMMIT"
ssh "$HOST" "docker inspect --format '{{.Name}} {{.State.Health.Status}} mem={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}} ro={{.HostConfig.ReadonlyRootfs}}' dailynews"
