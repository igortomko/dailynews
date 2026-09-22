"use client";

import {
  cloneElement, Fragment, useEffect, useLayoutEffect, useRef, useState,
  type ReactElement, type ReactNode,
} from "react";
import {
  ThumbsUpIcon,
  ThumbsDownIcon,
  UndoIcon,
  BookOpenIcon,
  CheckIcon,
  EllipsisIcon,
  PenLineIcon,
  PlayIcon,
  PauseIcon,
  CrownIcon,
  ChevronDownIcon,
  ShareIcon,
  HeadphonesIcon,
  EyeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { currentRate, forget, nextRate, onRate, pauseIfPlaying, playOnly } from "@/lib/audio-bus";
import { QUIET } from "@/lib/quiet";
import { parseStoredReading } from "@/lib/reading-document";
import { ReadingSummary, hasDetails } from "@/components/reading-summary";
import { typography, summaryTime } from "@/lib/typography";
import { cardChars, DEFAULT_CHARS_PER_MINUTE } from "@/lib/reading-time";
import { cheapestFor, FEATURES, type Plan } from "@/lib/plans";
import { usePaywall } from "@/components/paywall";
import { useLocale, useT } from "@/components/i18n-provider";
import { OpinionDialog } from "@/components/opinion-dialog";
import type { NetworkId } from "@/lib/networks";
import type { FeedCard } from "@/lib/queries";
import { alsoLine, otherSources, storyLines, storyTitle } from "@/lib/story";

/** Ниже этого порога материал попался на глаза, но прочитан не был. */
const SEEN_MS = 1500;
/** Долгий тап: столько же, сколько у системного выделения на iOS. */
const LONG_PRESS_MS = 500;
/** Сдвиг пальца, после которого это уже прокрутка, а не удержание. */
const LONG_PRESS_SLOP = 10;
/** Столько после отпускания пальца нажатие считается хвостом удержания. */
const LONG_PRESS_SUPPRESS_MS = 700;
/** Отклик под пальцем там, где он есть (Android); iOS его не даёт. */
const LONG_PRESS_VIBRATE_MS = 15;
const DWELL_FLOOR_MS = 4000;

/**
 * Событие калибровки.
 *
 * Отказ здесь не видит никто: запрос уходил через `void fetch` без единого
 * `catch`, и на моргнувшей сети событие просто исчезало. Калибровка потом
 * показывает отбор хуже, чем он есть, и объяснить это нечем — данных
 * о потере нет. Одна повторная попытка и строка в консоль: тост тут не
 * к месту, это не проблема читателя, но и молчать нельзя.
 */
function report(
  body: { item_id: number; event: string; dwell_ms?: number; undo?: true },
  beacon = false,
) {
  const json = JSON.stringify(body);
  // sendBeacon отдаёт false, когда очередь браузера переполнена, — тогда
  // обычный запрос. Раньше этот ответ не проверялся, и событие ухода
  // со страницы терялось ровно там, где повторить его уже нечем.
  if (beacon && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon("/api/read", new Blob([json], { type: "application/json" }))) return;
  }
  const send = () =>
    fetch("/api/read", { method: "POST", body: json, keepalive: true }).then((res) => {
      if (!res.ok) throw new Error(`ответ ${res.status}`);
    });
  void send()
    .catch(() => new Promise((resolve) => setTimeout(resolve, 1500)).then(send))
    .catch((error) => console.warn(`событие «${body.event}» не доехало:`, error));
}

/**
 * Классы для иконки, которая появляется или уходит по состоянию. Обе (все
 * три) иконки остаются в разметке, одна поверх другой: появляющаяся растёт
 * с 0.25 и теряет размытие, уходящая делает обратное. Подмена через
 * условный рендер даёт скачок ровно в тот момент, когда человек смотрит
 * на кнопку и ждёт ответа.
 */
const swap = (shown: boolean) =>
  cn(
    "size-3.5 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
    shown ? "scale-100 opacity-100 blur-0" : "scale-[0.25] opacity-0 blur-[4px]",
  );


/** Домен издания: источник ведёт на издание, заголовок — на сам материал. */
function siteOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Значок и подпись кнопки озвучки — по записи на состояние.
 *
 * Одна таблица на оба места: значок в меню и значок в панели обязаны
 * означать одно и то же, а два вложенных тернарника рядом расходятся
 * молча и читаются глазом одинаково.
 */
type AudioState = "idle" | "working" | "sent" | "playing";

/**
 * Шаг озвучки словами. Один список на тост, на тултип и на подкаст:
 * три копии одних и тех же четырёх слов разъехались бы молча, а читатель
 * увидел бы «Читаю вслух» в одном месте и «Отправляю» в другом
 * про одну и ту же работу.
 */
export const AUDIO_STEP = (
  t: ReturnType<typeof useT>,
): Record<string, string | undefined> => ({
  queued: t.feed.item.audioQueued,
  translating: t.feed.item.audioTranslating,
  speaking: t.feed.item.audioSpeaking,
  sending: t.feed.item.audioSending,
});

/** Как часто спрашиваем шаг и сколько всего ждём: пять минут. */
export const AUDIO_POLL_MS = 2000;
export const AUDIO_POLL_TIMES = 150;

// Размер задан здесь: обёртка `size-3.5` собственный размер значка
// не уменьшает, а кнопка в панели, в отличие от DropdownMenuItem,
// правила `[&_svg]:size-4` не несёт — значок вылезал бы на полный рост.
const AUDIO_ICON: Record<AudioState, ReactNode> = {
  idle: <HeadphonesIcon className="size-3.5" />,
  working: <Spinner className="size-3.5" />,
  // Готовое — это не «сделано», а «можно слушать»: галочка сообщала бы
  // о конце работы там, где начинается то, ради чего её просили.
  sent: <PlayIcon className="size-3.5" />,
  playing: <PauseIcon className="size-3.5" />,
};

const AUDIO_LABEL = (t: ReturnType<typeof useT>): Record<AudioState, string> => ({
  idle: t.feed.item.audioSpeak,
  working: t.feed.item.audioWorking,
  sent: t.feed.item.audioPlay,
  playing: t.feed.item.audioPause,
});

/**
 * Кнопка действия с подсказкой — или та же кнопка без неё, пока карточку
 * не тронули. Tooltip от base-ui стоит своих хуков и слушателей на каждой
 * из двухсот кнопок ленты, а нужен только той карточке, над которой курсор
 * или фокус. Кнопка при этом одна и та же: `render` получает её целиком,
 * поэтому классы и aria-label не расходятся между двумя состояниями.
 * `HINT` — метка на кнопке в обоих состояниях: по ней карточка узнаёт, что
 * фокус пришёл прямо на кнопку действия, и возвращает его после пересборки.
 * Одна константа на оба места, иначе имя атрибута разъехалось бы молча,
 * и проверка фокуса перестала бы срабатывать без единой ошибки компилятора.
 */
const HINT = { "data-hint": "" };
type HintButton = ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement> & Partial<typeof HINT>>;

