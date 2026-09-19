import { redirect } from "next/navigation";
import { currentReader } from "@/lib/session";
import { getReaderTopics } from "@/lib/readers";
import { effectivePlan } from "@/lib/lemon";
import { onboardingStep, suggestSources, topicOptions } from "@/lib/onboarding";
import { InterestsStep, ReadyStep, SourcesStep } from "./wizard";

export const dynamic = "force-dynamic";

/**
 * Первый заход. Три шага, и ни один не спрашивает того, что лента может
 * решить сама: размер выпуска берётся из тарифа, веса тем — поровну,
 * язык и манера остаются по умолчанию. Всё это правится потом, а на входе
 * каждое лишнее решение — это место, где человек закрывает вкладку.
 *
 * Шаг считается по данным, а не хранится: перезагрузка на середине
 * возвращает ровно туда, где читатель остановился.
 */
export default async function WelcomePage() {
  const reader = await currentReader();
  if (reader.onboarded_at) redirect("/");

  const plan = effectivePlan(reader);
  const step = await onboardingStep(reader.id);

  if (step === "interests") {
    return (
      <InterestsStep
        plan={plan}
        options={topicOptions()}
        // Порядок из описания в Telegram, разобранного при заведении.
        // Пусто — обычный порядок каталога: описание есть не у всех.
        ranked={reader.suggested_topics}
      />
    );
  }

  const topics = await getReaderTopics(reader.id);

  if (step === "sources") {
    return (
      <SourcesStep
        plan={plan}
        topics={topics.map((topic) => topic.label)}
        suggestions={await suggestSources(reader.id, topics.map((topic) => topic.slug), plan)}
      />
    );
  }

  return <ReadyStep plan={plan} topics={topics.length} />;
}
