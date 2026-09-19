-- У dailynews_bot search_path указывает на extensions ради pg_trgm,
-- но USAGE на эту схему миграция 0001 не выдавала. Локальная проверка
-- на PGlite этого не видит: там роль владеет всем.
--
-- Схема extensions общая и системная, а не продуктовая: правило 4
-- инфра-документа запрещает ссылки в чужие продуктовые схемы, а не
-- обращение к расширениям. Права только на чтение схемы, не на данные.
grant usage on schema extensions to dailynews_bot;

insert into dailynews.migrations (name) values ('0004_extensions_usage')
  on conflict (name) do nothing;
