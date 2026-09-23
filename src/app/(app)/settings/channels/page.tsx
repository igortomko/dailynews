import { currentReader } from "@/lib/session";
import { getChannels } from "@/lib/readers";
import { effectivePlan } from "@/lib/lemon";
import { allows } from "@/lib/plans";
import { PlanGate } from "@/components/plan-gate";
import { getDict } from "@/lib/i18n/server";
import { oauthNetworks } from "@/lib/social-connect";
import type { NetworkId } from "@/lib/networks";
import { ChannelsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string; failed?: string }>;
}) {
  const [reader, { first, failed }] = await Promise.all([currentReader(), searchParams]);
  const plan = effectivePlan(reader);

  // Заглушка, а не редирект: читатель должен увидеть, что раздел есть
  // и чего он стоит. Молча вернуть на ленту — отказ, похожий на поломку.
  if (!allows(plan, "posts")) {
    const t = await getDict();
    return (
      <PlanGate
        section="posts"
        plan={plan}
        title={t.nav.channels}
        what={t.plans.feature.posts.what}
      />
    );
  }

  return (
    <ChannelsForm
      channels={await getChannels(reader.id)}
      card={reader.voice_card}
      builtAt={reader.voice_built_at}
      sample={reader.voice_sample}
      oauth={oauthNetworks()}
      failed={failed as NetworkId | undefined}
      onboarding={first === "1"}
    />
  );
}
