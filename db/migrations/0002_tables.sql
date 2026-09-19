-- dailynews: прикладные таблицы.
-- Ни одной ссылки за пределы схемы (правило 4 инфра-документа).

-- Читатель один. Одна строка, id зафиксирован.
create table if not exists dailynews.profile (
  id             smallint primary key default 1 check (id = 1),
  reader_context text not null default '',
  digest_size    smallint not null default 12 check (digest_size between 3 and 50),
  -- Веса составного скора. Меняются калибровкой, поэтому данные, а не код.
  weights        jsonb not null default jsonb_build_object(
    'topic', 40, 'novelty', 20, 'specifics', 20, 'actionable', 10,
    'horizon', 10, 'kind', 25, 'clickbait', -30, 'depth', 15
  ),
  onboarded_at   timestamptz,
  updated_at     timestamptz not null default now()
);
insert into dailynews.profile (id) values (1) on conflict (id) do nothing;

-- Интересы читателя. Один и тот же список служит тремя вещами:
-- вариантами choice-вопроса для Jev, вкладками в интерфейсе и осями калибровки.
create table if not exists dailynews.topics (
  id         bigint generated always as identity primary key,
  slug       text not null unique,
  label      text not null,
  hint       text not null default '',          -- описание варианта, уходит в criteria Jev
  weight     real not null default 1.0,         -- подкручивается калибровкой
  position   smallint not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists dailynews.sources (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('rss', 'hackernews', 'reddit', 'x')),
  label      text not null,
  -- Смысл поля зависит от kind: адрес фида, имя сабреддита,
  -- 'topstories' или поисковый запрос X.
  url        text not null,
  config     jsonb not null default '{}'::jsonb,
  active     boolean not null default true,
  last_ok_at timestamptz,
  -- Сколько свежих материалов дал последний прогон. Источник, который
  -- отвечает 200 и отдаёт ноль, — самая незаметная поломка в ленте.
  last_count int,
  last_error text,
  created_at timestamptz not null default now(),
  unique (kind, url)
);

-- Весь поток без фильтрации. Отбор происходит ниже, в scores.
create table if not exists dailynews.items (
  id           bigint generated always as identity primary key,
  source_id    bigint not null references dailynews.sources (id) on delete cascade,
  url          text not null,
  url_canon    text not null unique,            -- без utm и прочего мусора
  title        text not null,
  title_norm   text not null,                   -- по нему ищутся дубли через pg_trgm
  excerpt      text not null default '',
  -- Заполняются при попадании в дайджест: до отбора писать их незачем.
  title_ru     text,
  summary      text,
  points       int,
  comments     int,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  dup_of       bigint references dailynews.items (id) on delete set null
);

create index if not exists items_collected_idx on dailynews.items (collected_at desc);
create index if not exists items_title_norm_trgm on dailynews.items using gin (title_norm extensions.gin_trgm_ops);

-- Ответы Jev. axes держит все вопросы целиком, чтобы перекалибровать
-- веса задним числом, не прогоняя поток заново.
create table if not exists dailynews.scores (
  item_id    bigint primary key references dailynews.items (id) on delete cascade,
  topic_id   bigint references dailynews.topics (id) on delete set null,
  total      real not null,
  confidence real not null,                     -- средняя уверенность по осям
  axes       jsonb not null,
  model      text not null,
  scored_at  timestamptz not null default now()
);

create index if not exists scores_topic_total_idx on dailynews.scores (topic_id, total desc);
create index if not exists scores_total_idx on dailynews.scores (total desc);

create table if not exists dailynews.digests (
  id       bigint generated always as identity primary key,
  day      date not null unique,
  intro    text not null default '',
  item_ids bigint[] not null default '{}',
  stats    jsonb not null default '{}'::jsonb,  -- собрано/дублей/оценено/стоимость
  sent_at  timestamptz,
  created_at timestamptz not null default now()
);

-- Сигнал калибровки. score_snap и conf_snap — снимок на момент чтения:
-- веса потом поменяются, а сравнивать надо с тем, что было показано.
create table if not exists dailynews.reads (
  id         bigint generated always as identity primary key,
  item_id    bigint not null references dailynews.items (id) on delete cascade,
  event      text not null check (event in ('opened', 'dwell', 'outbound', 'dismissed')),
  dwell_ms   int,
  score_snap real,
  conf_snap  real,
  at         timestamptz not null default now()
);

create index if not exists reads_item_idx on dailynews.reads (item_id);
create index if not exists reads_at_idx on dailynews.reads (at desc);

insert into dailynews.migrations (name) values ('0002_tables')
  on conflict (name) do nothing;
