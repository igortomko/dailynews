-- Переходы подписки в воронке: назначил отмену, передумал, повысил,
-- понизил, платёж не прошёл. До этого между «заплатил» и «ушёл» было пусто:
-- отток виден, когда отмена уже вступила в силу, — на месяц позже решения.
-- Список пишется целиком: таблица своя, чужих имён в нём нет.
alter table dailynews.billing_events drop constraint if exists billing_events_name_check;
alter table dailynews.billing_events add constraint billing_events_name_check check (name in (
  'plans_viewed', 'checkout_started', 'trial_started',
  'payment_succeeded', 'payment_refunded', 'canceled',
  'cancel_scheduled', 'resumed', 'upgraded', 'downgraded', 'payment_failed'));

insert into dailynews.migrations (name) values ('0072_billing_transitions')
  on conflict (name) do nothing;
