import { getSources } from "@/lib/queries";
import { currentReader } from "@/lib/session";
import { SourcesManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  // Каталог общий: его видят все, правит владелец. Кнопка, которой нельзя
  // воспользоваться, хуже её отсутствия — поэтому решает страница, а не
  // только действие.
  const [reader, sources] = await Promise.all([currentReader(), getSources()]);
  return <SourcesManager sources={sources} editable={reader.owner} />;
}
