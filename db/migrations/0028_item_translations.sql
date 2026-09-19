-- Перевод статьи — свойство статьи, а не читателя.
--
-- Один и тот же материал из Hacker News попадает в выпуск ко всем, кто
-- держит эту тему. Каждая отправка на читалку переводила его заново
-- и платила заново, хотя результат байт в байт тот же: перевод зависит
-- от текста и языка, и больше ни от чего. Сложность и манера — настройки
-- дайджеста, к переводу они отношения не имеют, поэтому в ключе их нет.
--
-- Экономия растёт с числом читателей: при одном она нулевая, при двадцати
-- с общей темой — девятнадцать переводов из двадцати не случаются.
create table if not exists dailynews.item_translations (
  item_id  bigint not null references dailynews.items (id) on delete cascade,
  -- Язык словом, как он лежит у читателя: он же уходит в промпт.
  language text not null,
  markdown text not null,
  model    text not null,
  at       timestamptz not null default now(),
  primary key (item_id, language)
);

insert into dailynews.migrations (name) values ('0028_item_translations')
  on conflict (name) do nothing;
