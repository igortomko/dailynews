import { languagesFor } from "./detect-language";
import { getChannels, getReader, setChannelLanguage } from "./readers";
import { readOwnPosts, type OwnPost } from "../../pipeline/voice-card";
import type { NetworkId } from "./networks";

/** Записать язык всем сетям читателя по уже прочитанным постам. */
export async function saveLanguages(readerId: number, posts: OwnPost[]): Promise<void> {
  const channels = await getChannels(readerId);
  const found = languagesFor(
    channels.map((channel) => channel.network),
    posts,
    Object.fromEntries(channels.map((channel) => [channel.network, channel.language])),
  );
  for (const channel of channels) {
    // Ничего не определилось — прежнее значение остаётся: пустой ответ
    // по неответившей сети не повод стирать то, что было известно.
    const language = found[channel.network];
    if (language && language !== channel.language) await setChannelLanguage(readerId, channel.network, language);
  }
}

/**
 * Прочитать посты и определить язык — после подключения сети.
 * Работает после ответа (`after`): чтение канала занимает секунды,
 * а подключение не должно их ждать. Отказ только в лог.
 */
export async function refreshLanguages(readerId: number): Promise<void> {
  try {
    const [reader, channels] = await Promise.all([getReader(readerId), getChannels(readerId)]);
    const { posts } = await readOwnPosts(
      channels.map((channel) => ({
        network: channel.network as NetworkId,
        handle: channel.handle ?? (channel.network === "x" && channel.account?.startsWith("@") ? channel.account : null),
      })),
      reader?.voice_sample ?? "",
    );
    await saveLanguages(readerId, posts);
  } catch (error) {
    console.error(`язык сетей читателя ${readerId} не определён — ${(error as Error).message}`);
  }
}
