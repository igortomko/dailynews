-- Тариф читателя.
--
-- Пределы тарифа живут в коде (src/lib/plans.ts), здесь только то, какой
-- тариф у профиля. Колонка с перечнем в check, а не отдельной таблицей:
-- трёх значений не бывает больше, чем цен в прайсе, а лишняя таблица
-- потребовала бы join в каждом запросе профиля ради трёх строк.
--
-- Значение по умолчанию — бесплатный: новый профиль не должен получать
-- платный источник до того, как кто-то решил, что он за него платит.
alter table dailynews.profile
  add column if not exists plan text not null default 'free';

alter table dailynews.profile drop constraint if exists profile_plan_check;
alter table dailynews.profile add constraint profile_plan_check
  check (plan in ('free', 'plus', 'pro'));

-- Владелец единственного профиля платит за всё сам — ему Pro. На пустой
-- базе строки ещё нет, и update просто не найдёт её.
update dailynews.profile set plan = 'pro' where id = 1;

insert into dailynews.migrations (name) values ('0019_plan')
  on conflict (name) do nothing;
