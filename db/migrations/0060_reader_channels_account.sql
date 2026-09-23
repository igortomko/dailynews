-- Чей аккаунт подключён к площадке: «@ник» из X и Threads, имя из LinkedIn.
-- Ставится только вернувшимся из сети подтверждением, поэтому пустое при
-- `publishes = true` значит «подключено без входа в сеть» — у сети не
-- заведено приложение, или это Telegram, где вход через бота уже сделан.
-- Токенов не храним: мы ничего не публикуем за читателя, и ключ к его
-- аккаунту, лежащий без дела, — это только риск.
alter table dailynews.reader_channels
  add column if not exists account text;

insert into dailynews.migrations (name) values ('0060_reader_channels_account')
  on conflict (name) do nothing;
