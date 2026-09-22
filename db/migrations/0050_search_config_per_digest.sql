-- Словарь поиска хранится с выпуском.
--
-- 0048 заморозила в векторе описаний один словарь на всех — russian.
-- Читателю с немецким, французским или португальским выпуском он не сводит
-- словоформы: точные формы находятся, склонения — нет. Словарь языка
-- у Postgres есть (`tsConfigFor` в src/lib/search.ts), и класть его надо
-- туда же, где лежит сам текст, — в строку выпуска: тогда вектор считается
-- словарём, которым выпуск написан, а сменивший язык читатель ищет старые
-- выпуски тем словарём, которым они были написаны.
--
-- Колонка regconfig, а не text: generated column требует неизменяемого
-- выражения, а приведение text → regconfig таковым не считается (оно ходит
-- в каталог). Сам to_tsvector(regconfig, text) неизменяем, и ссылка
-- на колонку строки в нём допустима. По умолчанию — общий словарь: старые
-- строки и любой писатель, который колонку не заполнил, остаются на нём,
-- то есть ровно на том, что было до этой миграции.
--
-- Вектор пересобирается: у generated column нельзя поменять выражение,
-- только снять и завести заново. Это второй перезапись digest_items
-- за вечер, двести строк.
--
-- Вектор источника (items.tsv) остаётся на общем словаре: материал один
-- на всех читателей. Запрос поэтому разбирается дважды — словарём выпуска
-- для описания и общим для источника, — и каждый вектор сравнивается
-- с запросом своего словаря (src/lib/queries.ts, found).
alter table dailynews.digest_items
  add column if not exists ts_config regconfig not null default 'russian'::regconfig;

alter table dailynews.digest_items drop column if exists tsv;

alter table dailynews.digest_items
  add column if not exists tsv tsvector
    generated always as (
      to_tsvector(ts_config, coalesce(title, '') || ' ' || coalesce(summary, ''))
    ) stored;

insert into dailynews.migrations (name) values ('0050_search_config_per_digest')
  on conflict (name) do nothing;
