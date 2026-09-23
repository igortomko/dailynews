import { currentReader } from "@/lib/session";
import { getChannels } from "@/lib/readers";
import { effectivePlan } from "@/lib/lemon";
import { allows } from "@/lib/plans";
import { PlanGate } from "@/components/plan-gate";
import { getDict } from "@/lib/i18n/server";
import { oauthNetworks } from "@/lib/social-connect";
import type { NetworkId } from "@/lib/networks";
import { asCard, cardText } from "../../../../../pipeline/voice-card";
import { ChannelsForm } from "./form";

const cardTextOf = (row: unknown) => {
  const card = asCard(row);
  return card ? cardText(card) : "";
};

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
      styleEnabled={reader.voice_enabled}
      // Собранным до свитчера текста ещё нет — показываем их карточку
      // текстом: ровно она и уходит в промпт (`draftStyle`).
      styleText={reader.voice_skill || cardTextOf(reader.voice_card)}
      sample={reader.voice_sample}
      oauth={oauthNetworks()}
      failed={failed as NetworkId | undefined}
      onboarding={first === "1"}
    />
  );
}
