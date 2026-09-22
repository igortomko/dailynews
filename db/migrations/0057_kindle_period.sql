-- Выпуск на читалку: каждое утро или одной книгой в субботу.
--
-- Тумблер отвечал на «присылать ли», а не на «как часто», а это разные
-- вопросы: ежедневная книга — это ежедневное решение сесть читать, и тот,
-- кто читает на выходных, выключал доставку целиком вместо того, чтобы
-- получать её реже.
--
-- Недельная книга не стоит ни цента сверх дневной: в ней ровно те выпуски,
-- что уже написаны и лежат в digest_items, собранные в один файл. Ни одного
-- вызова модели, одно письмо Resend вместо семи.
--
-- Текстовая колонка с ограничением, а не boolean: 'weekly' читается в логе
-- и в запросе тем же словом, каким названо в интерфейсе, а `kindle_weekly
-- = false` пришлось бы переводить обратно на каждом чтении. Ограничение
-- пересоздаётся, а не добавляется: миграции применяются повторно целиком,
-- и `add constraint` упал бы на собственном следе.
alter table dailynews.readers
  add column if not exists kindle_period text not null default 'daily';

alter table dailynews.readers
  drop constraint if exists readers_kindle_period_check;

alter table dailynews.readers
  add constraint readers_kindle_period_check
  check (kindle_period in ('daily', 'weekly'));

-- День последней недельной отправки. Прогон запускают дважды за сутки
-- (повторный прогон, ручной запуск), и вторая книга за тот же день — это
-- чужой счётчик объёма у Amazon: E010 предупреждение, E011 последнее,
-- E012 блокировка отправителя с формулировкой «personal, non-commercial
-- use only». У дневной отправки такой защиты нет и не нужно — её объём
-- читатель заказал сам; недельная приходит раз в семь дней, и второй раз
-- за тот же день означает только сбой.
--
-- Дата, а не флаг: флаг пришлось бы гасить, а гасить его некому.
alter table dailynews.readers
  add column if not exists kindle_weekly_at date;

insert into dailynews.migrations (name) values ('0057_kindle_period')
  on conflict (name) do nothing;
