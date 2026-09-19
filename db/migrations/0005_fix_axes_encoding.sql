-- axes записывались двойным кодированием: JSON.stringify поверх сериализации
-- драйвера клал в jsonb строку вместо объекта. Чтение из приложения это
-- переживало (строка разбиралась на месте), а извлечение в SQL — нет:
-- axes->'kind' молча возвращал null, и разбивка калибровки по осям была пуста.
update dailynews.scores
   set axes = (axes #>> '{}')::jsonb
 where jsonb_typeof(axes) = 'string';

insert into dailynews.migrations (name) values ('0005_fix_axes_encoding')
  on conflict (name) do nothing;
