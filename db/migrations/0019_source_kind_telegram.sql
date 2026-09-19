-- Telegram-каналы как вид источника. Читается публичный веб-просмотр
-- t.me/s/<канал>: ключей не нужно и наружу ничего не выставляется.
-- Цена решения — только публичные каналы: Bot API отдаёт лишь те, где бот
-- администратор, а MTProto потребовал бы держать файл личной сессии
-- на общей машине рядом с чужими продуктами.
--
-- Ограничение пересоздаётся целиком: check нельзя дополнить, а перечисление
-- видов должно остаться в одном месте, а не разъехаться по миграциям.
alter table dailynews.sources drop constraint if exists sources_kind_check;
alter table dailynews.sources
  add constraint sources_kind_check
  check (kind in ('rss', 'hackernews', 'reddit', 'x', 'telegram'));

insert into dailynews.migrations (name) values ('0019_source_kind_telegram')
  on conflict (name) do nothing;
