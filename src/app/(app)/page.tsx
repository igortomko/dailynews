import { redirect } from "next/navigation";
import { getDigestDays, getFeed, getStories, getUpgradeFacts } from "@/lib/queries";
import { applyRules, rulesOf } from "@/lib/rules";
import { feedWindow, isDay } from "@/lib/day";
import { CLICKBAIT_LABEL_NOUL } from "@/lib/types";
import { parseStoredReading } from "@/lib/reading-document";
import { digestProgress, getChannels, getReaderTopics, readerSources } from "@/lib/readers";
import { currentReader } from "@/lib/session";
import { effectivePlan, effectiveVoice, hasFounderDiscount } from "@/lib/lemon";
import { langTagFor } from "@/lib/voice";
import { FOUNDER_DISCOUNT, billingOn, founderGraceEnds, isFounder, issuesToday, sourcesForPlan } from "@/lib/plans";
import { upgradeNote, upgradeReason } from "@/lib/upgrade";
import { charsForMinutes, minutesOf, savedMinutes } from "@/lib/reading-time";
import { publishedIn, tabsOf } from "@/lib/networks";
import { FeedTabs } from "@/components/feed-tabs";
import Link from "next/link";
import { DateNav } from "@/components/date-nav";
import { CollectNow } from "@/components/collect-now";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { dictOf, localeOf } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function FeedPage({
  searchParams,
}: {
  // Повторённый параметр приезжает массивом (урок поиска): объявить его
  // строкой значит отдать массив в запрос и получить 500 вместо ленты.
  searchParams: Promise<{ day?: string | string[]; days?: string | string[]; minutes?: string | string[] }>;
}) {
  // Чья это лента, решает подписанная кука и ничто другое.
  const reader = await currentReader();
  // Первый заход идёт своим путём: интересы, источники, первый выпуск.
  if (!reader.onboarded_at) redirect("/welcome");

  // Словарь — из уже загруженной строки, а не отдельным запросом: соединений
  // в пуле пять, и ещё один круг ради того, что уже в руках, поставил бы
  // ленту в очередь за самой собой.
  const t = dictOf(reader.ui_language);

  const params = await searchParams;
  // Похожее на день, но не день («2026-02-31», пустая строка, массив) —
  // это null, то есть последний выпуск: в запрос день уходит кастом к date,
  // и непроверенная строка из чужой ссылки роняла бы страницу.
  const requested = isDay(params.day) ? params.day : null;
  // Окно и заказ времени — из того же адреса и тем же правилом, каким их
  // туда пишут стрелки, календарь и дропдаун минут (`feedHref`).
  const { days: span, minutes: limit } = feedWindow(params);
  const voice = effectiveVoice(reader);
  // Заказ переводится в знаки здесь, а не в запросе: мерка скорости зависит
  // от языка и сложности этого читателя, и в SQL она была бы второй копией.
  const maxChars = limit === null ? null : charsForMinutes(limit, voice);
  const slice = { days: span, maxChars };
  // Всё одним кругом до базы, включая сам выпуск: раньше лента ждала список
  // дней, чтобы проверить запрошенный, и только потом шла за выпуском —
  // лишний круг на каждом показе ради ссылки на день, которого нет. Теперь
  // выпуск спрашивается сразу за запрошенный день (null — за последний),
  // а день сверяется со списком уже по пришедшему: не сошёлся — второй
  // запрос, и платит за него только чужая ссылка на день без выпуска.
  //
  // Выпуск и заказ стоят первыми: соединений в пуле пять, запросов шесть,
  // и в очереди оказывается написанный последним — пусть это будет список
  // площадок, а не сама лента.
  const [asked, askedDigest, days, topics, sources, channels] = await Promise.all([
    getFeed(reader.id, requested, slice),
    // Время и заказ — по самому выпуску, а не по тому, что осталось видимым:
    // лента прячет скрытое пальцем вниз, и выпуск, из которого читатель убрал
    // три карточки, объявлял бы себя недобранным. Заказ берётся того дня,
    // а не сегодняшний: лента листается на девяносто дней назад.
    digestProgress(reader.id, requested),
    getDigestDays(reader.id),
    getReaderTopics(reader.id),
    readerSources(reader.id),
    getChannels(reader.id),
  ]);
  // Действующий, а не купленный: у отменённой подписки оплаченный месяц
  // дочитывается, и кнопка обязана жить ровно столько же, сколько предел.
  const plan = effectivePlan(reader);
  const networks = tabsOf(publishedIn(channels)).map((network) => network.id);

  if (days.length === 0) {
    return (
      <Empty className="mx-auto max-w-page">
        <EmptyHeader>
          <EmptyTitle>{t.feed.page.empty.title}</EmptyTitle>
          <EmptyDescription>
            {/* Читателю — когда ждать и чем занять это время. Команда
                в терминал — инструкция разработчику, и показывать её всем
                значит отвечать на вопрос «что делать» тем, чего человек
                сделать не может. Владельцу она остаётся: он-то может. */}
            {t.feed.page.empty.body}{" "}
            <Link href="/settings/interests" className="underline underline-offset-4">
              {t.feed.page.empty.fixInterests}
            </Link>{" "}
            {t.feed.page.empty.or}{" "}
            <Link href="/settings/sources" className="underline underline-offset-4">
              {t.feed.page.empty.addSources}
            </Link>
            .
            {reader.owner ? (
              <span className="mt-2 block">
                {t.feed.page.empty.collectNow}
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">npm run pipeline</code>
              </span>
            ) : null}
          </EmptyDescription>
        </EmptyHeader>
        {/* Ждать до ночи необязательно: сбор и оценка общие на всех
            и уже прошли, не хватает только письма описаний. Кнопка зовёт
            ту же догрузку, что и смена числа новостей, — и так же не умеет
            обойти ни потолок тарифа, ни дневной предел. */}
        <CollectNow />
      </Empty>
    );
  }

  // Запрошенный день принимается, только если выпуск за него есть:
  // иначе адрес из чужой ссылки открывает пустую страницу без объяснения.
  const known = requested === null || days.includes(requested);
  const day = known && requested ? requested : days[0];
  const [{ items: feed, cut, chars }, digest] = known
    ? [asked, askedDigest]
    : await Promise.all([getFeed(reader.id, day, slice), digestProgress(reader.id, day)]);
  // Окно или отсечка — и показанное перестаёт быть выпуском дня: время
  // считается по пришедшим карточкам, а не по тому, что собрал прогон.
  // При отсечке показанное и есть заказ, и `digestProgress` рассказывал бы
  // про выпуск, половины которого на экране нет.
  const whole = span === 1 && limit === null;
  const minutes = minutesOf(whole ? digest.chars : chars, voice);

  // Сюжет карточки считается по тем же источникам, по которым собран выпуск:
  // тариф уже учтён, и «твои источники» в раскрытии значит ровно то же, что
  // в отборе. Список приезжает отдельным запросом и приклеивается здесь —
  // Map через границу сервера не уходит, а сорок карточек не должны
  // спрашивать базу по одной.
  //
  // Плюс источники самих показанных карточек. Выпуск написан раньше, а набор
  // источников с тех пор мог измениться — читатель убрал один или понизил
  // тариф, и `digest_items` от этого не чистится. Без объединения карточка
  // осталась бы в ленте, но выпала бы из собственного сюжета: раскрытие
  // показало бы только чужих и пометило бы чужой повтор первоисточником.
  // Ничего лишнего это не открывает — сама карточка уже на странице.
  //
  // Number: sources.id приезжает из bigint строкой, а сюжет считает числами.
  // Личные правила поверх готового выпуска: исключённое прячется без
  // пересборки, упомянутое из «За чем следить» получает пометку.
  // Сама проверка — в `applyRules`, той же, что проверяют тесты.
  const { visible, hidden } = applyRules(feed, rulesOf(reader));

  const mine = sourcesForPlan(sources, plan).map((source) => Number(source.id));
  const shown = visible.map((item) => item.source_id);
  // Рядом с сюжетами, а не своим кругом: оба запроса всё равно ждут первый
  // круг (им нужен список источников по тарифу), и второй здесь бесплатен
  // по времени.
  const [stories, facts] = await Promise.all([
    getStories([...new Set([...mine, ...shown])], visible.map((item) => item.id)),
    getUpgradeFacts(reader.id, mine),
  ]);

  /**
   * Предел, в который читатель упёрся сегодня, — строкой под выпуском.
   *
   * Считается только для последнего выпуска: «сегодня отобрано 8 из 106»
   * на позавчерашней ленте рассказывало бы про сегодня, глядя на позавчера,
   * — ровно как фраза недобора рядом.
   */
  const upgradeFacts = {
    sources: facts.sources,
    topics: facts.topics,
    collected: facts.collected,
    kept: feed.length,
    active: facts.active,
    issuesToday: issuesToday(plan, reader.id, day),
  };
  // Только последний выпуск и только он один: на окне из пяти дней «сегодня
  // отобрано 8 из 106» рассказывает про сегодня, глядя на пять дней сразу,
  // — ровно та же ошибка, что на позавчерашней ленте. При отсечке по времени
  // недобора нет по построению: показанное и есть заказ.
  const upgrade = whole && day === days[0] ? upgradeReason(plan, upgradeFacts) : null;
  // Оси остаются на сервере: карточке нужен один ответ — кликбейт ли это.
  // Описание из фида тоже: оно нужно было правилам, а правила уже применены.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- excerpt снимается с карточки, а не читается
  const items = visible.map(({ axes, excerpt, ...item }) => ({
    ...item,
    // Описание едет в браузер только там, где карточке нечего показать
    // вместо него: при разобранном документе чтения карточка рисует его,
    // а описание не читает ни разу — сегодня это 19 КБ из ~150 на выпуск.
    // Предикат тот же, что у карточки (`parseStoredReading`): разойдись они,
    // карточка осталась бы без текста вовсе.
    summary: parseStoredReading(item.summary_document) ? null : item.summary,
    clickbait: (axes?.clickbait?.noul ?? 0) > CLICKBAIT_LABEL_NOUL,
    story: stories.get(item.id) ?? [],
  }));

  // Месяц Pro ранним — на последнем выпуске, как и строка про предел:
  // на позавчерашнем она говорила бы про сегодня.
  const grace = founderGraceEnds();
  const founder =
    grace && billingOn() && new Date() < grace && isFounder(reader.created_at) && day === days[0]
      ? {
          until: grace.toLocaleDateString(localeOf(reader.ui_language) === "en" ? "en-US" : "ru-RU", {
            day: "numeric", month: "long",
          }),
          discount: hasFounderDiscount(reader) ? FOUNDER_DISCOUNT : null,
        }
      : null;

  return (
    <FeedTabs
      day={day}
      days={span}
      minutes={limit}
      topics={topics}
      items={items}
      hidden={hidden}
      plan={plan}
      networks={networks}
      // Отбор дня — только для последнего выпуска: «из 89 отобрали 12»
      // считается по потоку последних суток, и на выпуске недельной давности
      // рассказывало бы про сегодня, глядя на позавчера.
      reading={{
        minutes,
        cut,
        picked:
          whole && day === days[0]
            ? { kept: feed.length, collected: facts.collected, saved: savedMinutes(facts.streamChars, minutes) }
            : null,
      }}
      // Предел считает сервер: числа тарифов и поток за сутки в браузер
      // не едут, туда уходит готовый ответ — та же причина, по которой оси
      // материала остаются здесь.
      upgrade={upgrade ? upgradeNote(plan, upgrade, upgradeFacts) : null}
      founder={founder}
      // Язык, которым написан текст карточек. Берётся у действующего тарифа,
      // а не из колонки: без перевода выпуск остаётся на языке источника,
      // и там тега нет — переносить чужой язык русскими правилами хуже,
      // чем не переносить вовсе.
      textLang={langTagFor(effectiveVoice(reader).language)}
      // key на элементе, уезжающем в проп: шапка ленты ставит стрелки дат
      // соседом кнопки заказа, а элемент, приехавший сюда через полезную
      // нагрузку сервера, теряет пометку «детей ровно столько, сколько
      // написано». React считает пару списком и просит ключ — в консоли
      // это выглядит как настоящая ошибка в ленте и прячет собой те,
      // что ошибки и есть.
      //
      // Тема, поиск и настройки пропом больше не едут: ничего серверного
      // в них нет, а на телефоне они прячутся под одну кнопку — развилка
      // по ширине экрана не может жить здесь, где о ширине не знают.
      left={<DateNav key="date" day={day} days={days} span={span} minutes={limit} />}
    />
  );
}
