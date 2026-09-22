-- Колонка body_chars из 0047 снята.
--
-- Пока она ехала на прод, #117 убрал из ленты подпись «~6 мин» вместе
-- с расчётом, и читать колонку стало некому. Генерируемая колонка
-- при этом пересчитывалась regexp-ом при каждой записи body — плата
-- за число, которое никто не смотрит. 0047 остаётся в истории: она уже
-- применена и записана в журнал, а файл миграции не переписывается.
alter table dailynews.items drop column if exists body_chars;

insert into dailynews.migrations (name) values ('0049_drop_item_body_chars')
  on conflict (name) do nothing;
