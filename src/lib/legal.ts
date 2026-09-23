import type { Locale } from "./i18n/locale";

/**
 * Политика конфиденциальности и условия — данными, а не разметкой, по два
 * языка на документ.
 *
 * Здесь перечислено ровно то, что сервис собирает и куда отдаёт, а не
 * шаблон «мы можем собирать»: страницу проверяют ревьюеры Meta и читают
 * люди, решающие, подключать ли свой аккаунт. Появится новая колонка
 * с личными данными или новый провайдер — строка здесь меняется тем же
 * коммитом, иначе документ врёт так же тихо, как любой отказ в этом проекте.
 */

export type LegalDoc = {
  title: string;
  updated: string;
  intro: string;
  sections: { id: string; heading: string; paragraphs: string[] }[];
};

const CONTACT = "https://t.me/igortomko";
const CONTACT_LABEL = "t.me/igortomko";

export const LEGAL_CONTACT = { href: CONTACT, label: CONTACT_LABEL };

export const LEGAL: Record<Locale, { privacy: LegalDoc; terms: LegalDoc; refund: LegalDoc }> = {
  en: {
    privacy: {
      title: "Privacy Policy",
      updated: "Last updated: September 23, 2026",
      intro:
        "Reporta (news.reporta.club) is a personal news digest run by Igor Tomko as an individual. This page lists what the service stores about you, why, who processes it, and how to delete it.",
      sections: [
        {
          id: "collect",
          heading: "What we store",
          paragraphs: [
            "Telegram account: your numeric Telegram ID, username, first name, interface language, and your profile bio. The bio is used once to suggest topics during setup.",
            "Settings: your topics, sources, follow and exclude rules, reading time, time zone, delivery options, and Kindle address if you add one.",
            "Reading activity: which cards were shown to you, opened, clicked through, hidden, or rated. It is used only to tune your own selection.",
            "Connected social accounts: when you connect X, LinkedIn or Threads, we store only the account name the network returns (for example @username or your display name). We do not store access tokens, and we do not read, store or publish your posts through these networks' APIs.",
            "Your writing samples: posts you paste as text and posts from a public Telegram channel, blog or X account whose link you add, used to build your writing profile for drafts.",
            "Subscription: plan, status, renewal date and a link to the billing portal, received from Paddle. We never see your card details.",
          ],
        },
        {
          id: "use",
          heading: "How we use it",
          paragraphs: [
            "To select and write your daily digest, deliver it to Telegram and Kindle, generate audio if you turn it on, and write post drafts in your voice. We do not sell your data, show ads, or use it to train models.",
          ],
        },
        {
          id: "processors",
          heading: "Who processes it",
          paragraphs: [
            "Hosting: a virtual server at Hostinger. Database: Supabase (PostgreSQL). Messaging: Telegram. Kindle delivery: Resend. Payments: Paddle. Text generation: an OpenAI-compatible model provider that receives the news items and your writing preferences, not your Telegram identity. Audio: Microsoft Edge text-to-speech. Public X posts are read through twitterapi.io.",
          ],
        },
        {
          id: "cookies",
          heading: "Cookies",
          paragraphs: [
            "One signed session cookie that keeps you logged in for 30 days, and a short-lived cookie (10 minutes) while you connect a social account. No analytics or advertising trackers. Your recent searches are kept in your browser only.",
          ],
        },
        {
          id: "delete",
          heading: "Deleting your data",
          paragraphs: [
            "Disconnecting a social network on the settings page removes its account name immediately. To delete your profile, use \"Delete profile\" at the bottom of Settings → About: your Telegram identity, Kindle address, issues, settings, connected networks and drafts are erased immediately. Anonymous counters (visit dates, reading events and model costs) are kept without any link to you. If you can't sign in, message " +
              CONTACT_LABEL +
              " on Telegram from the account you signed in with and we'll do it within 30 days. If you remove Reporta's access in X, LinkedIn or Threads settings, we stop being able to use that connection at once.",
          ],
        },
        {
          id: "contact",
          heading: "Contact",
          paragraphs: ["Questions about this policy: " + CONTACT_LABEL + " on Telegram."],
        },
      ],
    },
    terms: {
      title: "Terms of Service",
      updated: "Last updated: September 23, 2026",
      intro:
        "These terms apply to Reporta (news.reporta.club), a personal news digest run by Igor Tomko as an individual. By using the service you accept them.",
      sections: [
        {
          id: "service",
          heading: "The service",
          paragraphs: [
            "Reporta collects public news sources, selects items for you and writes short summaries with links to the originals. Summaries and post drafts are generated by AI models and may contain mistakes; check the original before relying on them.",
          ],
        },
        {
          id: "account",
          heading: "Your account",
          paragraphs: [
            "You sign in through Telegram. Keep your login link to yourself. You are responsible for what you do with drafts the service writes for you, including anything you publish to your social networks.",
          ],
        },
        {
          id: "paid",
          heading: "Plans and payments",
          paragraphs: [
            "There is a free plan and paid plans: Plus at $3.99 a month and Pro at $9.99 a month, prices in US dollars before any applicable tax. Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service inquiries and handles returns.",
            "A subscription renews automatically each month until you cancel it. You can cancel at any time from Subscription → Manage plan; a cancelled subscription stays active until the end of the paid period. Refunds are described in the Refund Policy at news.reporta.club/refund.",
          ],
        },
        {
          id: "use",
          heading: "Acceptable use",
          paragraphs: [
            "Do not use the service to break the law, to abuse or overload it, or to access other readers' data. We may suspend accounts that do.",
          ],
        },
        {
          id: "content",
          heading: "Content",
          paragraphs: [
            "Articles belong to their publishers; Reporta shows short summaries and links back. Your settings, pasted posts and drafts stay yours.",
          ],
        },
        {
          id: "liability",
          heading: "No warranty",
          paragraphs: [
            "The service is provided as is, without guarantees of availability or accuracy. To the extent the law allows, we are not liable for losses arising from its use.",
          ],
        },
        {
          id: "changes",
          heading: "Changes and contact",
          paragraphs: [
            "We may update these terms; the date above shows the latest version. You can stop using the service at any time. Contact: " +
              CONTACT_LABEL +
              " on Telegram.",
          ],
        },
      ],
    },
    refund: {
      title: "Refund Policy",
      updated: "Last updated: September 23, 2026",
      intro:
        "Paid plans of Reporta are sold by our reseller Paddle.com, the Merchant of Record for all our orders. This page explains when and how you get your money back.",
      sections: [
        {
          id: "window",
          heading: "14-day refund",
          paragraphs: [
            "You can get a full refund of any payment within 14 days of the charge, including renewals. No reason is needed.",
          ],
        },
        {
          id: "how",
          heading: "How to request it",
          paragraphs: [
            "Open paddle.net, find the order by the email you paid with, and request a refund there. Or message " +
              CONTACT_LABEL +
              " on Telegram and we will ask Paddle to refund it. The money returns to the original payment method; banks usually show it within 5–10 business days.",
          ],
        },
        {
          id: "cancel",
          heading: "Cancelling",
          paragraphs: [
            "Cancelling stops future renewals. After 14 days a payment is not refunded, but the plan keeps working until the end of the paid period.",
          ],
        },
      ],
    },
  },
  ru: {
    privacy: {
      title: "Политика конфиденциальности",
      updated: "Обновлено 23 сентября 2026 г.",
      intro:
        "Reporta (news.reporta.club) — персональная лента новостей, её ведёт Игорь Томко как частное лицо. Здесь перечислено, что сервис хранит о тебе, зачем, кто это обрабатывает и как это удалить.",
      sections: [
        {
          id: "collect",
          heading: "Что мы храним",
          paragraphs: [
            "Аккаунт Telegram: числовой ID, имя пользователя, имя, язык интерфейса и описание профиля. Описание используется один раз — чтобы предложить темы при настройке.",
            "Настройки: темы, источники, правила «следить» и «исключить», время чтения, часовой пояс, доставка и адрес Kindle, если ты его добавил.",
            "Чтение: какие карточки тебе показаны, раскрыты, открыты по ссылке, скрыты или оценены. Нужно только для настройки твоего собственного отбора.",
            "Подключённые соцсети: при подключении X, LinkedIn или Threads мы сохраняем только имя аккаунта, которое вернула сеть (например, @ник или имя). Токены доступа не храним и через API этих сетей не читаем, не храним и не публикуем твои посты.",
            "Образцы текста: посты, которые ты вставил текстом, и посты публичного канала Telegram, блога или аккаунта X по добавленной тобой ссылке — из них собирается твой стиль для черновиков.",
            "Подписка: тариф, статус, дата продления и ссылка на кабинет оплаты — приходят от Paddle. Данные карты мы не видим никогда.",
          ],
        },
        {
          id: "use",
          heading: "Зачем",
          paragraphs: [
            "Чтобы отобрать и написать твой выпуск, доставить его в Telegram и на Kindle, озвучить, если ты это включил, и писать черновики постов твоим голосом. Мы не продаём данные, не показываем рекламу и не обучаем на них модели.",
          ],
        },
        {
          id: "processors",
          heading: "Кто обрабатывает",
          paragraphs: [
            "Хостинг — виртуальный сервер Hostinger. База — Supabase (PostgreSQL). Сообщения — Telegram. Доставка на Kindle — Resend. Оплата — Paddle. Тексты пишет OpenAI-совместимый провайдер моделей: он получает новости и твои настройки подачи, но не твою личность в Telegram. Озвучка — Microsoft Edge TTS. Публичные посты X читаются через twitterapi.io.",
          ],
        },
        {
          id: "cookies",
          heading: "Куки",
          paragraphs: [
            "Одна подписанная кука сессии держит вход 30 дней, и ещё одна живёт 10 минут, пока ты подключаешь соцсеть. Счётчиков аналитики и рекламы нет. Недавние поиски хранятся только в твоём браузере.",
          ],
        },
        {
          id: "delete",
          heading: "Удаление данных",
          paragraphs: [
            "«Отключить» у соцсети в настройках сразу стирает имя её аккаунта. Чтобы удалить профиль, нажми «Удалить профиль» внизу раздела «Настройки → О проекте»: Telegram, адрес Kindle, выпуски, настройки, подключённые соцсети и черновики стираются сразу. Безымянные счётчики (даты заходов, события чтения и расход на модели) остаются без связи с тобой. Если войти не получается, напиши " +
              CONTACT_LABEL +
              " в Telegram с того аккаунта, которым входил, — удалим в течение 30 дней. Если отозвать доступ Reporta в настройках X, LinkedIn или Threads, подключением больше нельзя воспользоваться сразу.",
          ],
        },
        {
          id: "contact",
          heading: "Связь",
          paragraphs: ["Вопросы о политике — " + CONTACT_LABEL + " в Telegram."],
        },
      ],
    },
    terms: {
      title: "Условия использования",
      updated: "Обновлено 23 сентября 2026 г.",
      intro:
        "Эти условия действуют для Reporta (news.reporta.club) — персональной ленты новостей, которую ведёт Игорь Томко как частное лицо. Пользуясь сервисом, ты их принимаешь.",
      sections: [
        {
          id: "service",
          heading: "Сервис",
          paragraphs: [
            "Reporta собирает публичные источники новостей, отбирает материалы под тебя и пишет короткие пересказы со ссылками на оригиналы. Пересказы и черновики постов пишут модели ИИ, и в них бывают ошибки: сверяйся с оригиналом, прежде чем на них опираться.",
          ],
        },
        {
          id: "account",
          heading: "Аккаунт",
          paragraphs: [
            "Вход — через Telegram. Не передавай ссылку входа другим. За то, что ты делаешь с черновиками, включая публикацию в своих соцсетях, отвечаешь ты.",
          ],
        },
        {
          id: "paid",
          heading: "Тарифы и оплата",
          paragraphs: [
            "Есть бесплатный тариф и платные: Plus за $3.99 в месяц и Pro за $9.99 в месяц, цены в долларах США без учёта применимых налогов. Заказ оформляет наш онлайн-реселлер Paddle.com. Paddle.com — продавец (Merchant of Record) по всем нашим заказам: он отвечает на вопросы об оплате и проводит возвраты.",
            "Подписка продлевается каждый месяц, пока ты её не отменишь. Отменить можно в любой момент: Подписка → Управлять тарифом; отменённая подписка работает до конца оплаченного периода. Возвраты описаны в Политике возврата: news.reporta.club/refund.",
          ],
        },
        {
          id: "use",
          heading: "Допустимое использование",
          paragraphs: [
            "Нельзя использовать сервис для нарушения закона, перегружать его или пытаться получить данные других читателей. Такие аккаунты мы можем заблокировать.",
          ],
        },
        {
          id: "content",
          heading: "Содержимое",
          paragraphs: [
            "Статьи принадлежат их издателям; Reporta показывает короткие пересказы и ссылки на оригинал. Твои настройки, вставленные посты и черновики остаются твоими.",
          ],
        },
        {
          id: "liability",
          heading: "Без гарантий",
          paragraphs: [
            "Сервис предоставляется как есть, без гарантий доступности и точности. В пределах, которые допускает закон, мы не отвечаем за убытки от его использования.",
          ],
        },
        {
          id: "changes",
          heading: "Изменения и связь",
          paragraphs: [
            "Условия могут меняться; дата вверху показывает последнюю версию. Перестать пользоваться сервисом можно в любой момент. Связь — " +
              CONTACT_LABEL +
              " в Telegram.",
          ],
        },
      ],
    },
    refund: {
      title: "Политика возврата",
      updated: "Обновлено 23 сентября 2026 г.",
      intro:
        "Платные тарифы Reporta продаёт наш реселлер Paddle.com — продавец (Merchant of Record) по всем нашим заказам. Здесь сказано, когда и как вернуть деньги.",
      sections: [
        {
          id: "window",
          heading: "Возврат в течение 14 дней",
          paragraphs: [
            "Любой платёж, включая продление, возвращается полностью в течение 14 дней после списания. Причина не нужна.",
          ],
        },
        {
          id: "how",
          heading: "Как попросить",
          paragraphs: [
            "Открой paddle.net, найди заказ по почте, с которой платил, и попроси возврат там. Или напиши " +
              CONTACT_LABEL +
              " в Telegram — мы попросим Paddle вернуть деньги. Они приходят туда, откуда было списание; банки обычно показывают возврат за 5–10 рабочих дней.",
          ],
        },
        {
          id: "cancel",
          heading: "Отмена",
          paragraphs: [
            "Отмена останавливает следующие продления. Через 14 дней платёж не возвращается, но тариф работает до конца оплаченного периода.",
          ],
        },
      ],
    },
  },
};
