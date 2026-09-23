-- Номер аккаунта в сети рядом с его именем. Имя меняют когда захотят,
-- а Meta, сообщая «читатель отозвал доступ» или «удали его данные»,
-- называет только номер (`user_id` в signed_request). Без него запрос
-- удаления нечем сопоставить с читателем, и он молча ничего не удалял бы.
alter table dailynews.reader_channels
  add column if not exists account_id text;

insert into dailynews.migrations (name) values ('0062_reader_channels_account_id')
  on conflict (name) do nothing;
