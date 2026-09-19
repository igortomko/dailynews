import { getDigestDays, getFeed } from "@/lib/queries";
import { getReaderTopics } from "@/lib/readers";
import { currentReader } from "@/lib/session";

import { effectivePlan } from "@/lib/lemon";
import { InterestsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const reader = await currentReader();
  const [topics, days] = await Promise.all([
    getReaderTopics(reader.id),
    getDigestDays(reader.id),
  ]);
  // Сколько материалов в последнем выпуске: по нему решается, есть ли что
  // догружать после смены числа новостей.
  const inToday = days[0] ? (await getFeed(reader.id, days[0])).length : 0;
  return (
    <InterestsForm
      total={reader.digest_size}
      inToday={inToday}
      plan={effectivePlan(reader)}
      chips={topics.map((topic) => ({
        slug: topic.slug,
        label: topic.label,
        hint: topic.hint,
        count: topic.weight,
      }))}
    />
  );
}
