-- Как читать и чего сколько.
--
-- Три настройки одного решения: сложность языка, манера письма и сколько
-- новостей в день занимает каждая тема. Первые две меняют текст, третья —
-- состав.
--
-- Бюджет тем не заводит новой колонки: weight у тем есть с 0002. До сих пор
-- он умножал скор внутри темы, то есть не мог изменить дележ мест — отбор
-- раздавал их строго поровну (3-3-3-3-3-3 в живом дайджесте на двадцать
-- материалов, при том что фокус читателя был на одной теме). Теперь weight
-- означает ровно одно: цель по числу новостей в день. Отбор делит номер
-- материала внутри темы на неё, и при сумме целей, равной digest_size,
-- каждая тема получает примерно свою цель.
alter table dailynews.profile
  add column if not exists complexity smallint not null default 3
    check (complexity between 1 and 5),
  -- Без списка допустимых значений: три варианта в check выбрал бы тот, кто
  -- писал форму, и четвёртый стал бы миграцией. Код знает свои варианты сам
  -- и на незнакомое значение откатывается к нейтральному (урок 0014).
  add column if not exists style text not null default 'нейтральный';

-- Ноль в цели уронил бы отбор делением на ноль, а не просто спрятал тему:
-- убрать тему из дайджеста — это active = false, и другого способа быть
-- не должно. Прежние веса были долями (1.0) — переводим в цели, поделив
-- дайджест поровну; интерфейс всё равно приводит сумму к размеру.
update dailynews.topics t
   set weight = greatest(1, round(
         (select p.digest_size::numeric from dailynews.profile p where p.id = 1)
         / greatest((select count(*) from dailynews.topics where active), 1)
       ))
 where t.weight <= 1;

alter table dailynews.topics drop constraint if exists topics_weight_positive;
alter table dailynews.topics add constraint topics_weight_positive check (weight > 0);

insert into dailynews.migrations (name) values ('0017_reading_profile')
  on conflict (name) do nothing;
