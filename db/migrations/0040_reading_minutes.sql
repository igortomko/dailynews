-- Выпуск заказывается минутами чтения, а не числом карточек.
--
-- Читатель покупает не сорок карточек, а двадцать минут, за которые поймёт
-- главное. Число карточек остаётся предохранителем в коде (`plans.maxItems`),
-- а из обещания уходит: «сорок новостей» ничего не говорит о том, сколько
-- на них уйдёт времени, — а спрашивают именно об этом.
--
-- Колонка новая, а не переименованная. `digest_size` остаётся в базе
-- непрочитанной: переименовать её значило бы получить колонку с именем
-- «размер» и минутами внутри — ловушку для следующего, кто её откроет.
-- Снести отдельной миграцией дороже, чем не читать (так же живёт readers.llm).
alter table dailynews.readers
  add column if not exists digest_minutes smallint;

-- Перенос из штук: карточка — 460 знаков (медиана по двумстам описаниям),
-- читаются они примерно за 960 знаков в минуту, то есть карточка ≈ полминуты.
--
-- Только пустым: миграции применяются повторно целиком, и безусловный update
-- при повторе затёр бы заказанные минуты значением из `digest_size`, которое
-- с тех пор никто не менял. Ровно так 0008 падала на данных, заведённых 0010.
update dailynews.readers
   set digest_minutes = greatest(3, least(45, round(digest_size * 0.48)))
 where digest_minutes is null;

alter table dailynews.readers alter column digest_minutes set default 10;
alter table dailynews.readers alter column digest_minutes set not null;

-- Потолок совпадает с верхним значением списка в форме (READING_MINUTES)
-- и с потолком Pro. Разъедется — форма предложит число, которое база
-- отвергнет, и виноватым окажется читатель, ничего не нарушивший.
alter table dailynews.readers drop constraint if exists readers_digest_minutes_check;
alter table dailynews.readers
  add constraint readers_digest_minutes_check check (digest_minutes between 3 and 45);

insert into dailynews.migrations (name) values ('0040_reading_minutes')
  on conflict (name) do nothing;
