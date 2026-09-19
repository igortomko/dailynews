-- Та же ошибка, что была с scores.axes: JSON.stringify поверх сериализации
-- драйвера клал в jsonb строку вместо объекта, и stats->>'jev_cost_usd'
-- молча возвращал null. Стоимость прогонов переставала быть видимой.
update dailynews.digests
   set stats = (stats #>> '{}')::jsonb
 where jsonb_typeof(stats) = 'string';

insert into dailynews.migrations (name) values ('0007_fix_stats_encoding')
  on conflict (name) do nothing;