function Hint({
  live,
  tip,
  button,
  children,
}: {
  live: boolean;
  tip: ReactNode;
  button: HintButton;
  children: ReactNode;
}) {
  if (!live) return cloneElement(button, HINT, children);
  return (
    <Tooltip>
      <TooltipTrigger render={button} {...HINT}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function ItemCard({
  item,
  showDay,
  showTopic,
  plan,
  voicing,
  networks,
  selected,
  selecting,
  onSelectedChange,
  textLang,
}: {
  item: FeedCard;
  /**
   * Называть ли день выпуска. На окне из нескольких дней обязательно:
   * без подписи позавчерашняя новость читается как сегодняшняя, и это
   * ровно та цена, которую лента платит за окно. На одном дне не нужна —
   * дата стоит в шапке и одна на все карточки.
   */
  showDay: boolean;
  showTopic: boolean;
  plan: Plan;
  /**
   * Шаг озвучки, идущей не от этой кнопки: карточку озвучивает подкаст.
   * Работа одна и та же, и показать её надо там же, где её и просили бы
   * поштучно, — иначе кнопка выглядит бездействующей ровно пока работает.
   */
  voicing?: string;
  /** Сети, отмеченные в «Моих площадках»: сколько их — столько табов. */
  networks: NetworkId[];
  /** Отмечена ли карточка для обзора. Состояние держит лента, не карточка. */
  selected: boolean;
  /** Идёт ли выбор: пока в выпуске есть хоть одна отметка, чекбоксы видны у всех. */
  selecting: boolean;
  onSelectedChange: (next: boolean) => void;
  /**
   * Язык текста выпуска — заголовка и описания, а не подписей вокруг них.
   * Переносы берутся по нему же: правила переноса у каждого языка свои,
   * и чужими словами они рвутся не там. Неизвестен — не переносим.
   */
  textLang?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  // Своё состояние, а не expanded: раскрытие описания считается чтением
  // материала и уезжает в калибровку событием «opened». Список повторов —
  // не чтение, и засчитать его за чтение значило бы подмешать в петлю
  // измерения интерес, которого не было.
  const [storyOpen, setStoryOpen] = useState(false);
  const [opinion, setOpinion] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  // Состояние живёт в карточке, а не в ленте: отправка идёт минуту,
  // и всё это время читатель обязан видеть, что она идёт. После
  // перезагрузки оно теряется — повторный тап ловит 409 от частичного
  // индекса и честно об этом говорит.
  // Начальное состояние приходит из базы, а не всегда «ещё не отправляли»:
  // отправка идёт минуту, и перезагрузка посреди неё стирала весь след.
  // Готовая озвучка переживает перезагрузку: состояние приходит с сервера,
  // как у читалки. Без этого кнопка возвращалась в «озвучить», и нажатие
  // синтезировало заново то, что уже лежит в Telegram.
  const [audio, setAudio] = useState<AudioState>(item.voiced ? "sent" : "idle");
  const [step, setStep] = useState<string | null>(null);
  // Читается сразу, а не эффектом: эффект с `setState` даёт каскадную
  // перерисовку на каждой карточке выпуска. Расхождения с сервером тут
  // быть не может — кнопка скорости появляется только на играющем звуке,
  // а на первой отрисовке ничего не играет.
  const [rate, setRate] = useState<number>(() => currentRate());
  // Скорость общая: сменил на одной карточке — соседние узнают сразу,
  // а не после перезагрузки.
  useEffect(() => onRate(setRate), []);
  // Живость карточки — ref, а не состояние: цикл опроса читает её между
  // запросами, и перерисовка ему для этого не нужна.
  const aliveRef = useRef(true);
  // Плеер заводится по первому нажатию, а не на каждой карточке выпуска:
  // пятьдесят <audio> в разметке качают метаданные и ничего не играют.
  const player = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => {
    if (player.current) {
      player.current.pause();
      forget(player.current);
    }
    player.current = null;
  }, []);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const [kindle, setKindle] = useState<"idle" | "sending" | "sent">(
    item.kindled ? "sent" : "idle",
  );
  // Меню и подсказки собираются по первому касанию, а не вместе с карточкой.
  // Пятьдесят карточек — это пятьдесят Menu и двести Tooltip от base-ui,
  // каждый со своими хуками и слушателями, и браузер собирал их при каждом
  // показе выпуска ради кнопок, которых в покое даже не видно. Подсказки
  // нужны тому, кто навёл курсор или дошёл до карточки клавишами, меню —
  // тому, кто по нему тапнул. До этого момента стоят те же кнопки без обвязки.
  const [hot, setHot] = useState(false);
  const [menuLive, setMenuLive] = useState(false);
  const article = useRef<HTMLElement>(null);
  const openedAt = useRef<number | null>(null);
  const reportedSeen = useRef(false);
  // Подпись кнопки, на которую пришёл фокус до того, как подсказки включились:
  // её пересобирают под фокусом, и фокус пропадает. После пересборки кнопка
  // с той же подписью получает его обратно — до отрисовки, чтобы обход
  // клавиатурой не заметил подмены.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!hot || refocus.current === null) return;
    const label = refocus.current;
    refocus.current = null;
    for (const button of article.current?.querySelectorAll<HTMLElement>("[data-hint]") ?? []) {
      if (button.getAttribute("aria-label") === label) {
        button.focus({ preventScroll: true });
        break;
      }
    }
  }, [hot]);

  // Долгий тап отмечает карточку для обзора. На телефоне чекбокс виден,
  // но удержание — жест, которым выбирают строки в почте и мессенджерах,
  // и рука тянется к нему раньше, чем глаз находит квадрат. Только с пальца:
  // у мыши есть чекбокс и клавиша x, а удержание кнопки там ничего не значит.
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  // Сработавшее удержание гасит нажатие, которое браузер шлёт следом
  // за отпусканием: иначе выбор карточки заодно открывал бы статью.
  // Отсчёт идёт от отпускания пальца, а не от срабатывания таймера:
  // палец держат сколько угодно, а хвостовое нажатие приходит сразу
  // за отпусканием. Момент, а не флаг: флаг переживал бы жест без
  // нажатия (палец ушёл в прокрутку) и глотал бы следующий Enter
  // на заголовке — окно в семьсот миллисекунд пережить нельзя.
  const fired = useRef(false);
  // Минус бесконечность, а не ноль: нажатие в первые семьсот миллисекунд
  // жизни страницы имеет timeStamp меньше окна, и ноль читался бы как
  // «только что отпустили».
  const releasedAt = useRef(Number.NEGATIVE_INFINITY);
  // Таймер читает состояние на момент срабатывания, а не на момент касания:
  // за полсекунды выбор могли снять с клавиатуры или из редактора, и снимок
  // из замыкания вернул бы его обратно.
  const selectedNow = useRef(selected);
  useEffect(() => {
    selectedNow.current = selected;
  }, [selected]);
  // Карточка может уйти раньше, чем истекут полсекунды (смена вкладки,
  // обновление ленты): без отмены таймер дёрнул бы выбор у карточки,
  // которой на экране уже нет.
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current.timer);
    },
    [],
  );
  const cancelPress = () => {
    if (!press.current) return;
    clearTimeout(press.current.timer);
    press.current = null;
  };
  // Окно взводится только на pointerup: после pointercancel (палец ушёл
  // в прокрутку уже после срабатывания) хвостового нажатия не бывает,
  // и взведённое окно глотало бы следующий настоящий тап.
  // Часы одни — timeStamp события: с ним же сравнивается хвостовое нажатие.
  const endPress = (event: React.PointerEvent) => {
    cancelPress();
    if (!fired.current) return;
    fired.current = false;
    releasedAt.current = event.timeStamp;
  };
  const dropPress = () => {
    cancelPress();
    fired.current = false;
  };
  const startPress = (event: React.PointerEvent) => {
    // Новый жест закрывает чужое окно, если оно почему-то осталось.
    fired.current = false;
    releasedAt.current = Number.NEGATIVE_INFINITY;
    if (event.pointerType !== "touch" || event.button !== 0) return;
    cancelPress();
    const { clientX: x, clientY: y } = event;
    press.current = {
      x,
      y,
      timer: setTimeout(() => {
        press.current = null;
        fired.current = true;
        navigator.vibrate?.(LONG_PRESS_VIBRATE_MS);
        onSelectedChange(!selectedNow.current);
      }, LONG_PRESS_MS),
    };
  };
  const movePress = (event: React.PointerEvent) => {
    if (!press.current) return;
    if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > LONG_PRESS_SLOP) {
      cancelPress();
    }
  };

  // Знаменатель калибровки: что действительно дошло до экрана. Без него
  // доля открытий считается от показанного в дайджесте, а это другое число.
  useEffect(() => {
    const node = article.current;
    if (!node || reportedSeen.current) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reportedSeen.current) {
          timer = setTimeout(() => {
            reportedSeen.current = true;
            report({ item_id: item.id, event: "seen" });
            observer.disconnect();
          }, SEEN_MS);
        } else if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(node.querySelector("h3") ?? node);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [item.id]);

  useEffect(() => {
    if (!expanded) return;
    openedAt.current = Date.now();
    report({ item_id: item.id, event: "opened" });

    const flush = () => {
      if (openedAt.current === null) return;
      const dwell = Date.now() - openedAt.current;
      openedAt.current = null;
      if (dwell >= DWELL_FLOOR_MS) report({ item_id: item.id, event: "dwell", dwell_ms: dwell }, true);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, [expanded, item.id]);

  const sendToKindle = async () => {
    // Проверка стоит в самой отправке, а не у каждой кнопки: зовут её
    // и ряд под курсором, и строка меню, и обе обязаны упираться в одно
    // и то же. Без неё нажатие уходило на сервер и возвращалось отказом
    // «сначала настрой Kindle в „Доставке“» — про раздел, который на этом
    // тарифе тоже закрыт: тупик, объясняющий не ту причину.
    if (!canKindle) {
      kindlePaywall.open();
      return;
    }
    setKindle("sending");
    try {
      const res = await fetch("/api/kindle", {
        method: "POST",
        body: JSON.stringify({ item_id: item.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t.feed.item.kindleError);
      setKindle("sent");
      // Честно про время: статья забирается и переводится целиком. Обещать
      // мгновенность — значит получить второй тап через десять секунд.
      toast.success(t.feed.item.kindleToastTitle, {
        description: t.feed.item.kindleToastDescription,
      });
    } catch (error) {
      setKindle("idle");
      toast.error(error instanceof Error ? error.message : t.feed.item.kindleError);
    }
  };

  /**
   * Поделиться материалом.
   *
   * Уходит ссылка на статью и наш заголовок, а не адрес карточки: лента
   * стоит за входом, и по нашему адресу получатель упрётся в дверь вместо
   * новости. Описание в посылку не идёт по той же причине, по которой оно
   * вообще есть: оно написано языком и сложностью этого читателя — это его
   * текст, а не общая страница, и в чужом чате он объясняет не то.
   *
   * Сначала системное окно: на телефоне шеринг живёт там, и своего списка
   * сетей ему не заменить — он не знает ни про чат, в котором переписываются
   * сейчас, ни про то, что стоит на этом телефоне. Нет его (десктоп,
   * небезопасный адрес) — ссылка уходит в буфер, и об этом говорится вслух:
   * молча скопировать значит сделать вид, что ничего не произошло.
   *
   * Тарифом не закрыто и не будет: закрывать имеет смысл то, что стоит
   * денег, а здесь нет ни одного вызова модели — и ровно этой кнопкой
   * бесплатный читатель приводит следующего.
   */
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url: item.url });
        return;
      } catch (error) {
        // Отмена своей же рукой приходит тем же исключением, что и отказ.
        // Тост «не получилось» на закрытое окно — это ложь; всё остальное
        // (нет разрешения, не тот контекст) лечится буфером ниже.
        if ((error as Error).name === "AbortError") return;
      }
    }
    try {
      // Без буфера (небезопасный адрес, старый браузер) `clipboard`
      // отсутствует вовсе — это тот же отказ, что и запрет доступа.
      if (!navigator.clipboard) throw new Error("буфер недоступен");
      await navigator.clipboard.writeText(item.url);
      toast.success(t.feed.item.shareCopied, {
        description: t.feed.item.shareCopiedDescription,
      });
    } catch {
      toast.warning(t.feed.item.shareFailed, {
        description: t.feed.item.shareFailedDescription,
      });
    }
  };

  const canPost = FEATURES.posts.has(plan);
  const paywall = usePaywall("posts", plan);
  const canListen = FEATURES.audio.has(plan);
  // Читалка — та же `FEATURES.delivery`, по которой открыт раздел
  // «Доставка» и по которой прогон решает, слать ли выпуск книгой.
  const canKindle = FEATURES.delivery.has(plan);
  const kindlePaywall = usePaywall("delivery", plan);
  // Озвучка подкастом выглядит на кнопке ровно как своя: работа одна.
  const busy: AudioState = voicing ? "working" : audio;
  const busyStep = voicing ?? step;
  const audioPaywall = usePaywall("audio", plan);

  /**
   * Озвучка идёт минутами, поэтому шаг спрашивается, а не угадывается.
   * Проценты рисовать нечем: перевод занимает минуту, синтез — десятки
   * секунд, и «43%» о них не говорит ничего, а «перевожу» говорит всё.
   */
  /**
   * Слушать здесь же. Файл лежит в Telegram, и адрес скачивания несёт
   * токен бота — поэтому поток идёт через наш адрес, а не напрямую.
   */
  const play = () => {
    if (!player.current) {
      const audioEl = new Audio(`/api/audio/play?item_id=${item.id}`);
      audioEl.addEventListener("ended", () => setAudio("sent"));
      audioEl.addEventListener("pause", () => setAudio("sent"));
      audioEl.addEventListener("play", () => setAudio("playing"));
      audioEl.addEventListener("error", () => {
        setAudio("sent");
        toast.error(t.feed.item.audioPlayError);
      });
      player.current = audioEl;
    }
    // Запуск останавливает всё остальное: слух у читателя один, а плееров
    // на странице пятьдесят, и второй запускают не нарочно — нажимают
    // на соседнюю карточку, думая, что первая остановится сама.
    if (player.current.paused) playOnly(player.current);
    else pauseIfPlaying(player.current);
  };

  const speak = async () => {
    if (!canListen) {
      audioPaywall.open();
      return;
    }
    // Готовое играется, а не озвучивается заново.
    if (audio === "sent" || audio === "playing") {
      play();
      return;
    }
    setAudio("working");
    // Опрос переживает карточку, если его не остановить: читатель уходит
    // на другой день выпуска, карточка размонтируется, а цикл продолжает
    // ходить в сеть и звать setState у того, чего уже нет.
    const alive = aliveRef;
    // Без явной длительности sonner погасит тост сам, и прогресс исчезнет
    // на середине работы — ровно так же, как у перестройки выпуска.
    const toastId = toast.loading(t.feed.item.audioStart, {
      duration: Infinity,
      icon: <HeadphonesIcon className="size-4" />,
    });
    try {
      const res = await fetch("/api/audio", {
        method: "POST",
        body: JSON.stringify({ item_id: item.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t.feed.item.audioError);
      // Без номера спрашивать не о чем: цикл ходил бы пять минут по
      // `send_id=undefined` и кончался бы «ещё готовится» на пустом месте.
      if (!body?.send_id) throw new Error(t.feed.item.audioError);

      const WORDS = AUDIO_STEP(t);
      // Опрос, а не сокет: одна кнопка на карточку и минуты работы —
      // держать соединение ради четырёх слов дороже, чем спросить раз
      // в две секунды.
      for (let i = 0; i < AUDIO_POLL_TIMES; i++) {
        await new Promise((done) => setTimeout(done, AUDIO_POLL_MS));
        // Уход с карточки гасит тост: он глобальный и живёт, пока его
        // обновляют, — брошенный, он останется на экране навсегда.
        if (!alive.current) {
          toast.dismiss(toastId);
          return;
        }
        const tick = await fetch(`/api/audio?send_id=${body.send_id}`);
        const state = await tick.json().catch(() => ({}));
        // Код ответа проверяется до статуса. Без этого истёкшая сессия
        // (401) или пропавшая строка (404) дают `{}`, `state.status`
        // становится undefined, и цикл крутится пять минут, чтобы
        // сказать «ещё готовится»: отказ выглядит как медленная работа.
        if (!tick.ok) throw new Error(state?.error ?? t.feed.item.audioError);
        if (state.status === "sent") {
          setAudio("sent");
          setStep(null);
          toast.success(t.feed.item.audioDoneTitle, {
            id: toastId,
            duration: 8000,
            // Тост наследует настройки того, который обновляет: без явной
            // длительности готовый живёт с `Infinity` от загрузочного
            // и не гаснет никогда, а закрыть его нечем.
            closeButton: true,
            icon: <HeadphonesIcon className="size-4" />,
            description: t.feed.item.audioDoneDescription(
              Math.max(1, Math.round((state.seconds ?? 0) / 60)),
            ),
          });
          return;
        }
        if (state.status === "failed") {
          throw new Error(state.error ?? t.feed.item.audioError);
        }
        if (WORDS[state.status]) {
          setStep(state.status);
          toast.loading(WORDS[state.status], {
            id: toastId,
            icon: <HeadphonesIcon className="size-4" />,
          });
        }
      }
      // Пять минут без ответа — это не «ещё чуть-чуть». Молчащий спиннер
      // читается как поломка, и лучше сказать правду: работа идёт, а мы
      // перестали ждать.
      if (!alive.current) return;
      toast.info(t.feed.item.audioSlowTitle, {
        id: toastId,
        duration: 8000,
        closeButton: true,
        icon: <HeadphonesIcon className="size-4" />,
        description: t.feed.item.audioSlowDescription,
      });
      setAudio("idle");
    } catch (error) {
      if (!alive.current) return;
      setAudio("idle");
      setStep(null);
      toast.error(error instanceof Error ? error.message : t.feed.item.audioError, {
        id: toastId,
        duration: 8000,
        closeButton: true,
      });
    }
  };

  // Скрытая карточка выходит и из обзора: в ленте её больше нет, и блок
  // из неё в черновике был бы новостью, которую читатель только что убрал.
  const hide = () => {
    setVote("down");
    report({ item_id: item.id, event: "down" });
    if (selected) onSelectedChange(false);
    // Меню собирается заново после «Вернуть»: плашка скрытой карточки
    // размонтирует его, и `defaultOpen` при следующем монтаже открыл бы
    // меню сам, без нажатия — ровно там, где читатель только что вернул
    // карточку.
    setMenuLive(false);
  };

  // Считаются источники, а не публикации: источник, повторивший сам себя,
  // «ещё одним источником» не становится, и такой сюжет строки не получает.
  const reading = parseStoredReading(item.summary_document);
  const hasSummary = Boolean(item.summary?.trim());
  const seconds = reading ? reading.seconds : hasSummary ? cardChars(item.title_ru || item.title, item.summary) / DEFAULT_CHARS_PER_MINUTE * 60 : 0;
  const minutes = seconds > 0 ? summaryTime(seconds, t.feed.time) : null;
  const others = otherSources(item.story, item.source_id);
  const lines = others > 0 ? storyLines(item.story, t.feed.story) : [];

  const title = item.title_ru || item.title;
  const site = siteOf(item.url);
  const clickbait = item.clickbait;
  // Тема — одной строкой вместе с источником и временем чтения.
  //
  // Тип материала и горизонт отсюда убраны. «Факт» стоял у 58% карточек
  // выпуска, «месяцы» — у 44%: метка, которая есть почти у всех, не отличает
  // карточку от соседней, а слова взяты из нашей шкалы, а не из языка
  // читателя. В отборе и в «Калибровке» обе оси работают по-прежнему —
  // там значения стоят рядом друг с другом и сравниваются. В строке
  // остаётся метка, которая сообщает об отклонении, — «кликбейт» выше.
  const topic = showTopic ? item.topic_label : null;
  // Короткая дата словаря — та же, которой карточка уже пишет «давно»
  // (`relativeTime`), а не полная из шапки. Год там стоит строкой выше,
  // на всё окно сразу, и повторять его на каждой из сорока карточек значит
  // сказать одно и то же сорок раз — та же причина, по которой заголовок
  // выпуска убран из отрывка поиска. Своей формулы здесь нет ни одной:
  // полную дату пишет formatDay, короткую — словарь.
  const dayLabel = showDay ? t.feed.time.monthDay(new Date(`${item.day}T12:00:00`)) : null;
  // Поднятый палец виден и с закрытым меню: оценка, которую видно только
  // внутри меню, — это оценка, которую нечем проверить, не открыв его.
  const menuIcon =
    vote === "up" ? <ThumbsUpIcon className="size-4 text-foreground" /> : <EllipsisIcon className="size-4" />;
  const menuButton =
    "flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 aria-expanded:bg-muted aria-expanded:text-foreground sm:hidden [@media(hover:none)]:flex";

  if (vote === "down") {
    return (
      <article
        id={`item-${item.id}`}
        className="flex items-center gap-3 border-b py-3 text-sm text-muted-foreground last:border-0"
      >
        <span className="truncate">{t.feed.item.hidden(title)}</span>
        <button
          type="button"
          onClick={() => {
            // Отмена снимает событие, а не только прячет плашку. Лента
            // исключает материал по наличию события down: оставь его
            // на месте — и «Вернуть» возвращало бы материал ровно
            // до перезагрузки страницы, после которой он исчезал навсегда.
            // Кнопка обещала обратимость, которой не было.
            report({ item_id: item.id, event: "down", undo: true });
            setVote(null);
          }}
          className="flex shrink-0 cursor-pointer items-center gap-1 hover:text-foreground"
        >
          <UndoIcon className="size-3.5" />
          {t.feed.item.undo}
        </button>
      </article>
    );
  }

  /**
   * Строка над заголовком: издание, метка кликбейта, время чтения и тема.
   *
   * Списком, а не четырьмя подряд стоящими условиями в разметке: между
   * кусками стоит разделитель, а он нужен только между существующими.
   * Пришитый к самому куску, он вылезал бы первым символом строки у любого
   * материала без ссылки на издание.
   *
   * `quiet` — виден только по наведению. В покое строка над заголовком
   * должна называть одно: чьё это. Остальное — ответы на вопросы, которые
   * задают, уже выбрав карточку глазами, и в покое они спорят с самим
   * заголовком, ради которого лента и листается.
   */
  const meta: { key: string; node: ReactNode; quiet?: true }[] = [
    // shrink-0 с потолком в ширину строки: издание не уступает место теме
    // и времени, но и за край карточки не выходит. Без потолка название
    // длиннее строки на телефоне уезжало за правый край без многоточия —
    // и вместе с ним уезжали кнопки действий.
    {
      key: "source",
      node: site ? (
        <a
          href={site}
          target="_blank"
          rel="noreferrer noopener"
          className="max-w-full shrink-0 truncate text-[0.75rem] font-medium text-muted-foreground hover:text-foreground focus-visible:text-foreground hover:underline"
        >
          {item.source_label}
        </a>
      ) : (
        <span className="max-w-full shrink-0 truncate text-[0.75rem] font-medium text-muted-foreground">
          {item.source_label}
        </span>
      ),
    },
    // День — сразу за источником и не гаснет: на окне из пяти выпусков
    // это ответ на вопрос «когда», который задают раньше всех остальных.
    // Приглуши его вместе с темой — и в покое лента из пяти дней выглядела
    // бы одним выпуском.
    ...(dayLabel
      ? [{ key: "day", node: <span className="shrink-0 tabular-nums">{dayLabel}</span> }]
      : []),
    // Метка стоит вплотную к источнику, а не за метаданными: место под время
    // и тему держится всегда, чтобы строка не дёргалась при наведении, —
    // и «кликбейт» за этим местом висел в пустоте, оторванный от того,
    // к чему относится.
    ...(clickbait
      ? [{ key: "clickbait", node: <span className="shrink-0 text-destructive">{t.feed.item.clickbait}</span> }]
      : []),
    // Написание из «За чем следить», найденное в материале. Правило
    // работает при отборе и молча; пометка — единственное, по чему видно,
    // что оно сработало. Только упоминание, как и обещано в настройках:
    // без слов «про Figma» — про что материал, решает читатель.
    ...(item.followed
      ? [{
          key: "followed",
          node: (
            // min-w-0 и truncate, как у темы рядом: написание — текст читателя
            // длиной до 80 знаков, и без обрезки оно наезжало бы на кнопки
            // на узком экране.
            <span
              className="inline-flex min-w-0 items-center gap-1"
              title={t.feed.rules.followedTitle}
            >
              <EyeIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{item.followed}</span>
            </span>
          ),
          quiet: true as const,
        }]
      : []),
    // min-w-0 обязателен: truncate обрезает только то, чему разрешили
    // сузиться, а гибкий элемент по умолчанию не уже своего содержимого.
    // Строка в одну линию держала ширину всей карточки, и на телефоне лента
    // уезжала за край экрана — заголовок и текст обрезались справа,
    // а докрутить до них было нельзя.
    ...(topic
      ? [{ key: "topic", node: <span className="min-w-0 truncate">{topic}</span>, quiet: true as const }]
      : []),
    // Время чтения стоит последним, а не перед темой: оно единственное
    // здесь меняется от материала к материалу сильно, и в середине ряда
    // двигало тему при каждой карточке. С краю ряд стоит ровно, а число
    // никуда не съезжает. Пусто, когда текста статьи у нас нет: у 124
    // карточек из 200 его не бывает, и выдуманное число там было бы
    // неотличимо от измеренного.
    ...(minutes
      ? [{ key: "minutes", node: <span className="shrink-0">{minutes}</span>, quiet: true as const }]
      : []),
  ];

  return (
    <article
      ref={article}
      // Якорь для ссылки из Telegram: сообщение ведёт на `#item-<id>`,
      // а не на день целиком — в выпуске бывает сто карточек, и «открой
      // выпуск и найди третью в энергетике» это не ссылка на статью.
      // Отступ под липкую шапку считает лента: он равен её высоте,
      // а высота у шапки на телефоне и на широком экране разная.
      id={`item-${item.id}`}
      // Только курсор: на тапе ряд с подсказками скрыт, и собирать их
      // значило бы платить за то, чего на экране не бывает.
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setHot(true);
      }}
      onFocus={(event) => {
        // Фокус, пришедший прямо на кнопку действия (у карточки без ссылки
        // на издание она первая в обходе), включает подсказки как и любой
        // другой. Пересборка кнопки под фокусом его теряет — кнопка
        // запоминается по подписи и получает фокус обратно в эффекте выше.
        const target = event.target as HTMLElement;
        if (!hot && target.closest("[data-hint]")) refocus.current = target.getAttribute("aria-label");
        setHot(true);
      }}
      data-selected={selected || undefined}
      onPointerDown={startPress}
      onPointerMove={movePress}
      onPointerUp={endPress}
      onPointerCancel={dropPress}
      // Системное меню по удержанию (Android) и выделение текста (iOS)
      // отбирали бы жест себе; на мыши правая кнопка работает как обычно.
      onContextMenu={(event) => {
        if (press.current || fired.current || event.timeStamp - releasedAt.current < LONG_PRESS_SUPPRESS_MS) {
          event.preventDefault();
        }
      }}
      onClickCapture={(event) => {
        if (event.timeStamp - releasedAt.current > LONG_PRESS_SUPPRESS_MS) return;
        releasedAt.current = Number.NEGATIVE_INFINITY;
        event.preventDefault();
        event.stopPropagation();
      }}
      className={cn(
        // content-visibility: браузер не раскладывает и не рисует карточки
        // за пределами экрана, пока до них не докрутили. React их всё равно
        // собирает, но стиль и раскладка полусотни карточек — заметная доля
        // времени переключения дня. Размер-заготовка — под обычную карточку;
        // после первого показа браузер помнит настоящий.
        // py-7, а не py-5: между абзацами внутри карточки 16 пикселей, и при
        // py-5 соседнюю карточку отделяло 41 — всего вдвое с небольшим больше,
        // хотя внутри лежит текст на двести слов. Теперь 57, и граница
        // читается как граница, а не как ещё один абзац.
        "group border-b py-7 transition-[opacity,background-color] duration-150 last:border-0 [content-visibility:auto] [contain-intrinsic-size:auto_220px]",
        // Долгое нажатие на телефоне не выделяет текст и не зовёт системное
        // меню: у карточки свои действия по тапу.
        "[@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none]",
        // Отмеченная карточка подсвечена всей строкой до краёв контейнера,
        // а не рамкой вокруг текста: рамка внутри полей читалась бы как
        // коробка в коробке. Фон приглушённый и постоянный — выбор должен
        // быть виден издалека, но не спорить с заголовком.
        selected && "-mx-4 bg-muted/70 px-4 sm:-mx-6 sm:px-6",
      )}
    >
      {/* Одна строка, а не две. Прежде метаданные проявлялись по наведению,
          а в покое их место занимало время чтения — и получалось два ряда,
          живущих по разным правилам. Теперь ряд один и гаснет целиком,
          кроме издания: в покое строка над заголовком называет одно —
          чьё это.

          Времени публикации здесь больше нет. «2д» и «~41 мин» стоят рядом,
          оба про время и оба про разное: одно — давно ли вышло, второе —
          сколько читать. Глаз складывает их в одно число и спотыкается.
          Из двух оставлено то, что отвечает на «открывать ли сейчас».

          Шапка во всю ширину карточки, а не внутри текстовой колонки:
          там её правый край упирался в картинку, и кнопки у карточек
          с иллюстрацией и без неё стояли в разных местах. Теперь они
          всегда в правом верхнем углу, а картинка начинается под ними. */}
      <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        {/* Отметка для обзора. Место под неё держится всегда — источник
            и заголовок не переезжают, когда она проявляется по наведению.
            Показывается как остальное тихое: под курсором, под фокусом
            и на тапе; а как только в выпуске отмечена хоть одна карточка —
            у всех, иначе выбор второй карточки начинался бы с поиска
            невидимого квадрата.

            Не внутри ссылки на издание и не рядом с её текстом: нажатие
            на отметку не открывает ничего и не считается чтением —
            ни `opened`, ни `outbound` отсюда не уходят. */}
        <Tooltip>
          {/* Подсказка висит на обёртке, а не на самом чекбоксе: у него свои
              дети (галочка), и render-слот подменил бы их пустотой. */}
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Checkbox
              checked={selected}
              onCheckedChange={(next) => onSelectedChange(next)}
              aria-label={selected ? t.feed.overview.remove(title) : t.feed.overview.add(title)}
              className={cn(
                "size-4 bg-card transition-[opacity,background-color,border-color] duration-150",
                selected || selecting ? "opacity-100" : QUIET,
              )}
            />
          </TooltipTrigger>
          {/* Клавиша названа там же, где кнопка: строка под лентой говорит
              о ней один раз внизу, а рука в этот момент на отметке. */}
          <TooltipContent>
            {selected ? t.feed.overview.tooltipRemove : t.feed.overview.tooltipAdd}
            <Kbd>x</Kbd>
          </TooltipContent>
        </Tooltip>
        {/* Разделитель между кусками, а не пробел: «Hacker News ~7 мин
            AI-инфра» читается одной строкой, в которой издание, время
            и тема слипаются в чужое название. Точка с пробелами по бокам
            растягивала бы ряд сильнее, чем несёт смысла, а запятая делала бы
            его перечислением однородного — чем издание, время и тема
            не являются.

            aria-hidden: диктор и так делает паузу между элементами,
            а «болт» в речи — мусор.

            Тихие куски гаснут прозрачностью, а не убираются из потока:
            место под них держится всегда, и строка не дёргается при
            наведении. Разделитель гаснет вместе со своим куском — иначе
            в покое перед пустотой висел бы болт. На тапе наведения нет
            вовсе, и там видно всё: спрятанное там было бы спрятано
            навсегда. */}
        <span className="flex min-w-0 items-baseline gap-1">
          {meta.map(({ key, node, quiet }, index) => (
            <Fragment key={key}>
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "shrink-0 text-muted-foreground/40",
                    quiet && QUIET,
                  )}
                >
                  •
                </span>
              ) : null}
              {/* Обёртка — тоже флекс: иначе флекс-элементом становится она,
                  а `shrink-0` у времени и `truncate` у темы оказываются
                  на строчном потомке, где не значат ничего. Время сжималось
                  бы многоточием на узком экране, а тема — перестала бы. */}
              {quiet ? <span className={cn(key === "minutes" ? "flex shrink-0" : "flex min-w-0", QUIET)}>{node}</span> : node}
            </Fragment>
          ))}
        </span>

        {/* Оценка тоже по наведению: нужна раз на десяток материалов,
            а в покое спорит с заголовком. Поднятый палец виден всегда,
            иначе выставленная оценка исчезает вместе с курсором.

            На тапе наведения нет, и ряд висел раскрытым в каждой карточке:
            три иконки на узком экране, где и заголовку тесно. Там он прячется
            за одну кнопку — те же действия, но по своей воле, а не в каждой
            строке ленты. */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* На тапе действия живут в меню, а не раскрываются рядом: три
              голые иконки на узком экране нечем объяснить, а строка меню
              называет себя словами. На мыши меню было бы лишним щелчком —
              там ряд по-прежнему появляется под курсором. */}
          {menuLive ? (
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger
              render={<button type="button" aria-label={t.feed.item.actionsLabel} className={menuButton} />}
            >
              {menuIcon}
            </DropdownMenuTrigger>
            {/* Ширина по самой длинной строке: иначе меню жмётся к кнопке
                и пункты переносятся — список из трёх строк читается
                как из шести. Подписи здесь короткие и заданы в коде,
                так что max-content не разъедется. */}
            <DropdownMenuContent align="end" className="min-w-max">
              {/* На тапе действия живут только здесь, поэтому «Своё мнение»
                  обязано быть и в меню: кнопка, существующая лишь под курсором,
                  на телефоне не существует вовсе. Порядок и черта — те же,
                  что в ряду под курсором: два места, один договор. */}
              <DropdownMenuItem
                disabled={busy === "working"}
                onClick={busy === "working" ? undefined : speak}
              >
                {AUDIO_ICON[busy]}
                {AUDIO_LABEL(t)[busy]}
                {canListen ? null : <CrownIcon className="ml-1 size-3.5 text-amber-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={kindle !== "idle"}
                onClick={kindle === "idle" ? sendToKindle : undefined}
              >
                {kindle === "sending" ? (
                  <Spinner />
                ) : kindle === "sent" ? (
                  <CheckIcon />
                ) : (
                  <BookOpenIcon />
                )}
                {kindle === "sending"
                  ? t.feed.item.kindleSending
                  : kindle === "sent"
                    ? t.feed.item.kindleSent
                    : t.feed.item.kindleSend}
                {canKindle ? null : <CrownIcon className="ml-1 size-3.5 text-amber-500" />}
              </DropdownMenuItem>
              {/* После читалки и до «Своего мнения»: порядок тот же, что
                  и в ряду под курсором, — отложить себе, отдать другому,
                  написать своё. */}
              <DropdownMenuItem onClick={share}>
                <ShareIcon />
                {t.feed.item.share}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (!canPost) {
                    paywall.open();
                    return;
                  }
                  if (networks.length === 0) {
                    toast.info(t.feed.item.pickNetworksFirst, {
                      description: `${t.nav.settings} → ${t.nav.channels}`,
                    });
                    return;
                  }
                  setOpinion(true);
                }}
              >
                <PenLineIcon />
                {t.feed.item.opinion}
                {canPost ? null : <CrownIcon className="ml-1 size-3.5 text-amber-500" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={vote === "up"}
                onCheckedChange={(next: boolean) => {
                  setVote(next ? "up" : null);
                  if (next) report({ item_id: item.id, event: "up" });
                }}
              >
                <ThumbsUpIcon />
                {t.feed.item.upvoteLabel}
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem variant="destructive" onClick={hide}>
                <ThumbsDownIcon />
                {t.feed.item.downvoteLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          ) : (
            // Та же кнопка до первого нажатия: нажатие собирает настоящее меню
            // уже открытым (`defaultOpen`), дальше оно живёт как обычно.
            <button
              type="button"
              aria-label={t.feed.item.actionsLabel}
              aria-haspopup="menu"
              aria-expanded={false}
              onClick={() => setMenuLive(true)}
              className={menuButton}
            >
              {menuIcon}
            </button>
          )}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            vote === "up" && "opacity-100",
            // На тапе этого ряда нет вовсе — там меню.
            "max-sm:hidden [@media(hover:none)]:hidden",
          )}
        >
          {/* Иконка без подписи опознаётся только по догадке. Подпись
              для экранного диктора у них была и раньше; всплывающая
              говорит то же самое глазами — на курсоре и на фокусе. */}
          {/* Порядок — по тому, что делают с материалом: сначала послушать,
              потом отправить на читалку, потом написать о нём пост. Оценка
              отделена чертой: она не про этот материал, а про следующие
              выпуски, и стоять с ними в одном ряду ей не по чину. */}

          {/* Слева от плеера и только пока играет: до нажатия скорость
              нечему менять, а кнопка, которая ничего не делает, занимает
              место в ряду из шести. */}
          {busy === "playing" ? (
            <Hint
              live={hot}
              tip={t.feed.item.audioRateTooltip}
              button={
                <button
                  type="button"
                  aria-label={t.feed.item.audioRateAria}
                  onClick={() => nextRate()}
                  className="flex h-7 cursor-pointer items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-muted-foreground/70 transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-muted hover:text-foreground"
                />
              }
            >
              {`×${rate.toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}`}
            </Hint>
          ) : null}

          <Hint
            live={hot}
            tip={
              <>
                {!canListen
                  ? t.feed.item.audioTooltipLocked(cheapestFor("audio").label)
                  : // Шаг важнее состояния: «Читаю вслух» отвечает на вопрос,
                    // который задают, глядя на спиннер, а «Озвучиваю…» — нет.
                    ((busyStep ? AUDIO_STEP(t)[busyStep] : undefined) ??
                    (busy === "idle" ? t.feed.item.audioTooltipReady : AUDIO_LABEL(t)[busy]))}
                <Kbd>a</Kbd>
              </>
            }
            button={
              <button
                type="button"
                // Клавише «a» нужно за что-то взяться: по подписи её не найти —
                // подпись переводится, а селектор молча перестал бы совпадать
                // у того, кто читает ленту не по-русски.
                data-slot="listen"
                aria-label={t.feed.item.audioAria}
                aria-disabled={busy === "working"}
                onClick={busy === "working" ? undefined : speak}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-muted hover:text-foreground",
                  // Тёмной кнопка становится только пока идёт работа.
                  // Готовность — это не занятость: чёрный треугольник
                  // рядом с серыми соседями читался приоритетом,
                  // которого у озвучки нет.
                  busy === "working" ? "text-foreground" : "cursor-pointer text-muted-foreground/70",
                )}
              />
            }
          >
            <span className="flex size-3.5 items-center justify-center">
              {AUDIO_ICON[audio]}
            </span>
          </Hint>

          <Hint
            live={hot}
            tip={
              canKindle
                ? t.feed.item.kindleTooltip
                : t.feed.item.kindleTooltipLocked(cheapestFor("delivery").label)
            }
            button={
              <button
                type="button"
                aria-label={t.feed.item.kindleAria}
                // aria-disabled, а не disabled: браузер снимает фокус
                // с выключенной кнопки, и с клавиатуры место в списке
                // теряется ровно в момент нажатия. Заодно остаётся
                // подсказка — на disabled она не показывается никогда.
                aria-disabled={kindle !== "idle"}
                onClick={kindle === "idle" ? sendToKindle : undefined}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-muted hover:text-foreground",
                  kindle === "idle"
                    ? "cursor-pointer text-muted-foreground/70"
                    : "text-foreground",
                )}
              />
            }
          >
            <span className="relative flex size-3.5 items-center justify-center">
              <Spinner className={cn("absolute", swap(kindle === "sending"))} />
              <CheckIcon className={cn("absolute", swap(kindle === "sent"))} />
              <BookOpenIcon className={swap(kindle === "idle")} />
            </span>
          </Hint>

          <Hint
            live={hot}
            tip={t.feed.item.shareTooltip}
            button={
              <button
                type="button"
                aria-label={t.feed.item.shareAria}
                onClick={share}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-muted hover:text-foreground"
              />
            }
          >
            <ShareIcon className="size-3.5" />
          </Hint>

          <Hint
            live={hot}
            tip={
              canPost
                ? t.feed.item.opinionTooltipReady
                : t.feed.item.opinionTooltipLocked(cheapestFor("posts").label)
            }
            button={
              <button
                type="button"
                aria-label={t.feed.item.opinionAria}
                onClick={() => {
                  if (!canPost) {
                    paywall.open();
                    return;
                  }
                  if (networks.length === 0) {
                    toast.info(t.feed.item.pickNetworksFirst, {
                      description: `${t.nav.settings} → ${t.nav.channels}`,
                    });
                    return;
                  }
                  setOpinion(true);
                }}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
              />
            }
          >
            <PenLineIcon className="size-3.5" />
          </Hint>

          {/* Волосок в четырнадцать пикселей, а не отступ: пустое место
              между иконками читается как случайное, а черта говорит,
              что дальше другое. */}
          <span aria-hidden className="mx-1 h-3.5 w-px shrink-0 bg-border" />

          <Hint
            live={hot}
            tip={t.feed.item.upvoteTooltip}
            button={
              <button
                type="button"
                aria-label={t.feed.item.upvoteLabel}
                aria-pressed={vote === "up"}
                onClick={() => {
                  setVote(vote === "up" ? null : "up");
                  if (vote !== "up") report({ item_id: item.id, event: "up" });
                }}
                className={cn(
                  "flex size-7 cursor-pointer items-center justify-center rounded-md transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-muted hover:text-foreground",
                  vote === "up" ? "text-foreground" : "text-muted-foreground/70",
                )}
              />
            }
          >
            <ThumbsUpIcon className="size-3.5" />
          </Hint>

          {/* Палец вниз убирает материал из ленты — единственное здесь
              действие, которое что-то отнимает. Красный по наведению
              отличает его от соседних двух до нажатия, а не после. */}
          <Hint
            live={hot}
            tip={t.feed.item.downvoteLabel}
            button={
              <button
                type="button"
                aria-label={t.feed.item.downvoteLabel}
                onClick={hide}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-destructive/10 hover:text-destructive"
              />
            }
          >
            <ThumbsDownIcon className="size-3.5" />
          </Hint>
        </div>
        </div>
      </div>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {/* Вес 600. Пятисотый на двадцати пикселях отличался от описания
              под ним слишком слабо, чтобы глаз цеплялся за заголовок как
              за якорь: список читался сплошным полотном, и на каждую карточку
              уходил лишний скачок. Семисотый на этом размере уже кричит.
              Inter подключён переменным, поэтому шестисотый берётся без
              второго файла шрифта.
              Отрицательный трекинг — на крупном кегле: Inter рисован
              под текстовые размеры, и на двадцати пикселях межбуквенное
              по умолчанию разваливает слово на буквы. */}
          {/* Прочитанный заголовок не приглушается: под ним стоит документ
              в полный цвет, и заголовок на 70 % уступал собственному
              акценту — карточка начиналась с числа. Сигнал «уже открывал»
              этим снят; возвращать его — не цветом заголовка. */}
          {/* Заголовок не переносится: перенос на крупном кегле читается
              как опечатка, а строк тут две-три — рвать нечего. Язык всё
              равно объявлен: по нему говорит скринридер. */}
          <h3 lang={textLang ?? undefined} className="mt-2.5 text-pretty text-xl font-semibold leading-[1.3] tracking-[-0.011em]">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              // Своей рамки у заголовка нет: фокус на карточке уже виден тем,
              // что гаснут соседние — то же самое, чем лента отвечает на
              // наведение. Рамка поверх этого была бы вторым знаком одного
              // состояния, и два знака читаются как два разных.
              className="decoration-muted-foreground/40 underline-offset-4 outline-none hover:underline"
              onClick={() => report({ item_id: item.id, event: "outbound" })}
            >
              {typography(title)}
            </a>
          </h3>

          {/* Два слоя: ответ виден сразу, подробности раскрываются. Событие
              «opened» наконец означает чтение — раньше оно уходило от клика
              по тексту, который и так был показан целиком. */}
          {reading ? (
            <div onClick={() => setExpanded((value) => !value)}>
              <ReadingSummary reading={reading} labels={t.feed.reading} lang={textLang} open={expanded} />
              {!expanded && hasDetails(reading) ? (
                <button
                  type="button"
                  aria-expanded={false}
                  onClick={(event) => { event.stopPropagation(); setExpanded(true); }}
                  className="mt-2 flex cursor-pointer items-center gap-1 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t.feed.reading.more}
                  <ChevronDownIcon className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : hasSummary ? (
            <p
              lang={textLang ?? undefined}
              onClick={() => setExpanded((value) => !value)}
              // 16 пикселей, а не 15: описание — единственный сплошной текст
              // в карточке, и на нём экономить кегль незачем. Колонка — 60ch:
              // ch — это ширина нуля, и кириллицей в такую строку ложится
              // около 67 знаков; на 68ch выходило 76, и глаз промахивался
              // мимо начала следующей строки.
              // Цвет текста — полный, а не 80%: описание здесь и есть
              // материал, всё остальное в карточке к нему подпись.
              // Приглушённый основной текст читается как черновик.
              // Переносы только при известном языке: правила у каждого свои,
              // и русскими словами немецкий рвётся не там. Рваность правого
              // края на колонке в 60 знаков доходила до 20% ширины.
              className={cn(
                "mt-2 max-w-[60ch] cursor-text text-pretty text-base leading-[1.6] text-foreground",
                textLang && "hyphens-auto",
              )}
            >
              {typography(item.summary ?? "")}
            </p>
          ) : <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{t.feed.item.summaryUnavailable}</p>}

          {/* Работа дедупа, названная вслух. Не «важно» и не «подтверждено»:
              пять изданий, пересказавших один пресс-релиз, ничего
              не подтверждают. Здесь сказано ровно то, что произошло, —
              Reporta выбрала из них одно и не спрятала остальные. */}
          {others > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                aria-expanded={storyOpen}
                onClick={() => setStoryOpen((value) => !value)}
                className="flex cursor-pointer items-center gap-1 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
              >
                {alsoLine(others, t.feed.story)}
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform duration-200", storyOpen && "rotate-180")}
                />
              </button>
              {storyOpen ? (
                <div className="mt-2 max-w-[60ch] rounded-lg bg-muted/40 px-3 py-2.5 text-[0.8125rem]">
                  <p className="mb-1.5 font-medium">{storyTitle(lines.length, t.feed.story)}</p>
                  <ul className="space-y-1">
                    {lines.map((line) => (
                      <li key={line.item_id} className="flex flex-wrap items-baseline gap-x-1.5">
                        <a
                          href={line.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          // Переход к любой публикации сюжета — это уход
                          // читать эту новость, и калибровке он нужен весь:
                          // событие ставится на карточку, а не на ту строку,
                          // по которой щёлкнули, — в выпуске была она.
                          onClick={() => report({ item_id: item.id, event: "outbound" })}
                          className="text-foreground/80 underline-offset-4 hover:underline"
                        >
                          {line.source_label}
                        </a>
                        {line.note ? (
                          <span className="text-muted-foreground">— {line.note}</span>
                        ) : null}
                        {/* Показанная публикация помечается отдельно: в выпуск
                            едет та, которую выбрал дедуп, а первым в списке
                            стоит написавший раньше всех — это разные правила,
                            и они расходятся. Без пометки список читался бы
                            как ошибка отбора: «почему первым не тот, кого
                            мне показали». */}
                        {line.item_id === item.id ? (
                          <span className="text-muted-foreground/70">· {t.feed.item.thisCard}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Картинка справа, как в Google News: не мешает пробегать заголовки
            глазами, но даёт строке опору. Битую ссылку убираем молча —
            дыра в ряду хуже, чем её отсутствие. */}
        {item.image_url && !imageFailed ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 hidden shrink-0 sm:block"
            onClick={() => report({ item_id: item.id, event: "outbound" })}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              // Контур в пиксель, чёрный на светлой теме и белый на тёмной. Без него
              // светлый скриншот сливается с карточкой, а тёмный — с тёмной темой:
              // у картинки пропадает край. Цвет чистый, не из палитры: тонированный
              // подхватывает фон под собой и читается как грязь по краю.
              className="size-[104px] rounded-lg bg-muted object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            />
          </a>
        ) : null}
      </div>

      {paywall.dialog}
      {audioPaywall.dialog}
      {kindlePaywall.dialog}
      {/* Мотатка монтируется только после нажатия: она пишет пост при открытии,
          и держать её на каждой карточке значило бы сорок запросов на ленту. */}
      {opinion ? (
        <OpinionDialog
          itemId={item.id}
          title={title}
          url={item.url}
          networks={networks}
          open={opinion}
          onOpenChange={setOpinion}
        />
      ) : null}
    </article>
  );
}
