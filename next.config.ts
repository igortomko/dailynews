import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Образ для VPS: standalone кладёт в сборку только нужные модули,
  // иначе в контейнер едет весь node_modules.
  output: "standalone",
  /* config options here */
};

export default nextConfig;
