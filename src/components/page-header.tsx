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
    <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur touch:bg-background touch:backdrop-blur-none">
      {/* На телефоне шапка выше: в ней живут кнопки, а не только подпись. */}
      <div className="mx-auto flex h-14 max-w-page items-center justify-between gap-3 px-4 sm:h-12">
        {left}
        {right}
      </div>
    </header>
  );
}
