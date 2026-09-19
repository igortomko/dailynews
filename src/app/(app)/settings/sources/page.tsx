import { getSources } from "@/lib/queries";
import { currentReader } from "@/lib/session";
import { planOf } from "@/lib/plans";
import { SourcesManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  // Каталог общий на всех читателей, тариф — личный. Видят все, правит
  // владелец: удаление источника уносит каскадом собранные материалы,
  // и у такой кнопки не должно быть ста рук.
  const [reader, sources] = [await currentReader(), await getSources()];
  return <SourcesManager sources={sources} plan={planOf(reader.plan)} editable={reader.owner} />;
}
