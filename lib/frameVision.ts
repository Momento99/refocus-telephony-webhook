/**
 * Vision-распознавание фотографий каталога поставщика.
 *
 * Поддерживает два движка:
 *   - Claude Opus 4.7 (Anthropic) — лучшее reasoning по типу/полу
 *   - GPT-5 (OpenAI)              — быстрее и дешевле, отлично читает китайские артикулы
 *
 * Один промпт + одна JSON-схема — переключение прозрачное для UI.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type {
  CatalogRecognitionResult,
  CatalogColor,
  RecognitionEngine,
} from './frameProcurementTypes';

/* ────────── Промпт ────────── */

export const RECOGNITION_SYSTEM_PROMPT = `
Ты помощник по закупке оправ для оптики Refocus. Анализируй фото каталога китайского поставщика и возвращай структурированный JSON.

ФОРМАТЫ ФОТО, КОТОРЫЕ ВСТРЕЧАЮТСЯ:
1) КАТАЛОГ-ГРИД — одна модель оправы, разложенная вертикально по строкам в разных цветах. С подписями C1, C2, C3 справа. Внизу артикул "38007-53-16-147".
2) ЛАЙФСТАЙЛ-ФОТО — оправы разложены диагонально на красивом фоне (журналы, косметика, ткани). Цветовые ярлыки рядом с каждой парой. Это часто промо-фото для соцсетей.
3) ВИТРИНА — несколько моделей вместе, обычно с этикетками.

В ЛЮБОМ ФОРМАТЕ задача одна: найти артикул, классифицировать модель, перечислить цвета.

═══════════════════════════════════════════════════════════════
КАТЕГОРИИ REFOCUS (поле type_code)
═══════════════════════════════════════════════════════════════

- "PA": пластик взрослый, полнооправный (включая TR-90 — это лёгкий пластик, помечен как "TR" на фото)
- "MA": металл взрослый, полнооправный
- "RP": пластик для чтения (только узкие классические формы для пресбиопии 60+)
- "RM": металл для чтения (тонкие узкие женские для пресбиопии)
- "KD": детские (маленький размер, яркие цвета)
- "RL": безоправные (rimless, линзы на винтиках без рамки)

═══════════════════════════════════════════════════════════════
ПОЛ (поле gender) — ВАЖНО, ЧИТАЙ ВНИМАТЕЛЬНО
═══════════════════════════════════════════════════════════════

"F" (женский) если есть ХОТЯ БЫ ОДИН из признаков:
  • Округлые/овальные/cat-eye формы (классика женских)
  • Деликатные тонкие линии, маленький-средний размер
  • Материал TR-90 (лёгкий пластик, в Китае почти всегда позиционируется женский)
  • Лайфстайл-фон с косметикой, журналами, тканями
  • Полупрозрачные/градиентные/нежные цвета
  • Китайский текст на фото содержит:
    - "网红" (wǎnghóng — "интернет-популярный/трендовый" → женское позиционирование)
    - "日系" (rìxì — "японский стиль" → женское)
    - "慵懒" (yōnglǎn — "ленивый/расслабленный" → женский лайфстайл)
    - "甜美" (tiánměi — "милый/сладкий" → женский)
    - "气质" (qìzhì — "благородный темперамент" → женский)
    - "ins风" — "инстаграм-стиль" → женский

"M" (мужской) — массивные прямоугольные/трапеция, тёмно-чёрный/серый/коричневый,
  широкая переносица, металлический строгий мост, "商务" (бизнес), "复古" (винтаж).

"U" (унисекс) ставь ТОЛЬКО когда оправа реально гендерно-нейтральна — крупный классический
  aviator или wayfarer без явных женских/мужских акцентов. Если сомневаешься между U и F —
  ставь F (большинство китайских модных оправ ориентированы на женский рынок).

═══════════════════════════════════════════════════════════════
ЦВЕТА (поле colors) — КРИТИЧЕСКОЕ ПРАВИЛО
═══════════════════════════════════════════════════════════════

ПОЧЕМУ ЭТО ВАЖНО: на основе твоих colors[] система потом рисует красные цифры
заказа поверх фото и отправляет это китайцу. Если цвета пропущены — заказ не
сформируется. Это самая важная часть твоего ответа.

ШАГ 1. Найди ВСЕ цветовые позиции на фото. Их обычно 3-7 на одну модель.
       Подсказки расположения: подписи C1/C2/C3..., китайские ярлыки рядом
       с оправой, или просто визуально различаемые отдельные оправы.

ПОРЯДОК В МАССИВЕ colors[] — СТРОГО СВЕРХУ ВНИЗ:
  Сортируй элементы массива в том же порядке, в котором оправы лежат
  на фото — от самой верхней (наименьший y) до самой нижней (наибольший y).
  Если оправы расположены диагонально — всё равно от верхней к нижней.
  Если по горизонтали в одном ряду — слева направо.
  Это критично: пользователю удобно видеть цвета в том же порядке, в котором
  они стоят физически на фото, чтобы быстро сверять глазами.

ВАЖНО — что НЕ считать отдельным цветом (частые ошибки):
  • Круглый/овальный ИНСЕТ с приближением одной из оправ — это просто
    "увеличенное превью" того же цвета, не считать отдельной позицией.
    Признаки инсета: маленький круг в углу фото с одной парой очков,
    отделён обводкой/тенью от основной композиции.
  • Та же модель в другом ракурсе (вид сбоку, на лице модели, на руке) —
    тоже не отдельный цвет.
  • Декор / упаковка / реквизит (футляр, чашка, журнал) — игнорируй.
  • Reflections / тени — это отражения, а не оправы.
  • НИЖНЯЯ ЧАСТЬ ФОТО с ЛОГО / БРЕНДОМ / АРТИКУЛОМ / ВОДЯНЫМ ЗНАКОМ — это
    подпись, НЕ оправа. Например: "LianBangKaDan", "LUDANNI", "MM087",
    QR-коды, баркоды, текст вроде "53□16-142", обложки журналов и пр.
    НЕ создавай дополнительный цвет для этой области, даже если кажется,
    что там "должна быть" ещё одна оправа в тёмной зоне.

Считай ТОЛЬКО уникальные цветовые варианты в основной композиции —
обычно они выложены сеткой/диагональю в одинаковом ракурсе. Перед тем
как закончить, посчитай ВРУЧНУЮ количество РЕАЛЬНЫХ оправ на фото
(нос-к-носу, физически очки) — длина массива colors[] должна точно
совпадать с этим числом.

Если сомневаешься — ставь меньше cвета и needs_review=true. Лучше
недосчитать, чем добавить лишний (это ломает заказ у поставщика).

ШАГ 2. Для каждой позиции заполни 3 поля. Никаких пропусков и пустых строк.

Словарь китайских ярлыков → русский цвет:
  黑 = чёрный                    白 = белый
  灰 = серый                     棕 / 茶 / 啡 = коричневый
  红 = красный                   绿 = зелёный
  蓝 = синий                     紫 = фиолетовый
  粉 = розовый                   黄 = жёлтый
  金 = золотой                   银 = серебристый
  米色 / 米白 = бежевый           豆花 = мраморный
  砂 = матовый (префикс)          亮 = глянцевый (префикс)
  透 = прозрачный (префикс)       渐 / 渐变 = градиент (префикс)

Комбинации:
  透粉 = прозрачно-розовый        渐紫 = градиент-фиолетовый
  渐黑 = градиент-чёрный          砂黑 = матовый-чёрный
  亮黑 = глянцевый-чёрный         渐茶 = градиент-коричневый
  透灰 = прозрачно-серый          渐变茶 = градиент-чай

Каждый объект цвета:
- label: подпись с фото (C1, C2, или китайский ярлык как есть, например "渐紫")
- name_ru: ОБЯЗАТЕЛЬНО на русском, 1-2 слова. ЕСЛИ ярлык неразборчив или
           отсутствует — посмотри на саму оправу и опиши её цвет визуально.
           Пустая строка "" недопустима. Если совсем не уверен — пиши
           "тёмный" / "светлый" / "смешанный" — ЛЮБОЕ слово, но не пустоту.
- bbox: [x_ratio, y_ratio, w_ratio, h_ratio] в долях [0..1]. Прямоугольник
        вокруг этой конкретной оправы на фото.
- click_point: [x_ratio, y_ratio] — КРИТИЧЕСКОЕ ПОЛЕ. Конкретная точка на
        фото, куда мы нарисуем красную цифру количества. Точные доли 0..1
        от ширины и высоты фото.

  ПРАВИЛА ДЛЯ click_point — читай внимательно, это сложно:

  (1) Точка должна быть ВНУТРИ оправы, на её ЛЕВОЙ ЛИНЗЕ. Не на дужке,
      не на мосту между линзами, не в воздухе РЯДОМ с оправой, не НИЖЕ оправы,
      не НА ГРАНИЦЕ между двумя соседними оправами в каталог-сетке.

  (2) "Левая линза" — та, что ближе к ЛЕВОМУ краю фото (со стороны зрителя).
      Это НЕ центр оправы. Это и НЕ правая линза. Левая.

  (3) Численный ориентир для каталог-сетки: если оправа занимает по горизонтали
      от x=0.10 до x=0.90, то left_lens_x ≈ 0.27 (НЕ 0.50, это центр; НЕ 0.73,
      это правая линза). Если оправа занимает от x=0.20 до x=0.80, то
      left_lens_x ≈ 0.34.

  (4) Для каталог-сетки с N оправами по вертикали: каждая оправа занимает
      примерно 1/N высоты. Центр k-й оправы (k=1..N) по y ≈ ((k-0.5) / N).
      Например для 5 оправ от y=0.10 до y=0.90: центры на y = 0.18, 0.34,
      0.50, 0.66, 0.82 — ровно по серединам каждой оправы.

  (5) ВНУТРЕННЯЯ ПРОВЕРКА (обязательная): после того как заполнил все
      click_point, мысленно "кликни" по каждой точке на фото. Если попал
      бы в линзу оправы — ОК. Если попал бы на дужку, в пустоту между
      оправами, на лого, на текст артикула — ПЕРЕДЕЛАЙ координаты.

  (6) Точки разных цветов должны заметно отличаться по y (если оправы
      по вертикали) или по x (если по диагонали/горизонтали). Не клади
      все точки в одну координату — это ошибка.

ПРИМЕР для каталог-сетки (оправы выложены вертикально по строкам):
  "colors": [
    { "label": "C1透粉", "name_ru": "прозрачно-розовый",
      "bbox": [0.05, 0.10, 0.85, 0.20],
      "click_point": [0.30, 0.18] },
    { "label": "C2渐紫", "name_ru": "градиент-фиолетовый",
      "bbox": [0.05, 0.32, 0.85, 0.20],
      "click_point": [0.30, 0.40] },
    { "label": "C3米色", "name_ru": "бежевый",
      "bbox": [0.05, 0.54, 0.85, 0.20],
      "click_point": [0.30, 0.62] }
  ]
Заметь: bbox охватывает всю строку, а click_point — точно в центре левой линзы.

ПРИМЕР для лайфстайл-фото (оправы разложены диагонально на белой бумаге):
  "colors": [
    { "label": "C1", "name_ru": "чёрный",
      "bbox": [0.10, 0.15, 0.30, 0.25],
      "click_point": [0.20, 0.25] },
    { "label": "C2", "name_ru": "коричневый",
      "bbox": [0.15, 0.40, 0.30, 0.25],
      "click_point": [0.25, 0.50] },
    { "label": "C3", "name_ru": "градиент-серый",
      "bbox": [0.45, 0.20, 0.30, 0.25],
      "click_point": [0.55, 0.30] }
  ]
Заметь: каждый click_point попадает строго на центр левой линзы конкретной оправы.

═══════════════════════════════════════════════════════════════
ВЕРНИ СТРОГО ТАКОЙ JSON, БЕЗ ЛИШНЕГО ТЕКСТА
═══════════════════════════════════════════════════════════════

{
  "supplier_model": string | null,
  "type_code": "PA"|"MA"|"RP"|"RM"|"KD"|"RL",
  "gender": "F"|"M"|"U",
  "confidence": 0.0..1.0,
  "needs_review": boolean,
  "colors": [
    {
      "label": string,
      "name_ru": string,
      "bbox": [x, y, w, h],
      "click_point": [x, y]
    }
  ],
  "notes": string
}

needs_review = true только когда уверенность < 0.7.
notes — короткая подсказка на русском: что было неоднозначно или чем руководствовался.
`.trim();

