-- Оценка собственного выхода. Jev уже оценивает входящий поток; здесь он
-- отвечает на вопросы о готовом описании: самодостаточно ли оно, не пересказ
-- ли заголовка, есть ли связь с читателем.
--
-- Словарь ловит механические признаки — слово «ключевой», развёрнутую
-- единицу. На вопрос «полезное ли это описание» он не отвечает, и никакая
-- регулярка не ответит.
alter table dailynews.items
  add column if not exists summary_axes jsonb,
  add column if not exists summary_score real;

create index if not exists items_summary_score_idx
  on dailynews.items (summary_score) where summary_score is not null;

insert into dailynews.migrations (name) values ('0012_summary_quality')
  on conflict (name) do nothing;
