-- Отправка отдельной статьи на читалку: журнал отправок, полный текст
-- из фида и две петли измерения вокруг перевода.
--
-- Выпуск на Kindle уже уходит (0021), но выпуск — это заголовки и описания,
-- которые читатель и так видел в ленте. Здесь другое: статья целиком,
-- переведённая, книгой. Это минута работы и около цента, поэтому у неё
-- есть журнал, а у выпуска его нет.

-- Полный текст из фида. Substack и WordPress отдают статью целиком
-- в content:encoded, а fetch.ts до сих пор обрезал её до 1200 знаков
-- excerpt'а и выбрасывал остальное. Для этих источников забирать статью
-- по ссылке незачем: текст уже приехал, он чистый и достался даром.
--
-- Хранится не вечно: чистится вместе с потоком, иначе триста материалов
-- в день по десять килобайт съедят базу за месяц.
alter table dailynews.items
  add column if not exists body text;

-- Журнал отправок. Нужен трём вещам: не слать дубль по второму тапу,
-- показать на карточке, что отправка идёт, и увидеть провал.
--
-- Провал здесь обязан быть видимым. При неодобренном отправителе Amazon
-- не отвечает ошибкой: он уведомляет владельца читалки (код E014) и молча
-- выбрасывает письмо. Со стороны сервиса это выглядит как успех.
create table if not exists dailynews.kindle_sends (
  id         bigint generated always as identity primary key,
  reader_id  bigint not null references dailynews.readers (id) on delete cascade,
  item_id    bigint not null references dailynews.items (id) on delete cascade,
  status     text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error      text,
  -- Сколько слов уехало на читалку. По нему видно, что забрали статью,
  -- а не форму подписки: отказ такого рода выглядит как успех.
  words      int,
  -- Вторая петля Jev, теперь вокруг перевода. У описаний она есть с 0012,
  -- и правки их промпта опираются на ряд чисел, а не на впечатление.
  -- У перевода до сих пор были только механические проверки — число
  -- блоков и длина. Текст проходит обе и остаётся плохим русским.
  quality_axes  jsonb,
  quality_total real,
  at         timestamptz not null default now()
);

-- Второй тап по кнопке не должен слать вторую книгу. Провалившуюся
-- отправку повторить можно: частичный индекс держит только живые.
create unique index if not exists kindle_sends_live
  on dailynews.kindle_sends (reader_id, item_id)
  where status in ('queued', 'sent');

create index if not exists kindle_sends_at_idx on dailynews.kindle_sends (at desc);

-- Дочитал ли он то, что отправил себе на читалку.
--
-- Это единственная часть продукта без петли измерения. У отбора она есть
-- (скор против открытий), у описаний есть (шесть осей Jev), у отправки
-- не было ничего. Amazon обратно не скажет ничего и не может, поэтому
-- спрашивает бот на следующий день, одной кнопкой.
--
-- Автор DropKind на тот же вопрос отвечает «процентов 80, это моя личная
-- оценка» — измерить он не может, ему приходит голая ссылка. Лента знает,
-- что именно отправила и с каким скором, и поэтому может.
alter table dailynews.reads drop constraint if exists reads_event_check;
alter table dailynews.reads
  add constraint reads_event_check
  check (event in ('seen', 'opened', 'dwell', 'outbound', 'dismissed', 'up', 'down',
                   'kindled', 'finished', 'unfinished'));

-- Перевод статьи — такой же оплаченный вызов, как дайджест, и он обязан
-- попадать в тот же счётчик: потолок читателя считается по model_calls,
-- и этап, которого нет в ограничении, ронял бы запись целиком — а с ней
-- и отправку, уже оплаченную.
alter table dailynews.model_calls drop constraint if exists model_calls_stage_check;
alter table dailynews.model_calls
  add constraint model_calls_stage_check
  check (stage in ('score', 'digest', 'summary', 'translate', 'translation-quality'));

insert into dailynews.migrations (name) values ('0027_kindle_article')
  on conflict (name) do nothing;
