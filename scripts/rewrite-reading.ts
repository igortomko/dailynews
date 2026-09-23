/** Rewrite an explicitly selected reader's latest edition; never delivers messages or email. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { sql } from '../src/lib/db';
import { getReader } from '../src/lib/readers';
import { effectiveVoice } from '../src/lib/billing';
import { writeDigest, type Survivor } from '../pipeline/digest';
import { pooled } from '../pipeline/fetch';

async function main() {
  const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
  const readerId = Number(arg('--reader'));
  if (!Number.isSafeInteger(readerId) || readerId <= 0 || !process.argv.includes('--apply')) throw new Error('Usage: rewrite-reading.ts --reader <id> --apply [--limit <n>] [--all] [--items <ids>] [--force]');
  const reader = await getReader(readerId);
  if (!reader?.reading_v2_enabled) throw new Error('Reading v2 is not enabled for this reader');
  const [digest] = await sql<{ id: number; day: string }[]>`select id::int,day::text from dailynews.digests where reader_id=${readerId} order by day desc limit 1`;
  if (!digest) throw new Error('No edition');
  const backup = await sql`select di.* from dailynews.digest_items di join dailynews.digests d on d.id=di.digest_id where d.reader_id=${readerId} and d.id=${digest.id}`;
  const dir = `/tmp/dailynews-reading-backup-${Date.now()}`;
  mkdirSync(dir, { mode: 0o700 });
  writeFileSync(`${dir}/digest.json`, JSON.stringify({ readerId, digest, items: backup }, null, 2), { mode: 0o600 });
  const rows = await sql<Survivor[]>`
    select i.id::int,i.title,i.excerpt,i.body,i.url,s.label as source_label,coalesce(t.label,'Прочее') as topic_label,di.total,sc.axes
    from dailynews.digests d join dailynews.digest_items di on di.digest_id=d.id
    join dailynews.items i on i.id=di.item_id join dailynews.sources s on s.id=i.source_id
    left join dailynews.scores sc on sc.item_id=coalesce(i.dup_of,i.id)
    left join dailynews.topics t on t.id=sc.topic_id
    where d.reader_id=${readerId} and d.id=${digest.id}
      ${process.argv.includes('--all') ? sql`` : sql`and coalesce(di.summary_document->>'status','') <> 'verified'`}
      ${process.argv.includes('--items') ? sql`and di.item_id = any(${arg('--items')!.split(',').map(Number)}::bigint[])` : sql``}
    order by di.position`;
  const limit = process.argv.includes('--limit') ? Number(arg('--limit')) : rows.length;
  if (!rows.length) { console.log(JSON.stringify({ readerId, day: digest.day, rewritten: 0, failed: 0, backup: dir })); return; }
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid limit or nothing to rewrite');
  let rewritten = 0, failed = 0;
  await pooled(rows.slice(0,limit), 3, async item => {
    const started = Date.now();
    try {
      const result = await writeDigest([item], reader.reader_context, effectiveVoice(reader), { readerId, force: process.argv.includes('--force') });
      if (result.excludedIds?.includes(item.id)) { console.log(JSON.stringify({ item: item.id, status: 'excluded-by-reader' })); return; }
      const written = result.items[0];
      if (!written?.reading) throw new Error('Expected reading document');
      writeFileSync(`${dir}/${item.id}.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
      if (written.reading.status !== 'verified') {
        failed++;
        const updated = await sql`update dailynews.digest_items di set summary=${written.summary},summary_document=${sql.json(written.reading)}
          from dailynews.digests d where d.id=di.digest_id and d.reader_id=${readerId} and d.id=${digest.id} and di.item_id=${item.id}
          and btrim(coalesce(di.summary,''))='' and coalesce(di.summary_document->>'status','')<>'verified'
          returning di.item_id`;
        console.log(JSON.stringify({ item: item.id, status: updated.length ? 'unavailable' : 'retained-previous' }));
        return;
      }
      await sql`update dailynews.digest_items di set title=${written.title_ru},summary=${written.summary},summary_document=${sql.json(written.reading)}
        from dailynews.digests d where d.id=di.digest_id and d.reader_id=${readerId} and d.id=${digest.id} and di.item_id=${item.id}`;
      rewritten++;
      console.log(JSON.stringify({ item: item.id, status: 'verified', blocks: written.reading.document?.blocks.map(b=>b.kind), seconds: Math.round((Date.now()-started)/1000) }));
    } catch (error) { failed++; console.error(`item ${item.id}: ${error instanceof Error ? error.message : 'failed'}`); }
  });
  console.log(JSON.stringify({ readerId, day: digest.day, rewritten, failed, backup: dir }));
  if (failed) process.exitCode=2;
}
main().catch(error => { console.error(error); process.exitCode=1; }).finally(() => sql.end());