const VALID_TYPES = new Set(['PA', 'MA', 'RP', 'RM', 'KD', 'RL']);
const VALID_GENDERS = new Set(['F', 'M', 'U']);

/* ────────── Fallback: Chinese label → русское название ────────── */

/**
 * Пытаемся определить русское название цвета из label.
 * Используется, когда LLM забыл заполнить name_ru — так у нас всё равно
 * будет что-то осмысленное вместо пустой строки.
 */
function guessRuFromLabel(label: string): string {
  if (!label) return '';
  const s = label.toLowerCase();

  // Префиксы (комбинируются)
  const prefixes: Array<[RegExp, string]> = [
    [/透/, 'прозрачно-'],
    [/渐变?/, 'градиент-'],
    [/砂/, 'матовый-'],
    [/亮/, 'глянцевый-'],
  ];

  // Базовые цвета (китайский → русский)
  const colors: Array<[RegExp, string]> = [
    [/黑/, 'чёрный'],
    [/白/, 'белый'],
    [/灰/, 'серый'],
    [/棕|啡/, 'коричневый'],
    [/茶/, 'коричневый'],
    [/红/, 'красный'],
    [/绿/, 'зелёный'],
    [/蓝/, 'синий'],
    [/紫/, 'фиолетовый'],
    [/粉/, 'розовый'],
    [/黄/, 'жёлтый'],
    [/金/, 'золотой'],
    [/银/, 'серебристый'],
    [/米色|米白/, 'бежевый'],
    [/豆花/, 'мраморный'],
  ];

  let prefix = '';
  for (const [re, val] of prefixes) {
    if (re.test(label)) {
      prefix = val;
      break;
    }
  }

  for (const [re, val] of colors) {
    if (re.test(label)) {
      return prefix + val;
    }
  }

  // Английские цвета на всякий случай
  const en: Array<[string, string]> = [
    ['black', 'чёрный'], ['white', 'белый'], ['gray', 'серый'], ['grey', 'серый'],
    ['brown', 'коричневый'], ['red', 'красный'], ['green', 'зелёный'],
    ['blue', 'синий'], ['purple', 'фиолетовый'], ['pink', 'розовый'],
    ['yellow', 'жёлтый'], ['gold', 'золотой'], ['silver', 'серебристый'],
    ['beige', 'бежевый'], ['transparent', 'прозрачный'], ['gradient', 'градиент'],
  ];
  for (const [k, v] of en) {
    if (s.includes(k)) return v;
  }

  return '';
}

