/**
 * Сколько карточек уже написано в идущей догрузке или переписывании.
 *
 * Работа идёт одним запросом серверного действия, и до его ответа тост
 * молчал: у Pro догрузка с разборами шла девять минут при обещанных двух,
 * и неподвижный тост читался как зависший. Спросить действие о ходе
 * нельзя — Next ставит вызовы действий одного клиента в очередь, и второй
 * ждал бы конца первого, — поэтому счёт отдаёт обычный роут
 * (`/api/rebuild/progress`), а пишут его сами функции работы.
 *
 * ponytail: память процесса — верно, пока веб один контейнер; при втором
 * счёт переедет в базу.
 */
type Progress = { done: number; total: number };

const running = new Map<number, Progress>();

export function startProgress(readerId: number, total: number) {
  running.set(readerId, { done: 0, total });
}

export function tickProgress(readerId: number, count: number) {
  const progress = running.get(readerId);
  if (progress) progress.done = Math.min(progress.total, progress.done + count);
}

export function endProgress(readerId: number) {
  running.delete(readerId);
}

export function progressOf(readerId: number): Progress | null {
  return running.get(readerId) ?? null;
}
