-- Иллюстрация материала из OG-разметки. В прежнем генераторе она была
-- и при переписывании потерялась: лента без картинок читается как список
-- ссылок, а не как новости.
alter table dailynews.items add column if not exists image_url text;

insert into dailynews.migrations (name) values ('0009_item_image')
  on conflict (name) do nothing;
