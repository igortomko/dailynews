-- Язык интерфейса читателя.
--
-- Отдельно от `language`: та колонка говорит, на каком языке написан выпуск,
-- и это решение про содержимое. Интерфейс — решение про окружение вокруг него,
-- и совпадать они не обязаны: читать новости по-русски, а кнопки видеть
-- по-английски — нормальный выбор, а одна колонка на двоих отняла бы его.
alter table dailynews.readers
  add column if not exists ui_language text;

-- Уже заведённым — русский: они пришли в русский продукт, и переключение
-- их интерфейса миграцией выглядело бы поломкой, а не новой возможностью.
-- Только пустым: миграции применяются повторно целиком, и безусловный update
-- при повторе затёр бы выбор, сделанный руками. Ровно так 0008 падала
-- на данных, заведённых 0010.
update dailynews.readers set ui_language = 'ru' where ui_language is null;

-- А новым — английский: продукт выходит за пределы русского языка,
-- и следующий читатель приходит не оттуда, откуда пришли первые.
alter table dailynews.readers alter column ui_language set default 'en';
alter table dailynews.readers alter column ui_language set not null;

-- Список закрыт: незнакомое значение означало бы интерфейс, которого нет,
-- и всплыло бы не здесь, а на первой же строке текста.
alter table dailynews.readers drop constraint if exists readers_ui_language_check;
alter table dailynews.readers
  add constraint readers_ui_language_check check (ui_language in ('en', 'ru'));
