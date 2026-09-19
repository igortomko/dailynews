-- Выделенный почтовый ящик как источник.
--
-- Рассылки приходят почтой и больше никуда: у половины из них нет ни RSS,
-- ни веб-версии. url источника здесь — адрес отправителя, а не адрес фида:
-- одно письмо — один материал, отправитель опознаётся по From.
--
-- Ящик опрашивается по IMAP в том же ночном прогоне. Входящего эндпоинта
-- не заводится: на общей машине лишнего наружу быть не должно. Строка
-- подключения живёт в IMAP_URL и в образ не уезжает.
--
-- Дедуп идёт по Message-ID, а не по адресу: ссылка «посмотреть в браузере»
-- у половины рассылок одна и та же во всех выпусках, и второй выпуск молча
-- не доехал бы никогда. В items это уходит в url_canon как mid:<id>.
alter table dailynews.sources drop constraint if exists sources_kind_known;
alter table dailynews.sources
  add constraint sources_kind_known
  check (kind in ('rss', 'hackernews', 'reddit', 'x', 'telegram', 'email'));

insert into dailynews.migrations (name) values ('0022_source_email')
  on conflict (name) do nothing;
