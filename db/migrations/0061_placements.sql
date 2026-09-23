-- Откуда пришёл читатель.
--
-- Вход один — /start в боте, — и до этой миграции он не знал, по какой
-- ссылке его нажали: каналы и качество источников в дашборде стояли
-- выключенными, а пост в чужом канале нельзя было отличить от пустоты.
--
-- Каждое размещение ссылки получает свой код до того, как ссылка ушла
-- наружу: `t.me/<бот>?start=c_<код>`. Код и есть поле источника у
-- читателя — второго идентификатора рядом нет, поэтому строка читателя
-- соединяется с размещением без таблицы соответствий. Его форма решена
-- тем, что несёт полезная нагрузка /start: латиница, цифры, `_` и `-`,
-- до 64 знаков.
--
-- Размещение не удаляется, а снимается (`retired_at`): приведённые им
-- читатели указывают на код, и удалённая строка перевела бы их во все
-- отчёты «неизвестным».
create table if not exists dailynews.placements (
  code       text primary key check (code ~ '^[a-z0-9]{4,32}$'),
  name       text not null check (length(name) between 1 and 100),
  channel    text not null check (length(channel) between 1 and 40),
  cost_usd   numeric not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

-- Первое касание пишется один раз, при заведении читателя, и больше
-- не меняется: вернувшийся читатель по новой ссылке — визит, а не
-- привлечение. Пусто — источник неизвестен (заведён до этой миграции,
-- без кода или по коду, которого нет в реестре).
alter table dailynews.readers add column if not exists source text;

insert into dailynews.migrations (name) values ('0061_placements')
  on conflict (name) do nothing;
