-- Отправку выпуска на Kindle выключает переключатель, а не пустой адрес.
--
-- Раньше адрес отвечал за два разных решения сразу: куда слать и слать ли.
-- Пока на Kindle уходил только выпуск, это совпадало. Но адресом пользуется
-- и ручная отправка отдельной статьи, и стереть его ради «не присылай мне
-- выпуск» значит заодно выключить то, о чём читатель не просил.
--
-- Значение по умолчанию true: у кого адрес уже вписан, поведение прежнее.
alter table dailynews.readers
  add column if not exists kindle_digest boolean not null default true;

insert into dailynews.migrations (name) values ('0021_kindle_digest')
  on conflict (name) do nothing;
