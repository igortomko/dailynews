import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Образ для VPS: standalone кладёт в сборку только нужные модули,
  // иначе в контейнер едет весь node_modules.
  output: "standalone",
  // Сжатие отдаётся Caddy на хосте (`encode zstd gzip` в deploy/*.caddy):
  // у контейнера одно ядро, и gzip 640 КБ ленты на каждый показ
  // шёл из того же бюджета, что и рендер. Caddy сжимает то, что пришло
  // несжатым, а на петле 127.0.0.1 сжимать нечего и незачем.
  compress: false,
  // Кэш роутера на клиенте (`experimental.staleTimes`) намеренно не включён.
  // Повторное открытие того же дня стало бы мгновенным, но скрытие карточки
  // и отправка на Kindle идут через /api/read и /api/kindle мимо серверных
  // действий, и кэш о них не узнаёт: скрытая карточка возвращалась бы при
  // следующем заходе в ленту в течение всего окна.
  async redirects() {
    return [{ source: "/brand", destination: "/brand/index.html", permanent: false }];
  },
};

export default nextConfig;
