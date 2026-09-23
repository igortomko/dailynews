/**
 * Таймер выпусков: раз в десять минут собрать выпуск тем, у кого
 * по их поясу наступило 02:00 (`issueDue`).
 *
 * Живёт в уже работающем веб-процессе, а не отдельным: заводить постоянный
 * процесс или crontab на общей машине нельзя, а расписание Actions опаздывает
 * на четыре-пять часов и времени не держит. Сбор и оценка остаются в Actions —
 * там WARP для субтитров, — а сюда приходит только письмо выпуска, то же,
 * что у кнопки «Собрать сейчас».
 *
 * Включается переменной (`ISSUE_TICK=1` в docker-compose), а не окружением
 * сборки: `npm run dev` и `npm start` на ноутбуке ходят в ту же боевую базу,
 * и таймер там разослал бы настоящие выпуски настоящим читателям.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.ISSUE_TICK !== "1") return;

  const { issueDue } = await import("../pipeline/issue");
  // Круг может идти дольше десяти минут (подкаст — до десяти на читателя),
  // и второй поверх первого делил бы с ним одно ядро контейнера.
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { issued, cost } = await issueDue();
      if (issued > 0) console.log(`выпуски по поясам: ${issued}, $${cost.toFixed(4)}`);
    } catch (error) {
      console.error(`таймер выпусков: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  // Первый круг не сразу: register задерживает готовность сервера,
  // а проверка здоровья после развёртывания ждёт ответа.
  setTimeout(tick, 60_000);
  setInterval(tick, 10 * 60_000);
}
