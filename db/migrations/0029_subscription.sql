-- Подписка Lemon Squeezy.
--
-- Тариф в `plan` остаётся тем, что куплено, а действует ли он сейчас —
-- решают статус и даты. Хранить «действующий тариф» одной колонкой нельзя:
-- её пришлось бы гасить по расписанию, а расписание в этом продукте одно
-- и ходит раз в сутки — отменивший подписку читал бы платный выпуск
-- ещё сутки после конца оплаченного периода.
alter table dailynews.readers
  -- Идентификатор подписки в Lemon Squeezy. Пусто — читатель никогда не платил.
  add column if not exists subscription_id text,
  -- Статус оттуда же: active, on_trial, paused, past_due, cancelled, expired.
  -- Список не в check: его ведёт Lemon Squeezy, и новый статус с их стороны
  -- не должен ронять приём вебхука. Незнакомый читается как «не платит».
  add column if not exists subscription_status text,
  -- Когда продлится (активная) и когда кончится доступ (отменённая).
  -- Отменённая подписка работает до конца оплаченного периода: человек
  -- заплатил за месяц и получает месяц.
  add column if not exists plan_renews_at timestamptz,
  add column if not exists plan_ends_at timestamptz,
  -- Ссылка на их же страницу управления: смена карты, отмена, возобновление.
  -- Своего экрана для этого в продукте нет и не будет.
  add column if not exists portal_url text;

create index if not exists readers_subscription_idx
  on dailynews.readers (subscription_id)
  where subscription_id is not null;

insert into dailynews.migrations (name) values ('0029_subscription')
  on conflict (name) do nothing;
