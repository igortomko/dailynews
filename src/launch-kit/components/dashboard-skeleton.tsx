/**
 * The dashboard's shape before its data: header, KPI tiles, the main chart and
 * two panels. A centred "loading" line reads as a stalled page after a second;
 * the shape tells the owner what is coming and where. Hosts use the same
 * component while the dashboard bundle itself is still downloading, so the
 * page does not switch between two different waiting screens.
 */
export function DashboardSkeleton() {
  const block = "animate-pulse rounded-lg bg-black/[0.06] motion-reduce:animate-none";
  return (
    <div className="min-h-screen" role="status" aria-busy="true">
      <span className="sr-only">Загружаем данные дашборда</span>
      <div className="mx-auto max-w-[1160px] px-3 pb-24 pt-7 sm:px-6 sm:pt-12" aria-hidden="true">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className={`${block} h-10 w-32`} />
          <div className={`${block} h-10 w-56`} />
          <div className={`${block} h-10 w-10`} />
        </div>
        <div className={`${block} mb-5 h-4 w-72`} />
        <div className="rounded-2xl border bg-white p-5 shadow-xs">
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="space-y-2">
                <div className={`${block} h-3 w-20`} />
                <div className={`${block} h-8 w-16`} />
              </div>
            ))}
          </div>
          <div className={`${block} h-64 w-full`} />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className={`${block} h-48`} />
          <div className={`${block} h-48`} />
        </div>
      </div>
    </div>
  );
}
