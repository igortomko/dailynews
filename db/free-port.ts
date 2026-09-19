import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

/**
 * Свободный порт для базы в процессе.
 *
 * Порт был прибит числом, и это тихо врало при параллельной работе:
 * две ветки в соседних worktree запускают проверку одновременно, второй
 * сервер порт не занимает, а клиент соединяется с чужим — и сверка схемы
 * показывает расхождения там, где их нет. Обратный случай хуже: чужая
 * база отвечает «всё на месте», и проверка проходит, ничего не проверив.
 */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
