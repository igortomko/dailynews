"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Иллюстрация из бренд-бука.
 *
 * Два файла на картинку — чернила чёрные и белые, прозрачный фон, —
 * и подходит ровно один: README бренда прямо запрещает инвертировать
 * изображение целиком. Тема берётся из next-themes, а не из
 * `prefers-color-scheme`: приложение переключается классом, и системная
 * медиа-проверка показала бы чужую тему тому, кто выбрал её руками.
 *
 * До монтирования не рисуется ничего: на сервере выбранной темы нет,
 * и любой выбор там — это вспышка не тем цветом при первом кадре.
 * Место под картинку резервируется заранее, поэтому текст под ней
 * не прыгает.
 *
 * `preview/` вместо `light/`: 640 пикселей и 164 КБ против 1254 и 640 КБ.
 * Экран, на котором она появляется, ждёт ответа модели, а не картинку.
 */
export function BrandIllustration({
  name,
  alt,
  className,
  size = 200,
}: {
  name: string;
  alt: string;
  className?: string;
  size?: number;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className={className} style={{ width: size, height: size }} aria-hidden={!mounted}>
      {mounted ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/brand/illustrations/preview/${name}-${resolvedTheme === "dark" ? "dark" : "light"}.webp`}
          alt={alt}
          width={size}
          height={size}
          className="h-full w-full object-contain"
        />
      ) : null}
    </div>
  );
}
