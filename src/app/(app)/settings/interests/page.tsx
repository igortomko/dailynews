import { digestProgress, getReaderTopics, perCardOf } from "@/lib/readers";
import { currentReader } from "@/lib/session";

import { effectivePlan, effectiveVoice } from "@/lib/lemon";
import { minutesOf } from "@/lib/reading-time";
import { asNames } from "@/lib/rules";
import { formChipOf } from "@/lib/starter-topics";
import { InterestsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const reader = await currentReader();
  const [topics, digest] = await Promise.all([
    getReaderTopics(reader.id),
    // Сколько времени в последнем выпуске: по нему решается, есть ли что
    // догружать после того, как заказ подняли. По всему выпуску, а не по
    // видимой ленте: скрытая пальцем вниз карточка предлагала бы добрать
    // то, что читатель только что убрал.
    digestProgress(reader.id, null),
  ]);
  const voice = effectiveVoice(reader);
  const inToday = minutesOf(digest.chars, voice);
  return (
    <InterestsForm
      minutes={reader.digest_minutes}
      // Мерка этого читателя: его же описания за месяц. Форма делит ею
      // заказ на места — той же функцией, что и прогон.
      perCard={await perCardOf(reader)}
      inToday={inToday}
      plan={effectivePlan(reader)}
      // Из колонки как есть: строку вместо массива (урок 0005) разбирает
      // asNames, чтобы форма не упала на битой записи.
      follow={asNames(reader.follow_rules)}
      exclude={asNames(reader.exclude_rules)}
      // Тем же переводом, каким действие отдаёт темы после записи: форма
      // и до, и после сохранения показывает то, что лежит в базе.
      chips={topics.map(formChipOf)}
    />
  );
}
