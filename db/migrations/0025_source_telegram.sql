-- Публичные каналы Telegram.
--
-- Только веб-просмотр t.me/s/<канал>: Bot API читает лишь те каналы, где бот
-- админ, а MTProto с личной сессией на общей машине — отдельное решение
-- владельца. В интерфейсе это сказано вслух, а не выясняется на практике.
--
-- Ограничение переименовано намеренно. Прежнее звалось sources_kind_check,
-- и переопределение под тем же именем проверка формы схемы не видит: 0018
-- уже проскочил так молча. Новое имя — то, чего в живой базе точно нет,
-- пока миграция не применена, и npm run ping это назовёт.
alter table dailynews.sources drop constraint if exists sources_kind_check;
alter table dailynews.sources drop constraint if exists sources_kind_known;
alter table dailynews.sources
  add constraint sources_kind_known
  check (kind in ('rss', 'hackernews', 'reddit', 'x', 'telegram'));

insert into dailynews.migrations (name) values ('0025_source_telegram')
  on conflict (name) do nothing;
