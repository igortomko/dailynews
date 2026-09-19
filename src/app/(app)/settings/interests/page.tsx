import { getAllTopics, getDigestDays, getFeed, getProfile } from "@/lib/queries";
import { InterestsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const [topics, profile, days] = await Promise.all([getAllTopics(), getProfile(), getDigestDays()]);
  // Сколько материалов в последнем выпуске: по нему решается, есть ли что
  // догружать после смены числа новостей.
  const inToday = days[0] ? (await getFeed(days[0])).length : 0;
  return (
    <InterestsForm
      total={profile.digest_size}
      inToday={inToday}
      chips={topics
        .filter((topic) => topic.active)
        .map((topic) => ({
          slug: topic.slug,
          label: topic.label,
          hint: topic.hint,
          count: topic.weight,
        }))}
    />
  );
}
