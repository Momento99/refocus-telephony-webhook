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
- "RP": пластик для чтения (узкие классические для пресбиопии 60+)
- "RM": металл для чтения (тонкие узкие для пресбиопии)
- "KD": детские (маленький размер, яркие цвета)
- "RL": безоправные (rimless, линзы на винтиках без рамки)

═══════════════════════════════════════════════════════════════
КРИТИЧНО: RP/RM (ЧТЕНИЕ) vs PA/MA (ОБЫЧНЫЕ) — частая ошибка
═══════════════════════════════════════════════════════════════

Оправы ДЛЯ ЧТЕНИЯ (RP пластик / RM металл) — это узкоспециализированная
категория для пресбиопии у людей 60+. Их часто ПУТАЮТ с обычными PA/MA.

СТАВЬ RP или RM (НЕ PA/MA) если ХОТЯ БЫ ОДИН признак:
  • Линза УЗКАЯ и НИЗКАЯ — высота линзы заметно меньше обычной оправы,
    форма прямоугольная или полу-овальная, "очки для чтения"
  • Базовая утилитарная форма без декора — без рисунков, без узоров,
    минималистичный дизайн "только для функции"
  • Часто продаются комплектами разных цветов одной и той же простой формы
  • Часто видна вместе с книгой/газетой/текстом на фото
  • Китайские ярлыки/текст на фото:
    - "老花" (lǎohuā) — пресбиопия, СИЛЬНЫЙ маркер RP/RM
    - "阅读" (yuèdú) — чтение, СИЛЬНЫЙ маркер
    - "老人" (lǎorén) — пожилой человек
    - "高清" (gāoqīng) с указанием диоптрий (+1.0, +1.5, +2.0)
    - Цифры вроде "+150", "+200", "+250" рядом с оправой → 100% это чтение
  • Очень лёгкая конструкция, тонкие дужки, простой мост

Различение RP vs RM по материалу:
  • RP: пластиковый ободок (даже если тонкий)
  • RM: тонкая металлическая проволока, металлический мост

ЕСЛИ ОПРАВА ВЫГЛЯДИТ КАК МОДНАЯ/ТРЕНДОВАЯ/С УЗОРОМ — это PA/MA, НЕ чтение.
ЕСЛИ ОПРАВА КРУПНАЯ ИЛИ КЛАССИЧЕСКАЯ AVIATOR/WAYFARER — это PA/MA, НЕ чтение.
ЕСЛИ ОПРАВА ДЕТСКАЯ (мелкая + яркие цвета) — это KD, НЕ чтение.

Чтение оправы продаются дешевле обычных (RP/RM полоса 800-2200 KGS vs
PA/MA до 9000). Если оправа дешёвая, простая, узкая → склоняйся к RP/RM.

Очки для чтения (RP/RM) НИКОГДА не имеют значения gender="M".
Допустимые значения для RP/RM: ТОЛЬКО F или U.
• Явно женские (cat-eye, пастель/розовый/мятный/градиент, стразы/декор) → F
• Всё остальное (классические прямоугольники в чёрной/прозрачной/коричневой
  оправе, нейтральный «учительский» силуэт без декора) → U
• При сомнении → U (читалки одинаково носят и мужчины, и женщины).
ЗАПРЕЩЕНО возвращать gender="M" вместе с type_code="RP" или "RM". Если
оправа выглядит мужественно — это либо PA_M / MA_M (обычная мужская оправа,
не для чтения), либо RP_U / RM_U (унисекс читалка).

═══════════════════════════════════════════════════════════════
ПОЛ (поле gender) — ВАЖНО, ЧИТАЙ ВНИМАТЕЛЬНО
═══════════════════════════════════════════════════════════════

ГЛАВНОЕ ПРАВИЛО: "U" (унисекс) — ЭТО ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ.
Большинство классических оправ (aviator, wayfarer, прямоугольник, овал, круг)
без явных гендерных акцентов — это U. Реально 30–50% всех пластиковых оправ
гендерно-нейтральны и подходят обоим полам.