/* ────────── Валидация ответа LLM ────────── */

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function validateRecognitionResult(raw: unknown): CatalogRecognitionResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('LLM вернул не-объект');
  }
  const r = raw as Record<string, unknown>;

  const type_code = String(r.type_code || '').toUpperCase().trim();
  if (!VALID_TYPES.has(type_code)) {
    throw new Error(`Неизвестный type_code: ${r.type_code}`);
  }

  const gender = String(r.gender || '').toUpperCase().trim();
  if (!VALID_GENDERS.has(gender)) {
    throw new Error(`Неизвестный gender: ${r.gender}`);
  }

  const confidence = isFiniteNum(r.confidence) ? clamp01(r.confidence) : 0.5;

  const colorsRaw = Array.isArray(r.colors) ? r.colors : [];
  const colors: CatalogColor[] = colorsRaw.map((c: any, i: number) => {
    const bboxRaw = Array.isArray(c?.bbox) ? c.bbox : [];
    const bbox: [number, number, number, number] =
      bboxRaw.length === 4 && bboxRaw.every(isFiniteNum)
        ? [
            clamp01(bboxRaw[0]),
            clamp01(bboxRaw[1]),
            clamp01(bboxRaw[2]),
            clamp01(bboxRaw[3]),
          ]
        : [0, i * 0.15, 1, 0.15]; // fallback если bbox не вернули

    // click_point — опционально, но крайне желательно для точной аннотации
    let clickPoint: [number, number] | undefined;
    const cpRaw = Array.isArray(c?.click_point) ? c.click_point : null;
    if (cpRaw && cpRaw.length === 2 && cpRaw.every(isFiniteNum)) {
      clickPoint = [clamp01(cpRaw[0]), clamp01(cpRaw[1])];
    }

    let nameRu = String(c?.name_ru ?? '').trim().slice(0, 32);
    // Если LLM поленился заполнить — пытаемся по label мапить китайский цвет.
    // Лучше иметь хотя бы что-то, чем пустую строку.
    if (!nameRu) {
      const label = String(c?.label ?? '').trim();
      nameRu = guessRuFromLabel(label) || '— нужно уточнить —';
    }

    return {
      label: String(c?.label ?? `C${i + 1}`).slice(0, 32),
      name_ru: nameRu,
      bbox,
      ...(clickPoint ? { click_point: clickPoint } : {}),
    };
  });

  // Сортируем сверху вниз: приоритет — click_point.y, иначе bbox.y.
  // Это страховка на случай, если LLM забыл соблюсти порядок в массиве.
  colors.sort((a, b) => {
    const ay = a.click_point?.[1] ?? a.bbox[1];
    const by = b.click_point?.[1] ?? b.bbox[1];
    if (ay !== by) return ay - by;
    // При равном y — сортируем по x (слева направо)
    const ax = a.click_point?.[0] ?? a.bbox[0];
    const bx = b.click_point?.[0] ?? b.bbox[0];
    return ax - bx;
  });

  return {
    supplier_model: r.supplier_model ? String(r.supplier_model).slice(0, 64) : null,
    type_code: type_code as CatalogRecognitionResult['type_code'],
    gender: gender as CatalogRecognitionResult['gender'],
    confidence,
    needs_review: Boolean(r.needs_review) || confidence < 0.7,
    colors,
    notes: String(r.notes || '').slice(0, 500),
  };
}

