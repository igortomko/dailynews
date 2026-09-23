-- Присылать ли выпуск в Telegram. Отдельно от `telegram_id`, как
-- `email_digest` от `email`: привязка — это ещё и вход и канал для
-- вопросов бота («продолжать?», «дочитал?»), и «не присылай выпуск»
-- не должно отвязывать аккаунт. По умолчанию включено — так выпуск
-- приходил всем привязанным до этой колонки.
alter table dailynews.readers
  add column if not exists telegram_digest boolean not null default true;

insert into dailynews.migrations (name) values ('0069_telegram_digest')
  on conflict (name) do nothing;
