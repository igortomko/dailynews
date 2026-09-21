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

-- Перенос из штук: карточка — 460 знаков (медиана по двумстам описаниям
-- живых выпусков), делённые на скорость чтения этого читателя.
--
-- Скорость здесь выписана числами, хотя живая копия лежит
-- в src/lib/reading-time.ts. Это не второй источник правды, а снимок мерки
-- на момент переноса: запрос отрабатывает ровно один раз, и расходиться
-- этим двум копиям с завтрашнего дня можно. Плоский коэффициент был бы
-- хуже: японская карточка идёт втрое медленнее русской, и её читателю
-- сорок карточек превратились бы в вдвое меньший заказ.
--
-- Только пустым: миграции применяются повторно целиком, и безусловный update
-- при повторе затёр бы заказанные минуты значением из `digest_size`, которое
-- с тех пор никто не менял. Ровно так 0008 падала на данных, заведённых 0010.
update dailynews.readers
   set digest_minutes = greatest(3, least(45, round(
         digest_size * 460.0 / (
           case
             when language in ('японском', 'китайском', 'корейском') then 400
             when language in ('английском', 'языке источника') then 1050
             when language in ('немецком', 'арабском') then 900
             when language = 'польском' then 930
             when language in ('нидерландском', 'турецком') then 950
             when language in (
               'португальском (бразильский вариант)', 'испанском',
               'итальянском', 'французском'
             ) then 1000
             else 960
           end
           * case complexity
               when 1 then 1.15 when 2 then 1.07 when 4 then 0.94 when 5 then 0.88
               else 1
             end
         )
       )))
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
