/**
 * Отбивка между новостями в подкасте.
 *
 * Байтами, а не файлом рядом: подкаст собирается в вебе (`after()`
 * в роуте), а сборка Next копирует в standalone только то, что видит
 * через импорты. Файл, прочитанный по пути, на проде бы не нашёлся —
 * и узнали бы мы об этом по первому подкасту без отбивок, а не по ошибке.
 *
 * Формат тот же, что у речи (24 кГц, моно, 48 кбит/с): кадры mp3
 * стыкуются встык только с такими же, и перекодировать на проде нечем.
 * ID3 и Xing сняты — заголовок посреди потока декодер читает как мусорный
 * кадр, а их здесь было бы по одному на каждый стык.
 *
 * Здесь лежала тишина в 1,2 секунды. Тишина разделяла, но не означала
 * ничего: карточка и так начинается со своего заголовка, и граница между
 * сюжетами звучала как затянувшаяся запятая. Три ноты челесты вверх —
 * это заставка: слушатель слышит не «тут пауза», а «это кончилось,
 * дальше следующее». Выбрано слухом из десяти вариантов, сгенерённых
 * и подрезанных под этот стык; одна нота (колокольчик) проиграла ровно
 * тем, чем проигрывала тишина, — в ней нет движения.
 *
 * Пик −14 дБ против −4 дБ у голоса: отбивка звучит в подкасте из сорока
 * карточек тридцать девять раз, и та, что громче речи, на третий раз
 * становится помехой. Своё затухание встроено в файл (0,15 с тишины
 * в начале, 0,4 с в конце) — движок и так оставляет около 0,9 с в хвосте
 * каждой карточки, и вместе выходит пауза с отбивкой внутри, а не
 * отбивка встык к слову.
 *
 * Длина нигде не записана числом: её считают из самих байтов
 * (`STING_MP3.length / BYTES_PER_SECOND` в `tts.ts`). Число рядом
 * разъехалось бы с файлом при первой же замене звука, и разъехалось бы
 * молча — в расходе квоты.
 */
export const STING_MP3 = Buffer.from(
  "//NkxAAAAANIAAAAAExBTUVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "//NkxHwAAANIAAAAAFVVVVVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "//NkxHwAAANIAAAAAFVVVVVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "//NkxHwAAANIAAAAAFVVVVVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "//NkxHwAAANIAAAAAFVVVVVVVVUAgEBATxyACRL4GNQiBJX+BggigaPJ/4GyR6BjgIAY3E/+BlUFgDCgDB4HAxOBf/AwEGgB" +
  "hYAURBDgCgR/+AwJBUgbmANAwQuZf/5WIImo0Tb//83QOny4eOE4RD///8zedNyJqZ0DQ0/////0EDQzNyvTNzA0NLGhn///" +
  "//NkxHwAAANIAUAAAP///5XImsnyJlA0KijQiCaB5N0zA0JxuOo/H9/H4/n6+uyFAgQltSMEgkAAdyYdQACMBOQuWTxgx8dD" +
  "RhKMImY42r19mDQIBnkPgYKEgGIgQBhoAAiEoBIOBt4YhZAwEQgMyGADIAODNitgNJrEDEQFL58HAEe2GNBvGTp4SmLNDAIC" +
  "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" +
  "//NkxMccgh5AFtPkziAMaEWHonUro/qSLxFjZbf/ot//6Kjb/JVDT+RKKSKQT6BDqLTAwYXIKHJTDpREQLjLcKUNLeJuIPBq" +
  "DgJhQLQbDyJxXJBmcJ0qEhsL3LwGIghMHI1CaKB7FA1ikVByKhNGgOxwHMrpENCQ2G0JKSRyHkehPIA9kgS1cQVDMGgkJA8o" +
  "//NkxNgbah4QANYkuFRUVFRQTCwsDjv//////////yoqz1iqTEFNRTQuMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxO0gKUzgAH4YTKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "//NkxHwAAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" +
  "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  "base64",
);
