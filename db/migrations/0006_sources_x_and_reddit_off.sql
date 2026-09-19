-- Reddit выключен: Data API выдаётся по заявке с основанием для модерации,
-- которого у персональной читалки нет. Анонимный RSS отдаёт 429 уже на
-- втором сабреддите при любых паузах — проверено вплоть до восьми секунд.
-- Источники не удаляются: заявку можно подать позже, а на них ссылаются
-- уже собранные материалы.
update dailynews.sources set active = false where kind = 'reddit';

-- X через перепродавца: официальный API берёт $5 за тысячу прочитанных
-- постов, twitterapi.io — около $0.15. Одна страница на источник, это
-- двадцать постов в день на каждый.
insert into dailynews.sources (kind, label, url, config) values
  ('x', 'X · AI-инфра',
   '("AI datacenter" OR "inference cost" OR "GPU cluster" OR "model release") min_faves:150',
   '{"max_pages": 1}'::jsonb),
  ('x', 'X · уран и SMR',
   '(uranium OR SMR OR "nuclear power" OR enrichment) min_faves:100',
   '{"max_pages": 1}'::jsonb),
  ('x', 'X · демография',
   '(fertility OR birthrate OR demographic OR depopulation) min_faves:150',
   '{"max_pages": 1}'::jsonb)
on conflict (kind, url) do nothing;

insert into dailynews.migrations (name) values ('0006_sources_x_and_reddit_off')
  on conflict (name) do nothing;