"F" (женский) — ставь ТОЛЬКО при УВЕРЕННОСТИ, когда есть ЯВНЫЕ женские маркеры
(хотя бы один сильный или 2+ слабых):
  • Cat-eye форма (приподнятые «лисьи» уголки) — СИЛЬНЫЙ маркер
  • Пастельные / прозрачные / градиентные / нежные цвета: розовый, мятный,
    сиреневый, персиковый, прозрачно-розовый,渐变 в тёплых тонах
  • Стразы, цветочный декор, жемчуг, металлические узоры на дужках
  • Видимо деликатный маленький размер (узкие тонкие дужки, миниатюрная рамка)
  • Лайфстайл-фото с явно женским реквизитом: косметика, помада, духи, ткани,
    украшения, женские журналы, маникюр в кадре
  • Китайский текст на фото содержит:
    - "网红" (wǎnghóng — «интернет-популярный/трендовый» → женское)
    - "日系" (rìxì — «японский стиль» → женское)
    - "慵懒" (yōnglǎn — «ленивый/расслабленный» → женский лайфстайл)
    - "甜美" (tiánměi — «милый/сладкий» → женское)
    - "气质" (qìzhì — «благородный темперамент» → женское)
    - "ins风" — «инстаграм-стиль» → женское
    - "女" (nǚ — «женский») в явном контексте позиционирования

"M" (мужской) — ставь ТОЛЬКО при УВЕРЕННОСТИ, когда есть ЯВНЫЕ мужские маркеры
(хотя бы один сильный или 2+ слабых):
  • Массивные прямоугольные / трапециевидные формы С тёмным цветом
    (чёрный, тёмно-серый, тёмно-коричневый, gunmetal)
  • Широкая переносица, толстый «брутальный» мост
  • Крупный aviator в металле с явно мужскими акцентами (двойной мост,
    плоский top-bar, тёмные линзы)
  • Лайфстайл-фото с явно мужским реквизитом: костюм, галстук, часы,
    деловой стол, мужские руки в кадре
  • Китайские маркеры:
    - "商务" (shāngwù — «бизнес/деловой» → мужское)
    - "复古" (fùgǔ — «винтаж/ретро» в массивных формах → мужское)
    - "男" (nán — «мужской») в явном контексте позиционирования

ЕСЛИ НЕ ВИДИШЬ ЯВНЫХ F-МАРКЕРОВ И ЯВНЫХ M-МАРКЕРОВ — СТАВЬ U.
F и M ставятся ТОЛЬКО при УВЕРЕННОСТИ в гендерном позиционировании.
Нейтральный чёрный wayfarer, классический прозрачный прямоугольник,
обычный коричневый овал без декора — это U, не F и не M.

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
ОЦЕНКА РОЗНИЧНОЙ ЦЕНЫ В REFOCUS (поле estimated_price_kgs)
═══════════════════════════════════════════════════════════════

Авторитетная таблица розничных цен Refocus в KGS (по типу и полу):

  PA_F: 800–9000      PA_M: 800–9000
  MA_F: 1200–9000     MA_M: 1200–9000
  RP_F: 800–2200      RM_F: 800–2200
  KD_F: 800–2500      KD_M: 800–2500
  RL_F: 6000–15000    RL_M: 6000–15000   (безоправные — премиум)

Estimate the retail price in Refocus (KGS) for this frame, based on visible
material quality, design complexity, and the price band for its type/gender.
Return as an integer in the 'estimated_price_kgs' field. If unsure, pick the
middle of the band.

═══════════════════════════════════════════════════════════════
ВЕРНИ СТРОГО ТАКОЙ JSON, БЕЗ ЛИШНЕГО ТЕКСТА
═══════════════════════════════════════════════════════════════

