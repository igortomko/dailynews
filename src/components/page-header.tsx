/**
 * Полоса во всю ширину, содержимое по колонке текста. Шапка, обрезанная
 * по колонке, висит посреди серого поля и не читается как край экрана;
 * полоса от края до края даёт ленте верхнюю границу.
 */
export function PageHeader({
  left,
  right,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-3xl items-center justify-between gap-3 px-4">
        {left}
        {right}
      </div>
    </header>
  );
}
