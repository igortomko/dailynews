-- Пауза для спящего читателя.
--
-- Выпуск стоит денег каждую ночь, а читатель, который две недели не открывал
-- ленту, их не тратит осмысленно. Пауза ставится сама, снимается одной
-- кнопкой в боте или первым же заходом на сайт.
alter table dailynews.readers
  -- Пусто — лента идёт. Время — с какого момента выпуск не пишется.
  add column if not exists paused_at timestamptz,
  -- Когда спросили «продолжать?». Отдельно от паузы: без этой отметки
  -- вопрос уходил бы каждую ночь, пока читатель не ответит.
  add column if not exists sleep_asked_at timestamptz;

insert into dailynews.migrations (name) values ('0032_sleep')
  on conflict (name) do nothing;