/** Извлечь JSON из произвольного текста (LLM иногда обёртывает в ```json...```) */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Прямой парсинг
  try {
    return JSON.parse(trimmed);
  } catch {}
  // Достаём из markdown-блока
  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (blockMatch) {
    return JSON.parse(blockMatch[1].trim());
  }
  // Достаём первую { … }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }
  throw new Error('Не нашёл JSON в ответе LLM');
}

/* ────────── Anthropic Opus 4.7 ────────── */

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY не задан в .env.local');
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

export async function recognizeWithOpus(
  imageBase64: string,
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp',
): Promise<CatalogRecognitionResult> {
  const client = getAnthropic();
  const msg = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2048, // запас для случаев с 7-8 цветами и подробными notes
    system: RECOGNITION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: 'Проанализируй это фото каталога и верни JSON по формату из инструкций.',
          },
        ],
      },
    ],
  });

  const text = msg.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');

  const parsed = extractJson(text);
  return validateRecognitionResult(parsed);
}

/* ────────── OpenAI GPT-5 ────────── */

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY не задан в .env.local');
    _openai = new OpenAI({ apiKey: key });
  }
  return _openai;
}

export async function recognizeWithGpt5(
  imageBase64: string,
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp',
): Promise<CatalogRecognitionResult> {
  const client = getOpenAI();
  const dataUrl = `data:${mediaType};base64,${imageBase64}`;

  const completion = await client.chat.completions.create({
    model: 'gpt-5',
    messages: [
      { role: 'system', content: RECOGNITION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Проанализируй это фото каталога и верни JSON по формату из инструкций.',
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content || '';
  const parsed = extractJson(text);
  return validateRecognitionResult(parsed);
}

/* ────────── Унифицированный вход ────────── */

export async function recognize(
  imageBase64: string,
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp',
  engine: RecognitionEngine,
): Promise<CatalogRecognitionResult> {
  if (engine === 'opus-4.7') return recognizeWithOpus(imageBase64, mediaType);
  if (engine === 'gpt-5') return recognizeWithGpt5(imageBase64, mediaType);
  throw new Error(`Неизвестный движок распознавания: ${engine}`);
}
