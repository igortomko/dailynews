# Сборка и запуск разделены: в финальный образ не едут ни исходники,
# ни девелоперские зависимости, ни кэш npm.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# Коммит объявлен до сборки, а не только в финальной стадии. ARG в финальной
# стадии не входит в ключ кэша стадии сборки: 19 сентября 2026 это дало образ,
# где /api/version отдавал новый коммит поверх артефактов старого, и проверка
# «обслуживает ли запущенный контейнер отправленный код» сравнивала переменную
# окружения сама с собой. Развёртывание отчиталось успехом на лежащем сайте.
# Здесь новый коммит — новый ключ кэша, и артефакты всегда его.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
COPY . .
# Переменные нужны только чтобы сборка прошла: страницы динамические,
# настоящие значения приходят из env_file при запуске.
ENV APP_SECRET=build-time-placeholder-not-used-at-runtime
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
RUN npm run build

FROM node:22-alpine AS run
# Коммит вшивается в образ: после переключения развёртывание спрашивает
# его у живого сервиса и сверяет с отправленным. Тег на хосте исчезает
# при пересоздании контейнера, ответ сервиса — нет.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
