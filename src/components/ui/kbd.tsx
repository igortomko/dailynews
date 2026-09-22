import { cn } from "@/lib/utils";

/**
 * Клавиша в квадратике. Один вид на все места, где она называется: строка
 * подсказок под лентой и тултипы кнопок. Две копии стиля разъехались бы
 * с первой правкой любой из них, а клавиша, нарисованная по-разному
 * в двух местах одного экрана, читается как две разные клавиши.
 *
 * Рамка и фон от текущего цвета, а не от палитры: тултип рисует светлое
 * по тёмному, лента — тёмное по светлому, и фиксированный `border-border`
 * на тёмном фоне не виден вовсе.
 */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "rounded border border-current/30 bg-current/10 px-1 py-0.5 font-mono text-[0.7rem] leading-none",
        className,
      )}
      {...props}
    />
  );
}
