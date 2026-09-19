-- Что вставил человек, рядом с тем, что из этого вышло.
--
-- Источник теперь добавляется одной ссылкой: тип и адрес фида выясняет код.
-- Адрес фида почти никогда не совпадает со вставленным — youtube.com/@канал
-- превращается в feeds/videos.xml?channel_id=…, github.com/o/r — в
-- releases.atom. Без исходной ссылки в списке источников остаётся адрес,
-- который читатель никогда не видел и не узнаёт, и проверить, тот ли это
-- канал, нечем.
alter table dailynews.sources
  add column if not exists input_url text;

insert into dailynews.migrations (name) values ('0023_source_input_url')
  on conflict (name) do nothing;
