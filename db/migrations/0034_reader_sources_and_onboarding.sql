-- Источники становятся личными, а онбординг получает, с чего начать.
--
-- До этой миграции «источники тарифа» означали «первые N строк общего
-- каталога по id»: у всех читателей набор был один и тот же, а предел
-- тарифа резал его в одном и том же месте. Пока читатель был один, разницы
-- не было. На втором это ровно тот отказ, что выглядит как успех: выпуск
-- приходит вовремя, собран из чужих источников, и понять это по ленте
-- нельзя — источники в ней не названы предметом выбора.
--
-- Каталог остаётся общим, и это не компромисс: один фид, опрошенный один
-- раз, кормит всех, кто его выбрал. Персонален только выбор.
create table if not exists dailynews.reader_sources (
  reader_id bigint not null references dailynews.readers (id) on delete cascade,
  source_id bigint not null references dailynews.sources (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (reader_id, source_id)
);

-- Обратный индекс: прогон спрашивает «кому нужен этот источник», чтобы
-- не ходить за фидом, который не выбрал никто.
create index if not exists reader_sources_source_idx
  on dailynews.reader_sources (source_id);

-- Перенос: у всех, кто уже есть, набор был общим — им он и остаётся.
-- Пустой список после миграции означал бы ленту без единого источника
-- у читателя, который ничего не менял.
insert into dailynews.reader_sources (reader_id, source_id)
select r.id, s.id
  from dailynews.readers r
  cross join dailynews.sources s
 where s.deleted_at is null
on conflict (reader_id, source_id) do nothing;

alter table dailynews.readers
  -- Описание из Telegram. Забирается при /start и уходит в один вопрос Jev:
  -- какие из готовых интересов этому человеку ближе. Только порядок показа —
  -- выбирает всё равно он сам.
  add column if not exists bio text,
  -- Ответ на этот вопрос: слаги стартовых интересов по убыванию. Считается
  -- один раз при заведении, пока читатель подписывается на канал, а не при
  -- открытии страницы: вопрос к модели в середине первого экрана — это
  -- секунды ожидания там, где их видно лучше всего.
  add column if not exists suggested_topics text[] not null default '{}',
  -- Подписан ли на канал. Проверяется живым запросом к Telegram, здесь
  -- только отметка о пройденной проверке: она нужна, чтобы не спрашивать
  -- Telegram на каждое сообщение, и снимать её незачем — гейт стоит
  -- на входе, а не над лентой, которую уже настроили.
  add column if not exists channel_checked_at timestamptz;

insert into dailynews.migrations (name) values ('0034_reader_sources_and_onboarding')
  on conflict (name) do nothing;
