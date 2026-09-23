/**
 * Отказы серверных действий.
 *
 * Своей группой, а не внутри области экрана: одна и та же строка приходит
 * на три разных экрана — форма показывает её под полем, мотатка тостом,
 * онбординг красной строкой, — и разложить её по экранам значит написать
 * трижды и разойтись на первой правке.
 *
 * Каждая говорит, что случилось и что делать. Без извинений и без «что-то
 * пошло не так»: код или «неверно» рассказывают, что увидела машина,
 * а не что делать человеку.
 */
export const errors = {
  sectionLocked: (plan: string) => `This section comes with ${plan}`,

  pickOneTopic: "Add at least one interest",
  pickAnyTopic: "Pick at least one interest",
  pickOneSource: "Pick at least one source",
  tooManyTopics: (plan: string, allowed: number, picked: number) =>
    `${plan} covers ${allowed} ${allowed === 1 ? "interest" : "interests"}, and you picked ${picked}`,
  duplicateTopic: "You already have that interest. Give it another name",
  emptyTopicName: "One of the interests has no name — give it one",

  kindleAddressEmpty: "Enter your reader's address",
  kindleAddressSuffix: "The address has to end in @kindle.com",

  emptyLine: "Paste a link",
  checkLinkFirst: "Check the link first",
  pasteLink: "Paste a link",
  sourceGone: (reason: string) => `That source stopped answering: ${reason}`,
  sourceAlreadyGone: "That source is already out",

  noDigestYet: "There's no issue yet, so nothing to rewrite",
  digestEmpty: "The issue has no stories in it",
  capReachedRewrite: "That's it for today. The limit resets tomorrow",
  capReachedTopUp: "Nothing more to add today. The limit resets tomorrow",
  dailyCap: (usd: number) => `You've used today's $${usd}. Back tomorrow`,

  notANewsletter:
    "That looks like a newsletter, not your own channel: we need a Telegram channel, an X account or a blog",
  notATelegramChannel: "We need a link to a public Telegram channel: t.me/channel",
  unknownNetwork: "Unknown network",
  unknownLanguage: "That language is not on the list",
  itemNotYours: "That story isn't in any of your issues",
  noChannelsYet: "Tell us where you publish first, in settings",
  draftNotFound: "That draft is gone",

  // Отправка статьи на читалку: строки собираются в `pipeline/kindle.ts`
  // и показываются тостом в ленте — там же, где и остальные отказы.
  kindleOnPlan: (plan: string) => `Kindle comes with the ${plan} plan`,
  kindleNoAddress: "Set up Kindle in Delivery first: we need your reader's address",
  kindleNoSender: "That one is on us. Write to the bot on Telegram",
  kindleNotApproved: "Amazon hasn't approved our address yet. Finish the setup in Delivery",
  kindleCapReached: "That's all you can send today. The limit resets tomorrow",
  kindleAlreadySending: "That article is already on its way",
  audioOnPro: (plan: string) => `Audio comes with the ${plan} plan`,
  audioNoTelegram: "Message the bot on Telegram: audio arrives there",
  audioNoText: "This story has no text, there is nothing to read aloud",
  audioCapReached: (minutes: number) => `No audio left for today, tomorrow it is ${minutes} min again`,
  audioTooLong: (left: number, needed: number) => `${left} min left, and this article runs ${needed} min`,
  audioAlreadySpeaking: "That article is already being read aloud",
  audioNotFound: "No such audio",
  noSession: "Your session is over. Sign in again",
  badRequest: "We couldn't read that request",

  noFreshNewsYet: "No fresh stories yet. The first ones come tonight",
  noMoreFreshNews: "No more fresh stories",
  noChannelAnswered: (reasons: string) => `No channel answered: ${reasons}`,
  nothingToReadFromYou:
    "Nothing to read yet: connect a public Telegram channel or X — your style is learned from posts there. Or describe your style yourself in the field",
  voiceNotBuilt: "Couldn't build your voice",
  postNotWritten: "Couldn't write the post",

  firstIssueFailed: "Couldn't build your first issue. I'll build it tonight",
};
