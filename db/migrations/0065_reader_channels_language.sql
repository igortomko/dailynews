-- Язык поста для каждой сети.
--
-- Автор пишет в Telegram по-русски, а в X по-английски. Пока язык жил
-- в тексте стиля («X — всегда по-английски»), он пропадал при каждой
-- загрузке нового skill-файла: загрузка заменяет поле целиком. Язык — это
-- свойство площадки, а не манеры письма, и лежит рядом с ней.
--
-- Пусто — как в стиле: язык не называется, модель пишет тем языком, каким
-- написаны стиль и материал. Значение — ключ из `LANGUAGES` (предложный
-- падеж, как у `readers.language`): оно уходит в промпт строкой.
alter table dailynews.reader_channels
  add column if not exists language text;

insert into dailynews.migrations (name) values ('0065_reader_channels_language')
  on conflict (name) do nothing;
