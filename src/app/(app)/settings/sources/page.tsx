import { getSourceHealth } from "@/lib/queries";
import { currentReader } from "@/lib/session";
import { effectivePlan } from "@/lib/billing";
import { SourcesManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  // Каталог общий, выбор личный: список — это то, из чего собирают выпуск
  // именно этому читателю. Чужая строка здесь выглядела бы как источник
  // его ленты и им не была бы.
  const reader = await currentReader();
  return (
    <SourcesManager
      sources={await getSourceHealth(reader.id)}
      plan={effectivePlan(reader)}
    />
  );
}
