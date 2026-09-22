-- Произношение принадлежит языку, а не термину.
--
-- 0045 завела `spoken_terms` с ключом по одному термину, и первый же
-- прогон это опроверг: `Gemini` по-русски «джемини», по-японски ジェミニ,
-- по-корейски 제미나이. С ключом из одного слова первый ответивший язык
-- занимал бы строку для всех остальных, и японский читатель получал бы
-- кириллицу — вовремя, без ошибки и совершенно не ту.
--
-- Ошибка была видна в замысле: озвучка ключуется парой «материал + язык»
-- с самого начала, потому что перевод персонален по языку. Словарь
-- произношений устроен так же и должен был родиться таким.

alter table dailynews.spoken_terms
  add column if not exists language text not null default 'русском';

-- Ключ пересобирается целиком: `term` был первичным, и пока он им
-- остаётся, второй язык для того же термина вставить нечем.
alter table dailynews.spoken_terms
  drop constraint if exists spoken_terms_pkey;
alter table dailynews.spoken_terms
  add constraint spoken_terms_pkey primary key (term, language);

insert into dailynews.migrations (name) values ('0046_spoken_language')
  on conflict (name) do nothing;