{
  "supplier_model": string | null,
  "type_code": "PA"|"MA"|"RP"|"RM"|"KD"|"RL",
  "gender": "F"|"M"|"U",
  "confidence": 0.0..1.0,
  "needs_review": boolean,
  "estimated_price_kgs": integer | null,
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

/**
 * Авторитетные диапазоны розничных цен Refocus (KGS) по type_code+gender.
 * Должны соответствовать таблице в RECOGNITION_SYSTEM_PROMPT. Используются
 * для клампинга оценки LLM, чтобы галлюцинации (50000 или 1) не попадали в БД.
 * Для gender='U' берём объединение F/M (max диапазон). Для отсутствующих
 * комбинаций (например RP_M, RM_M) используем соответствующий F-диапазон.
 */
const PRICE_BOUNDS: Record<string, [number, number]> = {
  PA_F: [800, 9000], PA_M: [800, 9000], PA_U: [800, 9000],
  MA_F: [1200, 9000], MA_M: [1200, 9000], MA_U: [1200, 9000],
  RP_F: [800, 2200], RP_M: [800, 2200], RP_U: [800, 2200],
  RM_F: [800, 2200], RM_M: [800, 2200], RM_U: [800, 2200],
  KD_F: [800, 2500], KD_M: [800, 2500], KD_U: [800, 2500],
  RL_F: [6000, 15000], RL_M: [6000, 15000], RL_U: [6000, 15000],
};

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

/* ────────── Дедуп перекрывающихся цветов ──────────
 *
 * GPT-5 иногда «видит» одну и ту же оправу 2-4 раза и создаёт дубли с одинаковым
 * (или почти одинаковым) bbox и тем же name_ru. В UI это выглядит как ДВЕ красные
 * цифры заказа на ОДНОЙ физической оправе → китайцу уходит неверный заказ.
 *
 * Эвристика дедупа:
 *   - IoU(a, b) > 0.5                                — bbox'ы существенно перекрываются
 *   - ИЛИ center_distance < min(w, h) * 0.3          — центры в пределах 30% размера
 *   - И (если есть оба name_ru) совпадают (без учёта регистра)
 *
 * При совпадении оставляем запись с БОЛЕЕ ИНФОРМАТИВНЫМ name_ru (длиннее), остальные
 * выбрасываем. Возвращаем флаг didDedup, чтобы вызывающий код мог поднять
 * needs_review = true.
 */

function bboxIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const areaA = Math.max(0, aw) * Math.max(0, ah);
  const areaB = Math.max(0, bw) * Math.max(0, bh);
  const union = areaA + areaB - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function bboxCenter(
  b: [number, number, number, number],
): [number, number] {
  return [b[0] + b[2] / 2, b[1] + b[3] / 2];
}

function bboxesAreDuplicates(a: CatalogColor, b: CatalogColor): boolean {
  // Условие 1: имена должны совпадать (без учёта регистра, после трима).
  // Это снижает риск ошибочного слияния двух близких, но РАЗНЫХ цветов
  // (например «чёрный» рядом с «серый» в плотной сетке).
  const an = (a.name_ru || '').trim().toLowerCase();
  const bn = (b.name_ru || '').trim().toLowerCase();
  if (!an || !bn) return false;
  if (an !== bn) return false;

  // Условие 2: пространственная близость.
  if (bboxIoU(a.bbox, b.bbox) > 0.5) return true;

  const [acx, acy] = bboxCenter(a.bbox);
  const [bcx, bcy] = bboxCenter(b.bbox);
  const dist = Math.hypot(acx - bcx, acy - bcy);
  const minDim = Math.min(a.bbox[2], a.bbox[3], b.bbox[2], b.bbox[3]);
  if (minDim > 0 && dist < minDim * 0.3) return true;

  return false;
}

/**
 * Удаляет цвета, у которых bbox перекрывается с уже принятыми и совпадает name_ru.
 * Из группы дублей оставляем запись с самым длинным name_ru (более описательным).
 * Возвращает (deduplicated, didDedup) — флаг сигнализирует, что нужно
 * поднять needs_review=true в результирующем CatalogRecognitionResult.
 */
export function dedupOverlappingColors(
  colors: CatalogColor[],
): { colors: CatalogColor[]; didDedup: boolean } {
  if (colors.length < 2) return { colors, didDedup: false };

  const kept: CatalogColor[] = [];
  let didDedup = false;

  for (const c of colors) {
    const dupIdx = kept.findIndex((k) => bboxesAreDuplicates(k, c));
    if (dupIdx === -1) {
      kept.push(c);
      continue;
    }
    didDedup = true;
    // Оставляем «лучшую» запись: с более длинным name_ru, иначе текущую
    // (порядок уже сверху-вниз — раннюю можно считать корректнее).
    const existing = kept[dupIdx];
    const existingLen = (existing.name_ru || '').trim().length;
    const candidateLen = (c.name_ru || '').trim().length;
    if (candidateLen > existingLen) {
      kept[dupIdx] = c;
    }
  }

  return { colors: kept, didDedup };
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

  let gender = String(r.gender || '').toUpperCase().trim();
  if (!VALID_GENDERS.has(gender)) {
    throw new Error(`Неизвестный gender: ${r.gender}`);
  }

  // Жёсткий программный guard: RP/RM никогда не M. Если LLM ослушался
  // промпта — принудительно нормализуем M → U (читалки физически носят оба
  // пола, M-кодировка для них бессмысленна для нашего бизнеса).
  let genderGuardTriggered = false;
  if ((type_code === 'RP' || type_code === 'RM') && gender === 'M') {
    gender = 'U';
    genderGuardTriggered = true;
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

  // Дедуп перекрывающихся цветов: GPT-5 (и иногда Opus) повторяет одну и ту же
  // оправу 2-4 раза с одинаковым name_ru и почти совпадающим bbox. См.
  // discovery: 19 каталогов уже были «поломаны» этим, например 7bb80d8d с 4×
  // "чёрный" подряд. Если дедуп сработал — поднимаем needs_review.
  const dedupRes = dedupOverlappingColors(colors);
  const colorsDeduped = dedupRes.colors;
  const dedupHappened = dedupRes.didDedup;

  // estimated_price_kgs — оценочная цена розницы в KGS. Принимаем число или
  // строку с числом; всё, что не парсится как конечное положительное число,
  // нормализуем в null. Сохраняем как целое.
  let estimatedPriceKgs: number | null = null;
  const epRaw = (r as Record<string, unknown>).estimated_price_kgs;
  if (isFiniteNum(epRaw)) {
    estimatedPriceKgs = epRaw > 0 ? Math.round(epRaw) : null;
  } else if (typeof epRaw === 'string' && epRaw.trim()) {
    const n = Number(epRaw.replace(/[^\d.-]/g, ''));
    estimatedPriceKgs = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  // Кламп по авторитетной таблице PRICE_BOUNDS. Если LLM вернул цену вне
  // диапазона для данного type_code+gender — поджимаем к границе, выставляем
  // needs_review=true и сохраняем исходное значение в raw_response, чтобы
  // галлюцинации не попадали в БД как есть.
  let priceOutOfBand = false;
  let originalEstimatedPrice: number | null = null;
  if (estimatedPriceKgs !== null) {
    const bounds = PRICE_BOUNDS[`${type_code}_${gender}`];
    if (bounds) {
      const [lo, hi] = bounds;
      if (estimatedPriceKgs < lo || estimatedPriceKgs > hi) {
        priceOutOfBand = true;
        originalEstimatedPrice = estimatedPriceKgs;
        estimatedPriceKgs = Math.min(hi, Math.max(lo, estimatedPriceKgs));
      }
    }
  }

  const baseNotes = String(r.notes || '').slice(0, 500);
  const notes = genderGuardTriggered
    ? (baseNotes ? baseNotes + ' ' : '') +
      '[guard: RP/RM с gender=M принудительно изменён на U; читалки не могут быть мужскими в нашей схеме]'
    : baseNotes;

  return {
    supplier_model: r.supplier_model ? String(r.supplier_model).slice(0, 64) : null,
    type_code: type_code as CatalogRecognitionResult['type_code'],
    gender: gender as CatalogRecognitionResult['gender'],
    confidence,
    needs_review:
      Boolean(r.needs_review) ||
      confidence < 0.7 ||
      priceOutOfBand ||
      dedupHappened ||
      genderGuardTriggered,
    estimated_price_kgs: estimatedPriceKgs,
    colors: colorsDeduped,
    notes,
    ...(priceOutOfBand
      ? { estimated_price_kgs_original: originalEstimatedPrice }
      : {}),
  } as CatalogRecognitionResult;
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
