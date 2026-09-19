import { currentReader } from "@/lib/session";
import { getChannels } from "@/lib/readers";
import { effectivePlan } from "@/lib/lemon";
import { allows, FEATURES } from "@/lib/plans";
import { PlanGate } from "@/components/plan-gate";
import { ChannelsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string }>;
}) {
  const [reader, { first }] = await Promise.all([currentReader(), searchParams]);
  const plan = effectivePlan(reader);

  // Заглушка, а не редирект: читатель должен увидеть, что раздел есть
  // и чего он стоит. Молча вернуть на ленту — отказ, похожий на поломку.
  if (!allows(plan, "posts")) {
    return (
      <PlanGate
        section="posts"
        plan={plan}
        title="Мои площадки"
        what={FEATURES.posts.what}
      />
    );
  }

  return (
    <ChannelsForm
      channels={await getChannels(reader.id)}
      card={reader.voice_card}
      builtAt={reader.voice_built_at}
      sample={reader.voice_sample}
      onboarding={first === "1"}
    />
  );
}
