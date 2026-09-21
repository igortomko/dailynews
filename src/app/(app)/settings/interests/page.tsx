import { getDigestDays, getFeed } from "@/lib/queries";
import { getReaderTopics, perCardOf } from "@/lib/readers";
import { currentReader } from "@/lib/session";

import { effectivePlan, effectiveVoice } from "@/lib/lemon";
import { digestMinutes } from "@/lib/reading-time";
import { InterestsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const reader = await currentReader();
  const [topics, days] = await Promise.all([
    getReaderTopics(reader.id),
    getDigestDays(reader.id),
  ]);
  const voice = effectiveVoice(reader);
  // Сколько времени в последнем выпуске: по нему решается, есть ли что
  // догружать после того, как заказ подняли.
  const items = days[0] ? await getFeed(reader.id, days[0]) : [];
  const inToday = digestMinutes(items, voice);
  return (
    <InterestsForm
      minutes={reader.digest_minutes}
      // Мерка этого читателя: его же описания за месяц. Форма делит ею
      // заказ на места — той же функцией, что и прогон.
      perCard={await perCardOf(reader)}
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
