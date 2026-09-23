-- Почта — вторая личность читателя рядом с Telegram.
--
-- Вход по ссылке из письма и через Google заводят читателя по адресу почты,
-- и этим же адресом выпуск ему и доставляется: чата бота у него нет.
-- Google и письмо сходятся на одной строке, если адрес один и тот же.
--
-- Хранится в нижнем регистре (приводит код), уникальность — по нему же:
-- «Igor@Gmail.com» и «igor@gmail.com» — один ящик и один читатель.
-- Пустых много (все, кто пришёл из Telegram), и unique их не сводит:
-- null в Postgres не равен null.
alter table dailynews.readers
  add column if not exists email text unique;

insert into dailynews.migrations (name) values ('0067_readers_email')
  on conflict (name) do nothing;
