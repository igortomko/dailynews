import { getSourceHealth } from "@/lib/queries";
import { currentReader } from "@/lib/session";
import { planOf } from "@/lib/plans";
import { effectivePlan } from "@/lib/lemon";
import { SourcesManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  // Каталог общий на всех читателей, тариф — личный. Видят все, правит
  // владелец: удаление источника уносит каскадом собранные материалы,
  // и у такой кнопки не должно быть ста рук.
  // Параллельно, а не подряд: запросы не зависят друг от друга, а до пулера
  // каждый заход стоит своей задержки.
  const [reader, sources] = await Promise.all([currentReader(), getSourceHealth()]);
  return <SourcesManager sources={sources} plan={effectivePlan(reader)} editable={reader.owner} />;
}
