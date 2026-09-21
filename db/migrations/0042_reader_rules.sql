-- Личные правила отбора: за чем следить и что исключать.
--
-- Читатель выбирает широкие интересы («Дизайн и продукт») и сверх того
-- называет конкретное: Figma, Framer, Webflow. Материал из его источников,
-- где это упомянуто, встаёт в очереди своей темы первым; материал
-- с исключённым названием в его выпуск не попадает вовсе.
--
-- Две колонки на читателе, а не своя таблица. Правило читается ровно там,
-- где читатель уже загружен, — в отборе, в догрузке, в ленте, — и таблица
-- дала бы join ради двадцати строк. Колонка приезжает вместе с остальными
-- полями читателя, и `npm run verify:db` сверяет, что код её выбирает:
-- забытая в списке колонка ломала бы отбор молча, как 0029 ломала тариф.
--
-- Форма: массив правил, правило — массив написаний одного и того же:
-- `[["Figma", "Фигма"], ["Framer"]]`. Первое написание показывается,
-- по всем ищется. Ограничение проверяет только верхний уровень — что это
-- массив, а не строка: против классической здешней ошибки, когда
-- `JSON.stringify` в jsonb кладёт строку вместо массива и правило молча
-- перестаёт применяться (урок 0005). Форму элементов база не проверяет
-- (в check нельзя подзапрос, а неизменяемая функция ради этого — лишняя
-- сущность): за неё отвечает cleanRules при записи, а asNames при чтении
-- терпит мусор внутри правила, отбрасывая его.
--
-- Правила личные: они не расширяют общий справочник тем и не меняют вопрос
-- Jev, — поэтому сто читателей стоят в скоринге столько же, сколько один.
-- Всё, что они делают, происходит в коде отбора уже после оценки.
alter table dailynews.readers
  add column if not exists follow_rules jsonb not null default '[]'::jsonb,
  add column if not exists exclude_rules jsonb not null default '[]'::jsonb;

alter table dailynews.readers drop constraint if exists readers_follow_rules_array;
alter table dailynews.readers
  add constraint readers_follow_rules_array check (jsonb_typeof(follow_rules) = 'array');

alter table dailynews.readers drop constraint if exists readers_exclude_rules_array;
alter table dailynews.readers
  add constraint readers_exclude_rules_array check (jsonb_typeof(exclude_rules) = 'array');

insert into dailynews.migrations (name) values ('0042_reader_rules')
  on conflict (name) do nothing;
