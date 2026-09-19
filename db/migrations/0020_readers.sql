-- Лента перестаёт быть на одного.
--
-- Что осталось общим: источники, поток (items), дедуп и оценка Jev. Семь осей
-- из восьми про сам материал, восьмая — классификация по общему справочнику
-- topics. Поэтому сбор и скоринг идут один раз на всех: сто читателей стоят
-- в Jev столько же, сколько один.
--
-- Что стало персональным: веса осей, цели по темам, размер дайджеста, язык,
-- манера, сложность, контекст читателя, отбор, написанный текст и статистика
-- чтения. Дорожает только письмо дайджеста — оно персонально по определению.
--
-- Самая дорогая ошибка здесь — не падение, а чужая лента: она приходит вовремя,
-- выглядит правильно и просто не того читателя. Поэтому всё персональное
-- висит на reader_id, а не на «текущем» чём-нибудь.

-- Читатель. Личность — telegram_id: он неизменен и не переиспользуется.
-- username лежит рядом для писем и отладки, но опираться на него нельзя:
-- человек меняет его в Telegram когда захочет.
create table if not exists dailynews.readers (
  id             bigint generated always as identity primary key,
  -- Приватный чат в Telegram имеет тот же id, что и пользователь, поэтому
  -- отдельная колонка chat_id не заводится.
  -- null бывает ровно у одной строки: у перенесённой из profile, пока
  -- владелец не написал боту /start.
  telegram_id    bigint unique,
  username       text,
  -- Кем входит запасной вход по APP_PASSWORD. Не роль и не права: строка,
  -- перенесённая из profile, должна быть узнаваема, а «первый по id» —
  -- ровно тот неявный инвариант, который ломается молча.
  owner          boolean not null default false,

  reader_context text not null default '',
  digest_size    smallint not null default 12 check (digest_size between 3 and 100),
  -- Веса составного скора. Меняются калибровкой, поэтому данные, а не код.
  weights        jsonb not null default jsonb_build_object(
    'topic', 40, 'novelty', 20, 'specifics', 20, 'actionable', 10,
    'horizon', 10, 'kind', 25, 'clickbait', -30, 'depth', 15
  ),
  language       text not null default 'русском',
  complexity     smallint not null default 3 check (complexity between 1 and 5),
  style          text not null default 'нейтральный',
  llm            jsonb not null default '{}'::jsonb,

  -- Kindle. Адрес @kindle.com читатель вписывает сам.
  --
  -- Обратный адрес — свой на каждого: Amazon считает объём по адресу
  -- отправителя (E010 предупреждение, E011 последнее, E012 блокировка),
  -- и общий адрес копит счётчик на всех, а отваливается разом у всех.
  -- Локальная часть берётся из username один раз при заведении и дальше
  -- заморожена: её смена означает, что читатель заново проходит одобрение
  -- отправителя в настройках Amazon.
  kindle_address text,
  kindle_sender  text unique,

  -- Тариф. Колонку завела 0019_plan: её запись есть в журнале живой базы,
  -- а файла нет ни в одной ветке. Здесь она переезжает вместе со всем
  -- персональным, а не исчезает заодно с profile: платежей в Ленте нет,
  -- но и терять выставленное значение не за что.
  plan           text not null default 'free' check (plan in ('free', 'plus', 'pro')),

  -- Потолок расходов на модель в сутки. Вход бесплатный и мгновенный,
  -- значит завести сто аккаунтов может кто угодно; потолок ставится сразу,
  -- а не когда придёт счёт. Дайджест на двенадцать материалов стоит около
  -- цента, на сотню — около пяти.
  daily_cap_usd  real not null default 0.5 check (daily_cap_usd >= 0),

  onboarded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Владелец ровно один. Частичный индекс, а не check: check не умеет
-- смотреть на другие строки.
create unique index if not exists readers_owner_uniq
  on dailynews.readers (owner) where owner;

-- Перенос существующего читателя. Строка profile живая: в ней настоящий
-- reader_context, выставленные веса и пройденный онбординг. Обнулить её
-- значит потерять всё, ради чего лента настраивалась.
insert into dailynews.readers
  (owner, reader_context, digest_size, weights, language, complexity, style, llm, onboarded_at, updated_at)
select true, p.reader_context, p.digest_size, p.weights, p.language, p.complexity, p.style,
       p.llm, p.onboarded_at, p.updated_at
  from dailynews.profile p
 where p.id = 1
   and not exists (select 1 from dailynews.readers r where r.owner);

-- Тариф переносится отдельно и под проверкой: на чистой базе колонки
-- profile.plan нет вовсе — её миграция потерялась, — и безусловная ссылка
-- на неё уронила бы и verify:db, и первое применение на новом инстансе.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'dailynews' and table_name = 'profile' and column_name = 'plan'
  ) then
    update dailynews.readers r
       set plan = p.plan
      from dailynews.profile p
     where r.owner and p.id = 1;
  end if;
end $$;

-- Интересы читателя. topics остаётся общим справочником: по нему Jev
-- классифицирует поток один раз на всех. Персонально здесь только
-- «сколько новостей в день я хочу из этой темы».
--
-- Нет строки — тема не в ленте читателя. Отдельного флага не нужно:
-- отбор считает вес такой темы за единицу, как у материала вне тем,
-- и она перестаёт забирать свой прежний бюджет в тот же миг.
create table if not exists dailynews.reader_topics (
  reader_id bigint not null references dailynews.readers (id) on delete cascade,
  topic_id  bigint not null references dailynews.topics (id) on delete cascade,
  -- Цель по числу новостей в день. Ноль уронил бы отбор делением на ноль,
  -- а убрать тему — это удалить строку, и другого способа быть не должно.
  weight    real not null default 1 check (weight > 0),
  position  smallint not null default 0,
  primary key (reader_id, topic_id)
);

