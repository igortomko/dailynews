-- Язык перестаёт быть списком из трёх. Три варианта выбрал не читатель,
-- а тот, кто писал форму, и любой четвёртый язык оказывался невозможен.
alter table dailynews.profile drop constraint if exists profile_language_check;
alter table dailynews.profile alter column language set default 'русском';

update dailynews.profile
   set language = case language
     when 'ru' then 'русском'
     when 'en' then 'английском'
     when 'pt' then 'португальском (бразильский вариант)'
     else language
   end
 where language in ('ru', 'en', 'pt');

insert into dailynews.migrations (name) values ('0014_language_free')
  on conflict (name) do nothing;
