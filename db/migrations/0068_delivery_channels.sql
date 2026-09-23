-- Доставка по направлениям: Telegram, почта, Kindle.
--
-- `email_digest` — присылать ли выпуск письмом. Отдельно от `email`:
-- адрес — это ещё и вход, и «не присылай писем» не должно стирать
-- способ войти. Вошедшим по почте письмо включено сразу — это их
-- единственное направление; добавившему почту в настройках включается
-- подтверждением адреса.
alter table dailynews.readers
  add column if not exists email_digest boolean not null default false;

update dailynews.readers set email_digest = true
 where email is not null and telegram_id is null and not email_digest;

-- Каким путём читатель пришёл. Считается при заведении и не меняется:
-- привязанный потом Telegram не делает пришедшего по почте пришедшим
-- из бота, а дашборд разводит входы именно по этому.
alter table dailynews.readers
  add column if not exists entered_via text not null default 'telegram';

alter table dailynews.readers drop constraint if exists readers_entered_via_check;
alter table dailynews.readers
  add constraint readers_entered_via_check check (entered_via in ('telegram', 'email', 'google'));

update dailynews.readers set entered_via = 'email'
 where email is not null and telegram_id is null and entered_via = 'telegram';

-- Подкаст выпуска, сохранённый ради ссылки «Слушать» в письме.
--
-- Файл лежит в Telegram, у нас — только file_id: своего хранилища
-- аудио нет, и заводить его ради одной записи в сутки незачем. Частей
-- несколько, потому что Bot API отдаёт скачиванием файлы до 20 МБ,
-- а час речи при 48 кбит/с — это 21 МБ.
create table if not exists dailynews.podcast_audio (
  digest_id bigint primary key references dailynews.digests (id) on delete cascade,
  file_ids  text[] not null,
  seconds   integer not null,
  at        timestamptz not null default now()
);

insert into dailynews.migrations (name) values ('0068_delivery_channels')
  on conflict (name) do nothing;
