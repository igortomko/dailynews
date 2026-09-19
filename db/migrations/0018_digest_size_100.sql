-- Потолок дайджеста поднимается с пятидесяти до ста.
--
-- Интерфейс предлагает 20, 40, 60, 80 и 100 — выбор из списка вместо поля
-- ввода. Без этой правки шестьдесят не сохранились бы вовсе: ограничение
-- отвергло бы запись, и форма показала бы ошибку там, где читатель ничего
-- не нарушал.
--
-- Сотня материалов в одну простыню JSON не помещается, поэтому дайджест
-- уходит в модель кусками по двадцать (pipeline/digest.ts). Без этого
-- ответ обрывался бы по потолку токенов, и половина описаний осталась бы
-- на языке источника — дайджест при этом пришёл бы целым на вид.
alter table dailynews.profile drop constraint if exists profile_digest_size_check;
alter table dailynews.profile
  add constraint profile_digest_size_check check (digest_size between 3 and 100);

insert into dailynews.migrations (name) values ('0018_digest_size_100')
  on conflict (name) do nothing;
