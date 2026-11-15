/**
 * Определяет, является ли входящее сообщение клиента «естественным завершением»
 * диалога (прощание, благодарность, односложный ack) — а НЕ новым вопросом.
 *
 * Используется в webhook'ах WA/IG: если seller уже отправил прощальный шаблон
 * (thread.farewell_sent_at IS NOT NULL) и клиент после этого присылает такое
 * сообщение — SLA-часы не перезапускаются, unread_count не растёт, в inbox'е
 * тред не «вспыхивает».
 *
 * Если клиент задаёт реальный вопрос (содержит «?», вопросительное слово
 * в начале или имеет заметную длину) — сбрасываем farewell_sent_at и тред
 * снова идёт в waiting_seller.
 */

export const FAREWELL_TEMPLATE_BODY =
  'Всегда рады помочь! Пишите, если что-то понадобится 🙂';

const QUESTION_MARK_RE = /[?？؟]/;

// Слова-триггеры вопроса в начале сообщения.
const QUESTION_STARTERS = [
  'как',
  'как так',
  'сколько',
  'когда',
  'где',
  'есть ли',
  'почему',
  'зачем',
  'можно',
  'можете',
  'а ',
  'а у ',
  'что с',
  'что на',
  'что по',
  'у вас есть',
  'ещё вопрос',
  'еще вопрос',
];

// Начала фраз-прощаний/благодарностей (короткие ack).
const FAREWELL_STARTERS = [
  'спасибо',
  'спс',
  'благодарю',
  'благодарен',
  'благодарна',
  'хорошо',
  'хорошего',
  'удач',
  'до свид',
  'до свиданья',
  'до свидания',
  'пока',
  'всего доброго',
  'всего хорошего',
  'всего',
  'ок',
  'окей',
  'оки',
  'понял',
  'поняла',
  'понятно',
  'ага',
  'угу',
  'приятно',
  'спасибо большое',
  'спасибки',
  'благодар',
  'с уважением',
];

// Эмодзи-only или эмодзи в начале (сердечко, молитва, огонь и т.п.) — ack.
const EMOJI_ACK_RE =
  /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}👍🙏❤✨🤝👌🙂😊☺️💕❤️‍🔥👏💯🫶]{1,12}$/u;

/**
 * Короткое/ack-сообщение, НЕ требующее ответа продавца.
 * Намеренно консервативно: лучше иногда недоотфильтровать (тред всё ещё
 * будет показан продавцу), чем ложно закрыть диалог с настоящим вопросом.
 */
export function isLikelyFarewell(body: string | null | undefined): boolean {
  if (!body) return false; // Без текста может быть голосовой вопрос или фото проблемы.
  const t = body.trim().toLowerCase();
  if (t.length === 0) return false;
  if (QUESTION_MARK_RE.test(t)) return false;

  const reaction = t.match(/^\[реакция:\s*(.*?)\]$/u);
  if (reaction) return POSITIVE_EMOJI_ONLY.test(reaction[1]);
  if (POSITIVE_EMOJI_ONLY.test(t)) return true;
  // Exact acknowledgements only: short complaints and “спасибо, но ...” stay open.
  return ACK_WORDS.has(t.replace(ACK_DECORATION, ' ').trim());
}

const POSITIVE_EMOJI_ONLY = /^[\s👍🙏❤♥✨🤝👌🙂😊☺💕👏💯🫶💐🥰🤗😇🌷🌺🌹\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]+$/u;
const ACK_DECORATION = /[\s.,!…👍🙏❤♥✨🤝👌🙂😊☺💕👏💯🫶💐🥰🤗😇🌷🌺🌹\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]+/gu;
const ACK_WORDS = new Set([
  'спасибо', 'спасибо большое', 'большое спасибо', 'огромное спасибо', 'спасибо вам',
  'спасибо вам большое', 'спс', 'спасибки', 'благодарю', 'благодарю вас',
  'спасибо огромное', 'спасибо вам огромное', 'большое вам спасибо', 'спасибо за внимание',
  'хорошо', 'хорошо спасибо', 'спасибо хорошо', 'ок', 'окей', 'оки',
  'понял', 'поняла', 'понятно', 'понял спасибо', 'поняла спасибо', 'понятно спасибо',
  'ага', 'угу', 'до свидания', 'до свиданья', 'пока', 'всего доброго',
  'всего хорошего', 'хорошего дня', 'хорошего вечера', 'и вам', 'взаимно',
  'рахмат', 'чоң рахмат', 'чон рахмат', 'макул', 'макул рахмат', 'түшүнүктүү',
  'thank you', 'thanks', 'ok', 'okay',
]);