insert into dailynews.reader_topics (reader_id, topic_id, weight, position)
select r.id, t.id, t.weight, t.position
  from dailynews.readers r
  cross join dailynews.topics t
 where r.owner and t.active
on conflict (reader_id, topic_id) do nothing;

-- Выпуск принадлежит читателю. Один и тот же день у разных читателей —
-- разные выпуски, поэтому уникальность переезжает на пару.
alter table dailynews.digests add column if not exists reader_id bigint
  references dailynews.readers (id) on delete cascade;
update dailynews.digests d
   set reader_id = (select r.id from dailynews.readers r where r.owner)
 where d.reader_id is null;
alter table dailynews.digests alter column reader_id set not null;
alter table dailynews.digests drop constraint if exists digests_day_key;
create unique index if not exists digests_reader_day_uniq
  on dailynews.digests (reader_id, day);

-- Состав выпуска. Раньше это был массив item_ids в самом выпуске; теперь
-- у каждой строки есть собственный скор и собственный текст.
--
-- Текст персонален, потому что язык, сложность и манера персональны:
-- держать заголовок и описание в общей items означало бы, что второй
-- читатель переписывает ленту первого своим языком. Это и есть чужая
-- лента — приходит вовремя, выглядит правильно.
--
-- total — скор этого материала весами этого читателя на момент отбора.
-- Веса потом поменяются, а калибровка обязана сравнивать с тем, что было
-- показано.
create table if not exists dailynews.digest_items (
  digest_id     bigint not null references dailynews.digests (id) on delete cascade,
  item_id       bigint not null references dailynews.items (id) on delete cascade,
  total         real not null,
  position      smallint not null default 0,
  title         text,
  summary       text,
  summary_axes  jsonb,
  summary_score real,
  primary key (digest_id, item_id)
);

create index if not exists digest_items_item_idx on dailynews.digest_items (item_id);
create index if not exists digest_items_quality_idx
  on dailynews.digest_items (summary_score) where summary_score is not null;

-- Перенос состава и написанного текста. Блок выполняется только на первом
-- применении: db/verify.ts прогоняет все миграции склейкой дважды, и второй
-- заход приходит уже без колонок, из которых переносить.
--
-- Номер 0020, а не 0019: в журнале живой базы уже есть 0019_plan, а в ветке
-- auto-parse-feed-sources — 0019_source_input_url. Три разные миграции под
-- одним номером расходятся тем тише, чем дольше их не сводить.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'dailynews' and table_name = 'digests' and column_name = 'item_ids'
  ) then
    insert into dailynews.digest_items
      (digest_id, item_id, total, position, title, summary, summary_axes, summary_score)
    select d.id, u.item_id, coalesce(sc.total, 0), u.ord,
           i.title_ru, i.summary, i.summary_axes, i.summary_score
      from dailynews.digests d
      cross join lateral unnest(d.item_ids) with ordinality as u(item_id, ord)
      join dailynews.items i on i.id = u.item_id
 left join dailynews.scores sc on sc.item_id = u.item_id
    on conflict (digest_id, item_id) do nothing;
  end if;
end $$;

alter table dailynews.digests drop column if exists item_ids;
alter table dailynews.items
  drop column if exists title_ru,
  drop column if exists summary,
  drop column if exists summary_axes,
  drop column if exists summary_score;

-- scores.total остаётся: это скор при весах по умолчанию. Персональный
-- считается из axes весами читателя и живёт в digest_items.total. Колонку
-- не убираем не из осторожности: на неё смотрят индексы из 0002, и после
-- удаления повторный прогон миграций склейкой падал бы на их создании.

-- Событие чтения принадлежит тому, кто читал. Без этого калибровка
-- складывает чужие открытия со своими и перестаёт что-либо измерять.
alter table dailynews.reads add column if not exists reader_id bigint
  references dailynews.readers (id) on delete cascade;
update dailynews.reads
   set reader_id = (select r.id from dailynews.readers r where r.owner)
 where reader_id is null;
alter table dailynews.reads alter column reader_id set not null;
create index if not exists reads_reader_idx on dailynews.reads (reader_id, at desc);

-- Цена каждого вызова модели. Без строки на вызов потолок нечем проверять,
-- а перерасход виден только в счёте в конце месяца.
-- reader_id null — общий этап: сбор и скоринг идут один раз на всех.
create table if not exists dailynews.model_calls (
  id         bigint generated always as identity primary key,
  reader_id  bigint references dailynews.readers (id) on delete cascade,
  stage      text not null check (stage in ('score', 'digest', 'summary')),
  model      text not null default '',
  tokens_in  int not null default 0,
  tokens_out int not null default 0,
  cost_usd   real not null default 0,
  at         timestamptz not null default now()
);

create index if not exists model_calls_reader_at_idx
  on dailynews.model_calls (reader_id, at desc);

-- profile уезжает целиком: всё, что в ней было, теперь персонально.
-- Оставить её «на всякий случай» значит оставить таблицу, которую
-- следующий читатель кода примет за работающую (урок 0016).
drop table if exists dailynews.profile;

insert into dailynews.migrations (name) values ('0020_readers')
  on conflict (name) do nothing;
