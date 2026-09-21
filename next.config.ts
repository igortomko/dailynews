import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Образ для VPS: standalone кладёт в сборку только нужные модули,
  // иначе в контейнер едет весь node_modules.
  output: "standalone",
  // Сжатие отдаётся Caddy на хосте (`encode zstd gzip` в deploy/*.caddy):
  // у контейнера половина ядра, и gzip 640 КБ ленты на каждый показ
  // шёл из того же бюджета, что и рендер. Caddy сжимает то, что пришло
  // несжатым, а на петле 127.0.0.1 сжимать нечего и незачем.
  compress: false,
  experimental: {
    // Уже открытый выпуск не спрашивается у сервера повторно полминуты:
    // листание «вчера — сегодня — вчера» второй раз проходит без запроса.
    // Ноль по умолчанию появился в Next 15; до этого те же тридцать секунд
    // были нормой. Сохранения настроек и пересборка выпуска кэш сбрасывают
    // сами (`revalidatePath`, `router.refresh`).
    staleTimes: { dynamic: 30 },
  },
  async redirects() {
    return [{ source: "/brand", destination: "/brand/index.html", permanent: false }];
  },
};

export default nextConfig;