function closureText(body: string): string {
  return body.toLowerCase().replace(/ё/g, 'е')
    .replace(/[.,!…;:()\s👍🙏❤♥✨🤝👌🙂😊☺💕👏💯🫶💐🥰🤗😇🌷🌺🌹\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]+/gu, ' ').trim();
}

export function isWhatsappFarewellMessage(body: string | null | undefined): boolean {
  if (!body) return false;
  const text = closureText(body);
  return [
    FAREWELL_TEMPLATE_BODY,
    'Благодарим за обращение! Хорошего дня, будем рады помочь снова.',
    'Спасибо, что остаётесь с Refocus! Будем рады видеть вас снова.',
  ].some(template => closureText(template) === text);
}

export function isCustomerGreeting(body: string | null | undefined): boolean {
  return !!body && /^(здравствуйте|здравствуй|добрый день|доброе утро|добрый вечер|привет|саламатсызбы)$/u.test(closureText(body));
}

// Closed vocabulary, matched through the entire message. Extra words such as “но”,
// “не”, a symptom, a request or a question mark leave the conversation open.
const POSITIVE_CLOSURE_PARTS = [
  'все хорошо', 'все отлично', 'все нормально', 'все норм', 'все комфортно', 'все удобно',
  'все прекрасно', 'все устраивает', 'меня все устраивает', 'нас все устраивает',
  'у нас все хорошо', 'у меня все хорошо', 'все подошло', 'все сидит отлично',
  'очки удобные', 'очки очень удобные', 'очки хорошие', 'очки подошли', 'очки хорошо подошли',
  'очень удобные и качественные', 'очень удобно', 'очень удобные', 'удобно', 'удобные',
  'комфортно', 'комфортные', 'хорошо сели', 'отлично', 'нормально', 'хорошо', 'очень хорошо',
  'очень доволен', 'очень довольна', 'я доволен', 'я довольна', 'доволен', 'довольна',
  'очень нравятся', 'нравятся', 'подошли', 'вижу хорошо', 'вижу прекрасно',
];
const CLOSURE_COURTESY_PARTS = [
  'здравствуйте', 'здравствуй', 'добрый день', 'доброе утро', 'добрый вечер', 'привет',
  'да', 'пока', 'и', 'спасибо', 'спасибо большое', 'спасибо огромное', 'спасибо вам',
  'спасибо вам большое', 'спасибо вам огромное', 'большое спасибо', 'большое вам спасибо',
  'спасибо за внимание', 'благодарю', 'рахмат', 'чон рахмат', 'чоң рахмат',
  'хорошего дня', 'хорошего вам дня', 'хорошего вечера',
];
const CLOSURE_PARTS = [...POSITIVE_CLOSURE_PARTS, ...CLOSURE_COURTESY_PARTS].sort((a, b) => b.length - a.length);

/** Explicit ACK or unqualified positive aftercare feedback; never a general sentiment guess. */
export function isCustomerAcknowledgementOrPositiveClosure(body: string | null | undefined): boolean {
  if (isLikelyFarewell(body)) return true;
  if (!body || QUESTION_MARK_RE.test(body)) return false;
  let remaining = closureText(body);
  let positive = false;
  while (remaining) {
    const part = CLOSURE_PARTS.find(value => remaining === value || remaining.startsWith(value + ' '));
    if (!part) return false;
    positive ||= POSITIVE_CLOSURE_PARTS.includes(part);
    remaining = remaining.slice(part.length).trim();
  }
  return positive;
}
