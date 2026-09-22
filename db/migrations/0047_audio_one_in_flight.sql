-- Одна озвучка на статью в работе, и это правда ограничение.
--
-- 0045 обещала его комментарием, а держалась на `insert ... where not
-- exists`: это проверка перед вставкой, только записанная внутри запроса.
-- Две одновременные транзакции читают одно и то же состояние и обе его
-- проходят — ровно тот случай, от которого проверка ставилась. Двойное
-- нажатие по карточке заводит две озвучки, читатель уходит за квоту
-- вдвое, и по журналу это выглядит как две законные отправки.
--
-- Дубли, которые старая проверка уже пропустила, надо снять до индекса:
-- `create unique index` не пропускает их, а падает, и миграция встала бы
-- на той самой поломке, которую чинит. Лишние помечаются провалом,
-- а не удаляются: строка отправки — это факт, а квота её и так не считает.
update dailynews.audio_sends a
   set status = 'failed', error = 'снято 0047: вторая озвучка той же статьи', seconds = 0
 where a.status in ('queued', 'translating', 'speaking', 'sending')
   and exists (
     select 1 from dailynews.audio_sends b
      where b.reader_id = a.reader_id and b.item_id = a.item_id
        and b.status in ('queued', 'translating', 'speaking', 'sending')
        and b.id < a.id
   );

-- Частичный индекс, а не полный: законченные отправки той же статьи
-- копятся и должны копиться — по ним считается квота дня. Уникальна
-- только незавершённая.
create unique index if not exists audio_sends_one_in_flight
  on dailynews.audio_sends (reader_id, item_id)
  where status in ('queued', 'translating', 'speaking', 'sending');

-- Язык перестаёт подставляться молча.
--
-- 0046 оставила `default 'русском'` после заполнения, и вставка без языка
-- тихо заводила русскую строку. Для словаря произношений это тот же отказ,
-- который 0046 и чинила: японский термин лёг бы под русским ключом,
-- а увидеть это можно было бы только на слух.
alter table dailynews.spoken_terms alter column language drop default;

insert into dailynews.migrations (name) values ('0047_audio_one_in_flight')
  on conflict (name) do nothing;
