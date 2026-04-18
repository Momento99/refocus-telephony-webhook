'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import {
  BookOpen, TrendingUp, Gavel, ClipboardList, GraduationCap,
  Megaphone, UserSearch, Rocket, Shield, FolderOpen,
  CheckCircle2, Circle, ChevronDown, ChevronUp, FileDown,
  Save, BarChart3, Loader2, FileText, Clock, AlertCircle, Minus,
  Paperclip, Trash2, Upload, Building2, Store
} from 'lucide-react';

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
);

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemStatus = 'Есть' | 'Частично' | 'Нет' | 'Не нужно сейчас';
type Priority   = 'critical' | 'high' | 'later' | 'skip';
type Audience   = 'hq' | 'franchisee' | 'candidate';

interface PlanItem {
  id: string;
  title: string;
  description: string;
  initialStatus: ItemStatus;
  priority: Priority;
}
interface PlanSection {
  id: string;
  title: string;
  icon: React.ElementType;
  color: string;
  items: PlanItem[];
}
interface DocFile {
  name: string;
  url: string;
}
interface VideoLink {
  title: string;
  url: string;
}
interface DbItem {
  id: string;
  status: ItemStatus;
  completed: boolean;
  notes: string;
  content: string;
  readiness: number; // 0 | 25 | 50 | 75 | 100
  images: string[];  // public Supabase Storage URLs
  documents: DocFile[]; // uploaded Word/PDF files
  videos: VideoLink[]; // YouTube / external video links
}
interface EditState {
  notes: string;
  content: string;
}

// ─── Plan Data ────────────────────────────────────────────────────────────────

const SECTIONS: PlanSection[] = [
  {
    id: 'passport', title: 'Паспорт франшизы', icon: BookOpen, color: 'sky',
    items: [
      { id: '1.1', title: 'Паспорт франшизы Refocus', description: 'Краткий документ: что это за франшиза, какой формат точки, площадь, команда, позиционирование, что получает франчайзи.', initialStatus: 'Частично', priority: 'critical' },
      { id: '1.2', title: 'Краткое описание концепции франшизы', description: 'Короткая версия «что такое франшиза Refocus» на 1–2 страницы.', initialStatus: 'Частично', priority: 'critical' },
      { id: '1.3', title: 'Позиционирование франшизы', description: 'Технологичная оптика нового поколения, честная консультация, дружелюбный сервис, жёсткая стандартизация.', initialStatus: 'Есть', priority: 'high' },
      { id: '1.4', title: 'Портрет идеального франчайзи', description: 'Честный, трудолюбивый, с деньгами, не любит самодеятельность, вовлечённый, желательно с опытом бизнеса.', initialStatus: 'Есть', priority: 'high' },
      { id: '1.5', title: 'Формат точки', description: 'Полноценная оптика (не островок), 30–50 м², эталон Токмок, какие зоны обязательны.', initialStatus: 'Есть', priority: 'high' },
    ],
  },
  {
    id: 'economics', title: 'Экономика', icon: TrendingUp, color: 'emerald',
    items: [
      { id: '2.1', title: 'Полная финансовая модель', description: 'CAPEX, OPEX, средний чек, прибыль, безубыточность, окупаемость, модель дохода головного офиса.', initialStatus: 'Есть', priority: 'critical' },
      { id: '2.2', title: 'Сценарии экономики', description: 'Слабый, базовый, хороший, сильный сценарии развития точки.', initialStatus: 'Есть', priority: 'high' },
      { id: '2.3', title: 'Модель монетизации франшизы', description: 'Паушальный взнос 300 000, роялти 3/4/5%, зарабатываем на поставках.', initialStatus: 'Есть', priority: 'high' },
      { id: '2.4', title: 'Модель по налогам для разных стран', description: 'Кыргызстан, Казахстан, Россия, Узбекистан.', initialStatus: 'Нет', priority: 'later' },
      { id: '2.5', title: 'Сезонная модель по месяцам', description: 'Как просаживаются и растут продажи по месяцам, таблица сезонности.', initialStatus: 'Частично', priority: 'high' },
    ],
  },
  {
    id: 'package', title: 'Пакет франчайзи', icon: Gavel, color: 'violet',
    items: [
      { id: '3.1', title: 'Основной договор франшизы', description: 'Главный договор с франчайзи.', initialStatus: 'Нет', priority: 'critical' },
      { id: '3.2', title: 'Приложение: стандарты бренда', description: 'Что нельзя менять: бренд, CRM, POS, сайт, приложение, тач-экран, поставщики.', initialStatus: 'Частично', priority: 'critical' },
      { id: '3.3', title: 'Приложение: финансовые условия', description: 'Паушальный, роялти, оплата, санкции за просрочку.', initialStatus: 'Нет', priority: 'critical' },
      { id: '3.4', title: 'Приложение: территориальная логика', description: 'Город, вторая точка, развитие, отсутствие автоматического эксклюзива.', initialStatus: 'Частично', priority: 'high' },
      { id: '3.5', title: 'Лестница санкций и нарушений', description: 'Предупреждение → усиленный контроль → ограничение развития → расторжение → отключение систем.', initialStatus: 'Частично', priority: 'critical' },
      { id: '3.6', title: 'NDA / соглашение о конфиденциальности', description: 'Защита внутренних инструкций, обучения, матриц.', initialStatus: 'Нет', priority: 'high' },
      { id: '4.1', title: 'Брендбук', description: 'Логотип, цвета, шрифты, правила использования.', initialStatus: 'Частично', priority: 'critical' },
      { id: '4.2', title: 'Гайд по интерьеру', description: 'Стиль точки, материалы, свет, витрины, полки, ресепшн, тач-экран, телевизор, диагностика, мастерская.', initialStatus: 'Частично', priority: 'critical' },
      { id: '4.3', title: 'Гайд по вывеске и входной группе', description: 'Наружная вывеска, внутренние логотипы, размеры, свет, варианты для ТЦ и улицы.', initialStatus: 'Частично', priority: 'high' },
      { id: '4.4', title: 'Гайд по униформе', description: 'Что носят продавцы, как выглядит форма, какие цвета, что нельзя.', initialStatus: 'Частично', priority: 'high' },
      { id: '4.5', title: 'Гайд по полиграфии', description: 'Визитки, листовки, сертификаты, гарантийки.', initialStatus: 'Нет', priority: 'high' },
    ],
  },
  {
    id: 'standards', title: 'Стандарты', icon: ClipboardList, color: 'orange',
    items: [
      { id: '6.1', title: 'Главный операционный manual', description: 'Главная книга франшизы: как работает точка каждый день.', initialStatus: 'Нет', priority: 'critical' },
      { id: '6.2', title: 'Стандарт открытия и закрытия дня', description: 'Что делает команда утром и вечером.', initialStatus: 'Нет', priority: 'high' },
      { id: '6.3', title: 'Стандарт обслуживания клиента', description: 'Приветствие → диагностика → подбор оправы → подбор линз → оформление → выдача.', initialStatus: 'Частично', priority: 'critical' },
      { id: '6.4', title: 'Стандарт честной консультации', description: 'Как продавать без втюхивания.', initialStatus: 'Частично', priority: 'high' },
      { id: '6.5', title: 'Стандарт диагностики', description: 'Что делает продавец, который проводит диагностику.', initialStatus: 'Нет', priority: 'critical' },
      { id: '6.6', title: 'Стандарт работы мастера', description: 'Сборка, ремонт, установка линз, замена лески, сроки, качество.', initialStatus: 'Нет', priority: 'critical' },
      { id: '6.7', title: 'Стандарт выдачи заказа', description: 'Как отдавать очки клиенту.', initialStatus: 'Нет', priority: 'high' },
      { id: '6.8', title: 'Стандарт постпродажного сервиса', description: 'WhatsApp, приложение, напоминания, подтяжка, поддержка.', initialStatus: 'Частично', priority: 'high' },
      { id: '6.9', title: 'Стандарт возвратов и спорных ситуаций', description: 'Когда доработка, когда замена, когда возврат, кто решает.', initialStatus: 'Нет', priority: 'critical' },
      { id: '6.10', title: 'Стандарт чистоты и внешнего вида', description: 'Требования к порядку, чистоте, внешнему виду помещения.', initialStatus: 'Нет', priority: 'high' },
      { id: '6.11', title: 'Стандарт выкладки оправ', description: 'Правила расстановки и группировки оправ на витринах.', initialStatus: 'Нет', priority: 'high' },
      { id: '6.12', title: 'Стандарт цен и скидок', description: 'Правила ценообразования и предоставления скидок.', initialStatus: 'Нет', priority: 'high' },
      { id: '6.13', title: 'Стандарт работы с CRM и POS', description: 'Как франчайзи и персонал используют системы CRM и POS.', initialStatus: 'Частично', priority: 'critical' },
      { id: '6.14', title: 'Стандарт контроля качества сервиса', description: 'Как работает прослушка, AI-анализ и корректировка персонала.', initialStatus: 'Частично', priority: 'critical' },
    ],
  },
  {
    id: 'training', title: 'Обучение', icon: GraduationCap, color: 'cyan',
    items: [
      { id: '7.1', title: 'Программа обучения франчайзи-владельца', description: 'Полная программа обучения для владельца франшизной точки.', initialStatus: 'Нет', priority: 'critical' },
      { id: '7.2', title: 'Программа обучения управляющего', description: 'Полная программа обучения для управляющего точкой.', initialStatus: 'Нет', priority: 'critical' },
      { id: '7.3', title: 'Программа обучения продавца', description: 'Полная программа обучения для продавца-консультанта.', initialStatus: 'Нет', priority: 'critical' },
      { id: '7.4', title: 'Программа обучения диагностике', description: 'Обучение проведению диагностики зрения.', initialStatus: 'Нет', priority: 'critical' },
      { id: '7.5', title: 'Программа обучения мастера', description: 'Обучение мастера по оправам и линзам.', initialStatus: 'Нет', priority: 'critical' },
      { id: '7.6', title: 'Система аттестации', description: 'Тесты, допуск к работе, повторная аттестация.', initialStatus: 'Нет', priority: 'high' },
      { id: '7.7', title: 'Видео-уроки', description: 'Обучающие видео по всем направлениям.', initialStatus: 'Нет', priority: 'later' },
      { id: '7.8', title: 'База знаний', description: 'Централизованная база знаний франшизы.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.1', title: 'Портреты должностей', description: 'Продавец, мастер, управляющий — описания должностей.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.2', title: 'Шаблоны вакансий', description: 'Готовые шаблоны объявлений для найма.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.3', title: 'Анкета кандидата (сотрудник)', description: 'Анкета для соискателей на позиции в точке.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.4', title: 'Скрипт собеседования', description: 'Готовый скрипт для проведения собеседований.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.5', title: 'Чек-лист отбора сотрудника', description: 'Критерии выбора кандидата на должность.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.6', title: 'Стажировочная программа', description: 'Программа стажировки нового сотрудника.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.7', title: 'План первых 30 дней сотрудника', description: 'Структурированный план адаптации нового сотрудника.', initialStatus: 'Нет', priority: 'high' },
    ],
  },
  {
    id: 'marketing', title: 'Маркетинг', icon: Megaphone, color: 'pink',
    items: [
      { id: '10.1', title: 'Маркетинговая стратегия запуска точки', description: 'Полный план продвижения при открытии новой точки.', initialStatus: 'Нет', priority: 'critical' },
      { id: '10.2', title: 'Календарь маркетинга на год', description: 'Годовой план маркетинговых активностей.', initialStatus: 'Нет', priority: 'later' },
      { id: '10.3', title: 'Готовые рекламные макеты', description: 'Пакет рекламных материалов для франчайзи.', initialStatus: 'Частично', priority: 'high' },
      { id: '10.4', title: 'Правила локальной рекламы', description: 'Что франчайзи может делать самостоятельно, а что требует согласования.', initialStatus: 'Нет', priority: 'critical' },
      { id: '10.5', title: 'Сценарии промо-акций', description: 'Готовые сценарии акций и спецпредложений.', initialStatus: 'Нет', priority: 'high' },
      { id: '10.6', title: 'Шаблоны текстов для рекламы', description: 'Готовые тексты для объявлений, постов, рассылок.', initialStatus: 'Нет', priority: 'high' },
      { id: '10.7', title: 'Стандарт ведения соцсетей', description: 'Правила публикаций, тон, контент-план.', initialStatus: 'Нет', priority: 'high' },
      { id: '10.8', title: 'Фото- и видео-гайд', description: 'Стандарты съёмки для соцсетей и рекламных материалов.', initialStatus: 'Нет', priority: 'later' },
    ],
  },
  {
    id: 'candidates', title: 'Кандидаты', icon: UserSearch, color: 'yellow',
    items: [
      { id: '13.1', title: 'Короткий продающий PDF', description: 'Краткий презентационный документ для потенциальных франчайзи.', initialStatus: 'Нет', priority: 'critical' },
      { id: '13.2', title: 'Большая презентация франшизы', description: 'Полная презентация с цифрами, форматами, условиями.', initialStatus: 'Нет', priority: 'high' },
      { id: '13.3', title: 'Лендинг франшизы', description: 'Публичный сайт для привлечения кандидатов.', initialStatus: 'Нет', priority: 'critical' },
      { id: '13.4', title: 'FAQ для кандидата', description: 'Ответы на частые вопросы потенциальных франчайзи.', initialStatus: 'Нет', priority: 'high' },
      { id: '13.5', title: 'Анкета кандидата (франчайзи)', description: 'Форма для сбора информации о потенциальном франчайзи.', initialStatus: 'Нет', priority: 'high' },
      { id: '13.6', title: 'Скрипт интервью с кандидатом', description: 'Скрипт для проведения встречи с кандидатом на франшизу.', initialStatus: 'Нет', priority: 'high' },
      { id: '13.7', title: 'Матрица отбора кандидатов', description: 'Система оценки и отбора потенциальных франчайзи.', initialStatus: 'Нет', priority: 'high' },
    ],
  },
  {
    id: 'launches', title: 'Запуски', icon: Rocket, color: 'amber',
    items: [
      { id: '5.1', title: 'Чек-лист выбора помещения', description: 'Площадь, трафик, фасад, видимость, соседство, аренда, парковка.', initialStatus: 'Нет', priority: 'critical' },
      { id: '5.2', title: 'Форма оценки помещения', description: 'Шаблон для отправки помещения на согласование.', initialStatus: 'Нет', priority: 'high' },
      { id: '5.3', title: 'ТЗ для дизайнеров', description: 'Что они обязаны учесть в проекте точки.', initialStatus: 'Нет', priority: 'critical' },
      { id: '5.5', title: 'Пошаговый чек-лист открытия точки', description: 'От поиска помещения до открытия — полный список шагов.', initialStatus: 'Нет', priority: 'critical' },
      { id: '5.6', title: 'Календарь запуска', description: 'По неделям: помещение, проект, ремонт, мебель, персонал, обучение, реклама, запуск.', initialStatus: 'Нет', priority: 'high' },
      { id: '5.7', title: 'Полный бюджет открытия точки', description: 'Всё необходимое для старта: оборудование, мебель, ремонт, оправы, линзы, футляры, расходники, форма, полиграфия — итоговая стоимость запуска одной оптики.', initialStatus: 'Частично', priority: 'critical' },
    ],
  },
  {
    id: 'control', title: 'Контроль франчайзи', icon: Shield, color: 'red',
    items: [
      { id: '12.1', title: 'Формат постоянной поддержки', description: 'Что даётся еженедельно и ежемесячно, форматы взаимодействия.', initialStatus: 'Нет', priority: 'critical' },
      { id: '12.2', title: 'Еженедельный отчёт франчайзи', description: 'Форма и содержание еженедельного отчёта.', initialStatus: 'Нет', priority: 'high' },
      { id: '12.3', title: 'Ежемесячный отчёт франчайзи', description: 'Форма и содержание ежемесячного отчёта.', initialStatus: 'Нет', priority: 'high' },
      { id: '12.4', title: 'Формат аудита точки', description: 'Как проводится проверка франшизной точки.', initialStatus: 'Нет', priority: 'high' },
      { id: '12.5', title: 'Чек-лист проверки стандартов', description: 'Полный список критериев проверки соответствия стандартам.', initialStatus: 'Нет', priority: 'critical' },
      { id: '12.6', title: 'Матрица нарушений', description: 'Классификация нарушений и соответствующих мер.', initialStatus: 'Нет', priority: 'critical' },
      { id: '12.7', title: 'Порядок усиленного контроля', description: 'Процедура перевода точки на усиленный контроль.', initialStatus: 'Нет', priority: 'high' },
      { id: '12.8', title: 'Порядок допуска ко второй точке', description: 'Условия и процедура открытия второй точки франчайзи.', initialStatus: 'Нет', priority: 'high' },
    ],
  },
  {
    id: 'files', title: 'Файлы и шаблоны', icon: FolderOpen, color: 'indigo',
    items: [
      { id: '9.1', title: 'Ассортиментная матрица оправ', description: 'По группам, ценам, долям — полная матрица ассортимента оправ.', initialStatus: 'Частично', priority: 'critical' },
      { id: '9.2', title: 'Ассортиментная матрица линз', description: 'Что обязательно в наличии, что под заказ.', initialStatus: 'Частично', priority: 'high' },
      { id: '9.3', title: 'Стандарт стартовой загрузки точки', description: 'Сколько нужно оправ, линз и материалов для открытия.', initialStatus: 'Частично', priority: 'high' },
      { id: '9.4', title: 'Правила пополнения', description: 'Как и когда пополняется товарный запас.', initialStatus: 'Нет', priority: 'high' },
      { id: '9.5', title: 'Каталог поставляемых позиций', description: 'Полный список позиций через головной офис.', initialStatus: 'Нет', priority: 'high' },
      { id: '9.6', title: 'Трансферные цены для франчайзи', description: 'По чём франчайзи покупает оправы, линзы, материалы.', initialStatus: 'Частично', priority: 'critical' },
      { id: '9.7', title: 'Правила брака и рекламаций', description: 'Порядок работы с браком и претензиями по товару.', initialStatus: 'Нет', priority: 'high' },
      { id: '11.1', title: 'Правила подключения CRM', description: 'Как подключить новую точку к CRM-системе.', initialStatus: 'Частично', priority: 'high' },
      { id: '11.2', title: 'Правила подключения POS', description: 'Как настроить и подключить POS-систему.', initialStatus: 'Частично', priority: 'high' },
      { id: '11.3', title: 'Правила подключения мобильного приложения', description: 'Как подключить точку к мобильному приложению.', initialStatus: 'Нет', priority: 'high' },
      { id: '11.4', title: 'Правила подключения тач-экрана', description: 'Настройка и подключение тач-экрана.', initialStatus: 'Нет', priority: 'high' },
      { id: '11.5', title: 'Роли и доступы', description: 'Матрица ролей и уровней доступа для разных сотрудников.', initialStatus: 'Нет', priority: 'high' },
      { id: '11.6', title: 'Базовый цифровой onboarding новой точки', description: 'Пошаговый процесс подключения новой точки ко всем системам.', initialStatus: 'Нет', priority: 'high' },
      { id: '11.7', title: 'Инструкции по поддержке и обновлениям', description: 'Как обращаться за поддержкой, как обновляются системы.', initialStatus: 'Нет', priority: 'high' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cx(...args: (string | false | null | undefined)[]) {
  return args.filter(Boolean).join(' ');
}

const GRAD: Record<string, string> = {
  sky:     'from-sky-400 to-sky-500',
  emerald: 'from-emerald-400 to-emerald-500',
  violet:  'from-violet-400 to-violet-500',
  orange:  'from-orange-400 to-orange-500',
  cyan:    'from-cyan-400 to-cyan-500',
  pink:    'from-pink-400 to-pink-500',
  yellow:  'from-yellow-400 to-yellow-500',
  amber:   'from-amber-400 to-amber-500',
  red:     'from-red-400 to-red-500',
  indigo:  'from-indigo-400 to-indigo-500',
};
const RING: Record<string, string> = {
  sky:     'ring-sky-200',
  emerald: 'ring-emerald-200',
  violet:  'ring-violet-200',
  orange:  'ring-orange-200',
  cyan:    'ring-cyan-200',
  pink:    'ring-pink-200',
  yellow:  'ring-yellow-200',
  amber:   'ring-amber-200',
  red:     'ring-red-200',
  indigo:  'ring-indigo-200',
};

const SECTION_AUDIENCES: Record<string, Audience[]> = {
  passport: ['hq', 'franchisee'],
  economics: ['hq', 'franchisee'],
  package: ['hq', 'franchisee'],
  standards: ['hq', 'franchisee'],
  training: ['hq', 'franchisee'],
  marketing: ['hq', 'franchisee'],
  candidates: ['hq', 'candidate'],
  launches: ['hq', 'franchisee'],
  control: ['hq', 'franchisee'],
  files: ['hq', 'franchisee'],
};

const ITEM_AUDIENCES: Record<string, Audience[]> = {
  '1.4': ['hq', 'candidate'],
  '2.1': ['hq'],
  '2.2': ['hq', 'candidate'],
  '2.3': ['hq', 'franchisee', 'candidate'],
  '2.4': ['hq', 'franchisee', 'candidate'],
  '2.5': ['hq', 'franchisee', 'candidate'],
  '5.7': ['hq', 'franchisee', 'candidate'],
  '13.6': ['hq'],
  '13.7': ['hq'],
};

const AUDIENCE_META: Record<Audience, {
  label: string;
  hint: string;
  icon: React.ElementType;
  className: string;
}> = {
  hq: {
    label: 'Штаб',
    hint: 'Внутренний документ или рабочий инструмент штаба.',
    icon: Building2,
    className: 'bg-slate-100 text-slate-700 ring-slate-200',
  },
  franchisee: {
    label: 'Франчайзи',
    hint: 'Материал для действующего франчайзи и его точки.',
    icon: Store,
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  candidate: {
    label: 'Кандидат',
    hint: 'Материал для потенциального франчайзи до сделки.',
    icon: UserSearch,
    className: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
};

function getItemAudiences(sectionId: string, itemId: string): Audience[] {
  return ITEM_AUDIENCES[itemId] ?? SECTION_AUDIENCES[sectionId] ?? ['hq'];
}

function AudienceBadges({
  audiences,
  compact = false,
}: {
  audiences: Audience[];
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {audiences.map((audience) => {
        const meta = AUDIENCE_META[audience];
        const Icon = meta.icon;
        return (
          <span
            key={audience}
            title={meta.hint}
            className={cx(
              'inline-flex items-center gap-1 rounded-full ring-1',
              compact ? 'px-2 py-0.5 text-[10px] font-semibold' : 'px-2.5 py-1 text-[11px] font-medium',
              meta.className,
            )}
          >
            <Icon size={compact ? 10 : 12} />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function statusBadge(s: ItemStatus) {
  const map = {
    'Есть':             { bg: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: <CheckCircle2 size={11}/> },
    'Частично':         { bg: 'bg-amber-50 text-amber-700 ring-amber-200',       icon: <Clock size={11}/> },
    'Нет':              { bg: 'bg-rose-50 text-rose-600 ring-rose-200',           icon: <AlertCircle size={11}/> },
    'Не нужно сейчас':  { bg: 'bg-slate-100 text-slate-500 ring-slate-200',      icon: <Minus size={11}/> },
  };
  return map[s];
}

function priorityBadge(p: Priority) {
  const map = {
    critical: { bg: 'bg-rose-50 text-rose-600 ring-rose-200',    label: 'Обязательно' },
    high:     { bg: 'bg-sky-50 text-sky-700 ring-sky-200',        label: 'Сделать' },
    later:    { bg: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'Позже' },
    skip:     { bg: 'bg-slate-100 text-slate-400 ring-slate-200', label: 'Пропустить' },
  };
  return map[p];
}

// ─── Word export ──────────────────────────────────────────────────────────────

// ─── Shared markdown parser (used by Word export + modal preview) ─────────────

function mdEsc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function mdInline(s: string) {
  return mdEsc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>')
    .replace(/~~(.+?)~~/g,     '<s>$1</s>');
}
function parseMarkdownToHtml(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').split('\n');
  const out: string[] = [];
  let inUL = false, inOL = false;
  const closeUL = () => { if (inUL) { out.push('</ul>'); inUL = false; } };
  const closeOL = () => { if (inOL) { out.push('</ol>'); inOL = false; } };
  const closeLists = () => { closeUL(); closeOL(); };
  for (const line of lines) {
    const t = line.trim();
    if (/^####\s/.test(t))  { closeLists(); out.push(`<h4>${mdInline(t.replace(/^####\s/, ''))}</h4>`);       continue; }
    if (/^###\s/.test(t))   { closeLists(); out.push(`<h3>${mdInline(t.replace(/^###\s/, ''))}</h3>`);         continue; }
    if (/^##\s/.test(t))    { closeLists(); out.push(`<h2>${mdInline(t.replace(/^##\s/, ''))}</h2>`);           continue; }
    if (/^#\s/.test(t))     { closeLists(); out.push(`<h1>${mdInline(t.replace(/^#\s/, ''))}</h1>`);            continue; }
    if (/^(-{3,}|\*{3,})$/.test(t)) { closeLists(); out.push('<hr>'); continue; }
    if (/^[-*+]\s/.test(t)) { closeOL(); if (!inUL) { out.push('<ul>'); inUL = true; } out.push(`<li>${mdInline(t.replace(/^[-*+]\s/, ''))}</li>`); continue; }
    if (/^\d+\.\s/.test(t)) { closeUL(); if (!inOL) { out.push('<ol>'); inOL = true; } out.push(`<li>${mdInline(t.replace(/^\d+\.\s/, ''))}</li>`); continue; }
    if (t === '') { closeLists(); out.push('<div class="md-sp"></div>'); continue; }
    closeLists();
    out.push(`<p>${mdInline(t)}</p>`);
  }
  closeLists();
  return out.join('\n');
}

// ─── Word export ──────────────────────────────────────────────────────────────

function buildWordHtml(title: string, description: string, content: string, notes: string, images: string[] = []) {
  const esc = mdEsc;
  const inline = mdInline;

  function parseMarkdown(raw: string): string { return parseMarkdownToHtml(raw); }

  const today = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });

  const imagesHtml = images.length > 0 ? (() => {
    // Максимум 2 картинки в ряд, чтобы они были большими и детальными
    const cols = Math.min(images.length, 2);
    const cellWidthPct = Math.floor(100 / cols);
    const imgWidthPx = cols === 1 ? 460 : 230;

    return `
      <div class="slabel">Фото и визуализации</div>
      <table style="border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:12pt;">
        <tr>
          ${images.map((src, i) => `
            <td style="width:${cellWidthPct}%;padding:10pt;background:#f8fafc;vertical-align:middle;text-align:center;border:4pt solid #ffffff;">
              <img src="${src}" width="${imgWidthPx}" style="border-radius:4pt;border:1px solid #cbd5e1;display:block;margin:0 auto;">
            </td>
            ${(i + 1) % cols === 0 && i + 1 < images.length ? '</tr><tr>' : ''}
          `).join('')}
          ${images.length % cols !== 0 ? `<td style="width:${cellWidthPct}%;border:4pt solid #ffffff;"></td>` : ''}
        </tr>
      </table>`;
  })() : '';

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
         xmlns:w='urn:schemas-microsoft-com:office:word'
         xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>${esc(title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap');
    @page { margin: 2cm 2.2cm; }
    body   { font-family: 'Manrope','Segoe UI',Arial,sans-serif; font-size: 10.5pt; color: #1e293b; line-height: 1.55; margin: 0; }
    .doc-header { border-bottom: 3px solid #0ea5e9; padding-bottom: 10pt; margin-bottom: 16pt; }
    .brand-line { font-size: 8pt; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: #0369a1; margin-bottom: 4pt; }
    .doc-title  { font-size: 17pt; font-weight: 800; color: #0f172a; margin: 0 0 5pt 0; }
    .doc-desc   { font-size: 9.5pt; color: #64748b; font-weight: 500; margin: 0; }
    .doc-date   { font-size: 8pt; color: #94a3b8; margin-top: 4pt; }
    .slabel { font-size: 8pt; font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
              color: #0369a1; margin: 18pt 0 7pt 0; padding-bottom: 3pt; border-bottom: 1px solid #e0f2fe; }
    h1.ch1 { font-size: 12.5pt; font-weight: 800; color: #0f172a; margin: 13pt 0 3pt 0; padding-bottom: 3pt; border-bottom: 1.5px solid #e2e8f0; }
    h2 { font-size: 11pt; font-weight: 700; color: #1e3a5f; margin: 11pt 0 2pt 0; }
    h3 { font-size: 10.5pt; font-weight: 700; color: #334155; margin: 9pt 0 2pt 0; }
    h4 { font-size: 10pt; font-weight: 600; color: #475569; margin: 7pt 0 1pt 0; }
    p  { margin: 2.5pt 0; }
    .sp { height: 5pt; }
    strong { font-weight: 700; } em { font-style: italic; }
    code { font-family: 'Courier New',monospace; font-size: 9pt; background: #f1f5f9; padding: 0 2pt; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 8pt 0; }
    ul, ol { margin: 3pt 0; padding-left: 15pt; } li { margin: 1.5pt 0; }
    .notes-wrap { margin-top: 16pt; background: #f0f9ff; padding: 8pt 10pt; border-left: 3px solid #0ea5e9; }
  </style>
</head>
<body>
  <div class="doc-header">
    <div class="brand-line">REFOCUS &middot; Штаб франшизы</div>
    <div class="doc-title">${esc(title)}</div>
    <div class="doc-desc">${esc(description)}</div>
    <div class="doc-date">${today}</div>
  </div>
  ${content ? `<div class="slabel">Содержание документа</div>${parseMarkdown(content)}` : ''}
  ${imagesHtml}
  ${notes   ? `<div class="notes-wrap"><div class="slabel" style="border:none;margin-top:0">Заметки</div>${parseMarkdown(notes)}</div>` : ''}
</body>
</html>`;
}

// ─── VideoAddForm ─────────────────────────────────────────────────────────────

function VideoAddForm({ onAdd }: { onAdd: (title: string, url: string) => void }) {
  const [url,   setUrl]   = React.useState('');
  const [title, setTitle] = React.useState('');
  const [open,  setOpen]  = React.useState(false);

  function handleAdd() {
    if (!url.trim()) return;
    onAdd(title || url, url);
    setUrl(''); setTitle(''); setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 transition-all text-[12px] font-medium"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Добавить видео (YouTube / ссылка)
      </button>
    );
  }

  return (
    <div className="rounded-xl ring-1 ring-rose-200 bg-rose-50 p-3 space-y-2">
      <input
        autoFocus
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="Ссылка на видео (YouTube, youtu.be…)"
        className="w-full text-[13px] bg-white ring-1 ring-rose-200 focus:ring-rose-400 focus:outline-none rounded-lg px-3 py-2 placeholder:text-slate-300"
      />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Название (необязательно)"
        className="w-full text-[13px] bg-white ring-1 ring-rose-200 focus:ring-rose-400 focus:outline-none rounded-lg px-3 py-2 placeholder:text-slate-300"
        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
      />
      <div className="flex gap-2">
        <button
          onClick={handleAdd}
          disabled={!url.trim()}
          className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-r from-rose-500 to-pink-500 hover:brightness-110 disabled:opacity-40 transition-all"
        >
          Добавить
        </button>
        <button
          onClick={() => { setOpen(false); setUrl(''); setTitle(''); }}
          className="px-3 py-1.5 rounded-lg text-[12px] text-slate-500 bg-white ring-1 ring-slate-200 hover:bg-slate-50 transition-colors"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

// ─── LocalTextarea — own local state, no parent re-render on every keystroke ──

interface LocalTextareaProps {
  initialValue: string;
  placeholder: string;
  rows: number;
  className: string;
  onCommit: (value: string) => void; // called on blur
}

function LocalTextarea({ initialValue, placeholder, rows, className, onCommit }: LocalTextareaProps) {
  // Local state — changes here do NOT re-render the parent card list.
  // Value is committed to parent (and saved) only on blur.
  // key={item.id + field} on the usage site ensures fresh state when a different item opens.
  const [value, setValue] = React.useState(initialValue);

  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      className={className}
      onChange={ev => setValue(ev.target.value)}
      onBlur={() => onCommit(value)}
    />
  );
}

// ─── Content Modal ────────────────────────────────────────────────────────────

interface ContentModalProps {
  item: PlanItem;
  initialContent: string;
  isSaving: boolean;
  onClose: () => void;
  onCommit: (val: string) => void;
  onSave: () => void;
}

function ContentModal({ item, initialContent, isSaving, onClose, onCommit, onSave }: ContentModalProps) {
  const [text, setText]       = React.useState(initialContent);
  const [mode, setMode]       = React.useState<'preview' | 'edit'>(initialContent.trim() ? 'preview' : 'edit');
  const textareaRef           = React.useRef<HTMLTextAreaElement>(null);
  const renderedHtml          = React.useMemo(() => parseMarkdownToHtml(text), [text]);

  React.useEffect(() => {
    if (mode === 'edit') {
      const t = setTimeout(() => textareaRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [mode]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onCommit(text); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [text]);

  function handleSaveAndClose() {
    onCommit(text);
    onSave();
    onClose();
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col"
      style={{ background: 'rgba(5,10,28,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) { onCommit(text); onClose(); } }}
    >
      {/* ── Top toolbar ── */}
      <div
        className="shrink-0 flex items-center gap-3 px-5 py-2.5"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/30 shrink-0">{item.id}</span>
          <span className="text-[13px] font-semibold text-white/65 truncate">{item.title}</span>
        </div>

        {/* View / Edit toggle */}
        <div className="shrink-0 flex items-center bg-white/8 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setMode('preview')}
            className={cx(
              'px-3 py-1 rounded-md text-[12px] font-medium transition-all',
              mode === 'preview' ? 'bg-white text-slate-800 shadow-sm' : 'text-white/50 hover:text-white/80',
            )}
          >Просмотр</button>
          <button
            onClick={() => setMode('edit')}
            className={cx(
              'px-3 py-1 rounded-md text-[12px] font-medium transition-all',
              mode === 'edit' ? 'bg-white text-slate-800 shadow-sm' : 'text-white/50 hover:text-white/80',
            )}
          >Редактировать</button>
        </div>

        {/* Counters */}
        <div className="text-[11px] text-white/30 tabular-nums shrink-0 hidden sm:block">
          {wordCount.toLocaleString('ru')} сл.&nbsp;·&nbsp;{charCount.toLocaleString('ru')} симв.
        </div>

        {/* Save */}
        <button
          onClick={handleSaveAndClose}
          disabled={isSaving}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-r from-teal-500 to-cyan-500 shadow-[0_3px_12px_rgba(34,211,238,0.35)] hover:brightness-110 active:brightness-90 transition-all disabled:opacity-50"
        >
          {isSaving ? <><Loader2 size={13} className="animate-spin"/>Сохраняю…</> : <><Save size={13}/>Сохранить</>}
        </button>
        <button
          onClick={() => { onCommit(text); onClose(); }}
          className="shrink-0 p-1.5 rounded-lg text-white/35 hover:text-white/75 hover:bg-white/8 transition-colors"
          title="Закрыть (Esc)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      {/* ── Document paper ── */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-6"
        onMouseDown={e => e.stopPropagation()}
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent' }}
      >
        <div
          className="mx-auto bg-white rounded-xl overflow-hidden"
          style={{
            maxWidth: '800px',
            minHeight: 'calc(100vh - 100px)',
            boxShadow: '0 28px_90px rgba(0,0,0,0.60), 0 4px 20px rgba(0,0,0,0.35)',
          }}
        >
          {/* Document title block */}
          <div className="px-14 pt-10 pb-5 border-b border-slate-100">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.26em] mb-2">
              REFOCUS · Штаб франшизы · {item.id}
            </div>
            <h1 className="text-[22px] font-bold text-slate-900 leading-snug" style={{ fontFamily: 'Georgia, serif' }}>
              {item.title}
            </h1>
            <p className="mt-1.5 text-[12.5px] text-slate-500 leading-relaxed">{item.description}</p>
          </div>

          {/* Content area */}
          <div className="px-14 py-8">
            {mode === 'preview' ? (
              /* ── Rendered preview ── */
              text.trim() ? (
                <div
                  className="doc-content"
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              ) : (
                <div className="text-slate-300 text-[14px] italic">Нет содержимого. Переключитесь в режим «Редактировать».</div>
              )
            ) : (
              /* ── Raw editor ── */
              <textarea
                ref={textareaRef}
                value={text}
                onChange={ev => setText(ev.target.value)}
                placeholder="Вставьте текст из Word / Google Docs или напишите сами.&#10;&#10;Поддерживается Markdown:&#10;# Заголовок 1&#10;## Заголовок 2&#10;**жирный** *курсив*&#10;- элемент списка"
                className="w-full resize-none border-none outline-none bg-transparent placeholder:text-slate-300"
                style={{
                  minHeight: 'calc(100vh - 280px)',
                  fontFamily: '"Segoe UI", Calibri, system-ui, sans-serif',
                  fontSize: '14px',
                  lineHeight: '1.85',
                  color: '#1e293b',
                  caretColor: '#0ea5e9',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom hint ── */}
      <div
        className="shrink-0 flex items-center justify-center py-1.5 text-[10.5px] text-white/20"
        onMouseDown={e => e.stopPropagation()}
      >
        <kbd className="px-1.5 py-0.5 rounded bg-white/6 font-mono text-[9px] text-white/30 mr-1">Esc</kbd>
        закрыть и сохранить
      </div>

      {/* ── Doc content styles ── */}
      <style>{`
        .doc-content { font-family: "Segoe UI", Calibri, system-ui, sans-serif; font-size: 14px; line-height: 1.85; color: #1e293b; }
        .doc-content h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin: 28px 0 10px; font-family: Georgia, serif; }
        .doc-content h2 { font-size: 16px; font-weight: 700; color: #1e293b; margin: 22px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
        .doc-content h3 { font-size: 14.5px; font-weight: 700; color: #334155; margin: 18px 0 6px; }
        .doc-content h4 { font-size: 13.5px; font-weight: 600; color: #475569; margin: 14px 0 4px; }
        .doc-content p  { margin: 0 0 10px; }
        .doc-content ul { margin: 6px 0 10px 20px; list-style: disc; }
        .doc-content ol { margin: 6px 0 10px 20px; list-style: decimal; }
        .doc-content li { margin: 3px 0; }
        .doc-content hr { border: none; border-top: 1px solid #cbd5e1; margin: 20px 0; }
        .doc-content strong { font-weight: 700; color: #0f172a; }
        .doc-content em { font-style: italic; color: #334155; }
        .doc-content code { font-family: "Consolas", monospace; font-size: 12.5px; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; color: #0369a1; }
        .doc-content .md-sp { height: 8px; }
      `}</style>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// Autosave on keystroke removed — save happens on blur / manual save / section switch / unload

export default function FranchiseHQPage() {
  const [dbMap,         setDbMap]         = useState<Map<string, DbItem>>(new Map());
  const [loading,       setLoading]       = useState(true);
  const [activeSectionId, setActiveSectionId] = useState(SECTIONS[0].id);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [savingSet,     setSavingSet]     = useState<Set<string>>(new Set());
  const [modalItem,     setModalItem]     = useState<PlanItem | null>(null);

  // All unsaved edits, keyed by item id
  const [edits, setEdits] = useState<Map<string, EditState>>(new Map());
  const dirtyRef   = useRef<Set<string>>(new Set());

  // Keep refs in sync synchronously during render (NOT in useEffect)
  // so that getItem/effectiveReadiness always see the latest state
  // even inside useMemo which runs during the same render cycle.
  const editsRef  = useRef(edits);
  const dbMapRef  = useRef(dbMap);
  editsRef.current = edits;
  dbMapRef.current = dbMap;

  // ── Load ──
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('franchise_hq_items')
          .select('id, status, completed, notes, content, readiness, images, documents, videos');
        if (error) throw error;

        const m = new Map<string, DbItem>();
        const toMigrate: DbItem[] = [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data ?? []).forEach((r: any) => {
          const readiness  = (r.readiness as number) ?? 0;
          const images     = (r.images as string[]) ?? [];
          const documents  = (r.documents as DocFile[]) ?? [];
          const videos     = (r.videos as VideoLink[]) ?? [];

          if (r.content?.trim() && readiness === 0) {
            const migrated: DbItem = { id: r.id, status: r.status, completed: true, notes: r.notes ?? '', content: r.content ?? '', readiness: 100, images, documents, videos };
            m.set(r.id, migrated);
            toMigrate.push(migrated);
          } else {
            m.set(r.id, { id: r.id, status: r.status, completed: r.completed, notes: r.notes ?? '', content: r.content ?? '', readiness, images, documents, videos });
          }
        });

        setDbMap(m);

        // Bulk-save migrated records silently
        if (toMigrate.length > 0) {
          void supabase.from('franchise_hq_items').upsert(toMigrate);
        }
      } catch {
        const raw = localStorage.getItem('franchise_hq_items');
        if (raw) {
          try {
            const arr: DbItem[] = JSON.parse(raw);
            const m = new Map<string, DbItem>();
            arr.forEach(r => m.set(r.id, { ...r, readiness: r.readiness ?? 0, images: r.images ?? [], documents: r.documents ?? [], videos: r.videos ?? [] }));
            setDbMap(m);
          } catch { /* ignore */ }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Persist to localStorage ──
  useEffect(() => {
    localStorage.setItem('franchise_hq_items', JSON.stringify(Array.from(dbMap.values())));
  }, [dbMap]);

  // ── Helpers ──
  function getItem(id: string, initialStatus: ItemStatus): DbItem {
    return dbMapRef.current.get(id) ?? { id, status: initialStatus, completed: false, notes: '', content: '', readiness: 0, images: [], documents: [], videos: [] };
  }

  function getEdit(id: string, initialStatus: ItemStatus): EditState {
    const db = getItem(id, initialStatus);
    return editsRef.current.get(id) ?? { notes: db.notes, content: db.content };
  }

  // ── Save single item ──
  async function performSave(id: string, initialStatus: ItemStatus, silent = false) {
    const e = editsRef.current.get(id);
    if (!dirtyRef.current.has(id) || !e) return;

    dirtyRef.current.delete(id);
    const db    = getItem(id, initialStatus);
    const upd: DbItem = { ...db, notes: e.notes, content: e.content };

    setSavingSet(p => new Set(p).add(id));
    setDbMap(p => new Map(p).set(id, upd));

    try {
      // First try to partial update to avoid race conditions overwriting other fields like `images`.
      // If it fails because the row doesn't exist, we fallback to upserting the full object.
      let err;
      const { data: existing } = await supabase.from('franchise_hq_items').select('id').eq('id', id).single();
      
      if (existing) {
        const { error } = await supabase.from('franchise_hq_items').update({ notes: e.notes, content: e.content }).eq('id', id);
        err = error;
      } else {
        const { error } = await supabase.from('franchise_hq_items').upsert(upd);
        err = error;
      }

      if (err) throw err;
      if (!silent) toast.success('Сохранено', { id: `save-${id}`, duration: 1800 });
    } catch {
      toast.error('Ошибка сохранения — проверьте подключение', { id: `err-${id}` });
      dirtyRef.current.add(id); // mark dirty again so user can retry
    } finally {
      setSavingSet(p => { const s = new Set(p); s.delete(id); return s; });
    }
  }

  // ── Commit edit from LocalTextarea on blur ──
  function commitEdit(
    id: string,
    initialStatus: ItemStatus,
    field: 'notes' | 'content',
    value: string,
  ) {
    const curr = editsRef.current.get(id) ?? { notes: getItem(id, initialStatus).notes, content: getItem(id, initialStatus).content };
    const next = { ...curr, [field]: value };
    setEdits(prev => new Map(prev).set(id, next));
    editsRef.current = new Map(editsRef.current).set(id, next);
    dirtyRef.current.add(id);
    void performSave(id, initialStatus, true);
  }

  // ── Change readiness (0 | 25 | 50 | 75 | 100) ──
  async function changeReadiness(id: string, initialStatus: ItemStatus, value: number) {
    const db  = getItem(id, initialStatus);
    const upd: DbItem = { ...db, readiness: value, completed: value === 100 };
    setDbMap(p => new Map(p).set(id, upd));
    try {
      await supabase.from('franchise_hq_items').upsert(upd);
    } catch {
      toast.error('Ошибка сохранения');
      setDbMap(p => new Map(p).set(id, db));
    }
  }

  // ── Flush all dirty items in a section before switching ──
  function flushSection(sectionId: string) {
    const section = SECTIONS.find(s => s.id === sectionId);
    if (!section) return;
    for (const item of section.items) {
      if (dirtyRef.current.has(item.id)) {
        void performSave(item.id, item.initialStatus, true);
      }
    }
  }

  function switchSection(newId: string) {
    flushSection(activeSectionId);
    setActiveSectionId(newId);
    setExpandedItemId(null);
  }

  // ── Flush on page unload ──
  useEffect(() => {
    function onUnload() {
      for (const section of SECTIONS) flushSection(section.id);
    }
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // ── Toggle complete ──
  async function toggleCompleted(id: string, initialStatus: ItemStatus) {
    const db  = getItem(id, initialStatus);
    const upd: DbItem = { ...db, completed: !db.completed };
    setDbMap(p => new Map(p).set(id, upd));
    try {
      await supabase.from('franchise_hq_items').upsert(upd);
      toast.success(upd.completed ? '✓ Отмечено выполненным' : 'Отметка снята', { duration: 1500 });
    } catch { toast.error('Ошибка'); }
  }

  // ── Change status ──
  async function changeStatus(id: string, initialStatus: ItemStatus, newStatus: ItemStatus) {
    const db  = getItem(id, initialStatus);
    const upd: DbItem = { ...db, status: newStatus };
    setDbMap(p => new Map(p).set(id, upd));
    try {
      await supabase.from('franchise_hq_items').upsert(upd);
    } catch {
      toast.error('Ошибка сохранения статуса');
      setDbMap(p => new Map(p).set(id, db)); // rollback
    }
  }

  // ── Upload tracking ──
  const [uploadingSet, setUploadingSet] = useState<Set<string>>(new Set());

  // ── Upload images to Supabase Storage ──
  async function uploadImages(id: string, initialStatus: ItemStatus, files: FileList) {
    setUploadingSet(prev => new Set(prev).add(id));
    const uploaded: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const ext  = file.name.split('.').pop() ?? 'jpg';
        const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage
          .from('franchise-hq-images')
          .upload(path, file, { upsert: false });
        if (error) { 
          console.error('Supabase upload error:', error);
          toast.error(`Ошибка ${file.name}: ${error.message}`); 
          continue; 
        }
        const { data } = supabase.storage.from('franchise-hq-images').getPublicUrl(path);
        uploaded.push(data.publicUrl);
      } catch (err: any) { 
        console.error('Upload exception:', err);
        toast.error(`Сбой: ${err?.message || file.name}`); 
      }
    }
    if (uploaded.length > 0) {
      const db = getItem(id, initialStatus);
      const newImages = [...(db.images ?? []), ...uploaded];
      const upd = { ...db, images: newImages };

      // Update UI first
      setDbMap(p => new Map(p).set(id, upd));

      // Update DB safely
      const { data: existing } = await supabase.from('franchise_hq_items').select('id').eq('id', id).single();
      
      let err;
      if (existing) {
        const { error } = await supabase.from('franchise_hq_items').update({ images: newImages }).eq('id', id);
        err = error;
      } else {
        const { error } = await supabase.from('franchise_hq_items').upsert(upd);
        err = error;
      }

      if (err) {
        toast.error(`Ошибка при сохранении фото в базу: ${err.message}`);
        console.error('DB Upsert error:', err);
      } else {
        toast.success(`Загружено ${uploaded.length} файл(а)`);
      }
    }
    setUploadingSet(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  // ── Remove one image ──
  async function removeImage(id: string, initialStatus: ItemStatus, idx: number) {
    const db  = getItem(id, initialStatus);
    const imgs = (db.images ?? []).filter((_, i) => i !== idx);
    const upd  = { ...db, images: imgs };
    setDbMap(p => new Map(p).set(id, upd));
    void supabase.from('franchise_hq_items').upsert(upd);
  }

  // ── Upload tracking for documents ──
  const [uploadingDocsSet, setUploadingDocsSet] = useState<Set<string>>(new Set());

  // ── Upload documents (Word, PDF, etc.) ──
  async function uploadDocuments(id: string, initialStatus: ItemStatus, files: FileList) {
    setUploadingDocsSet(prev => new Set(prev).add(id));
    const uploaded: DocFile[] = [];
    for (const file of Array.from(files)) {
      try {
        const ext  = file.name.split('.').pop() ?? 'bin';
        const safeName = file.name.replace(/[^а-яёА-ЯЁa-zA-Z0-9._-]/g, '_').slice(0, 80);
        const path = `docs/${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage
          .from('franchise-hq-images')
          .upload(path, file, { upsert: false });
        if (error) {
          toast.error(`Ошибка ${file.name}: ${error.message}`);
          continue;
        }
        const { data } = supabase.storage.from('franchise-hq-images').getPublicUrl(path);
        uploaded.push({ name: safeName, url: data.publicUrl });
      } catch (err: any) {
        toast.error(`Сбой: ${err?.message || file.name}`);
      }
    }
    if (uploaded.length > 0) {
      const db = getItem(id, initialStatus);
      const newDocs = [...(db.documents ?? []), ...uploaded];
      const upd = { ...db, documents: newDocs };
      setDbMap(p => new Map(p).set(id, upd));
      const { data: existing } = await supabase.from('franchise_hq_items').select('id').eq('id', id).single();
      let err;
      if (existing) {
        const { error } = await supabase.from('franchise_hq_items').update({ documents: newDocs }).eq('id', id);
        err = error;
      } else {
        const { error } = await supabase.from('franchise_hq_items').upsert(upd);
        err = error;
      }
      if (err) {
        toast.error(`Ошибка сохранения документа: ${err.message}`);
      } else {
        toast.success(`Загружено ${uploaded.length} документ(а)`);
      }
    }
    setUploadingDocsSet(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  // ── Remove one document ──
  async function removeDocument(id: string, initialStatus: ItemStatus, idx: number) {
    const db  = getItem(id, initialStatus);
    const docs = (db.documents ?? []).filter((_, i) => i !== idx);
    const upd  = { ...db, documents: docs };
    setDbMap(p => new Map(p).set(id, upd));
    const { data: existing } = await supabase.from('franchise_hq_items').select('id').eq('id', id).single();
    if (existing) {
      void supabase.from('franchise_hq_items').update({ documents: docs }).eq('id', id);
    } else {
      void supabase.from('franchise_hq_items').upsert(upd);
    }
  }

  // ── Video helpers ──
  function extractYouTubeId(url: string): string | null {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  // ── Add video link ──
  async function addVideo(id: string, initialStatus: ItemStatus, title: string, url: string) {
    const db = getItem(id, initialStatus);
    const newVideos = [...(db.videos ?? []), { title: title.trim(), url: url.trim() }];
    const upd = { ...db, videos: newVideos };
    setDbMap(p => new Map(p).set(id, upd));
    const { data: existing } = await supabase.from('franchise_hq_items').select('id').eq('id', id).single();
    let err;
    if (existing) {
      const { error } = await supabase.from('franchise_hq_items').update({ videos: newVideos }).eq('id', id);
      err = error;
    } else {
      const { error } = await supabase.from('franchise_hq_items').upsert(upd);
      err = error;
    }
    if (err) toast.error(`Ошибка сохранения видео: ${err.message}`);
    else toast.success('Видео добавлено');
  }

  // ── Remove video ──
  async function removeVideo(id: string, initialStatus: ItemStatus, idx: number) {
    const db = getItem(id, initialStatus);
    const newVideos = (db.videos ?? []).filter((_, i) => i !== idx);
    const upd = { ...db, videos: newVideos };
    setDbMap(p => new Map(p).set(id, upd));
    const { data: existing } = await supabase.from('franchise_hq_items').select('id').eq('id', id).single();
    if (existing) {
      void supabase.from('franchise_hq_items').update({ videos: newVideos }).eq('id', id);
    } else {
      void supabase.from('franchise_hq_items').upsert(upd);
    }
  }

  // ── Manual save ──
  async function manualSave(id: string, initialStatus: ItemStatus) {
    await performSave(id, initialStatus, false);
  }

  // ── Word download (async — embeds images as base64) ──
  async function downloadWord(item: PlanItem) {
    const db  = getItem(item.id, item.initialStatus);
    const e   = getEdit(item.id, item.initialStatus);
    const images = db.images ?? [];

    // Convert remote image URLs to base64 data URIs for offline embedding:
    const base64Images: string[] = [];
    for (const url of images) {
      try {
        const res  = await fetch(url);
        const blob = await res.blob();
        const b64  = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        base64Images.push(b64);
      } catch { /* skip unloadable image */ }
    }

    const html = buildWordHtml(item.title, item.description, e.content, e.notes, base64Images);
    const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-word;charset=utf-8' });
    const dlUrl = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = dlUrl;
    a.download = `refocus-${item.id}-${item.title.replace(/[^а-яёА-ЯЁa-zA-Z0-9]/g, '-').slice(0, 50)}.doc`;
    a.click();
    URL.revokeObjectURL(dlUrl);
  }

  // ── Section Word download (all items merged into one doc) ──
  async function downloadSectionWord(section: PlanSection) {
    const today = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });

    // Build HTML blocks for each item
    const itemBlocks: string[] = [];
    for (const item of section.items) {
      const db     = getItem(item.id, item.initialStatus);
      const e      = getEdit(item.id, item.initialStatus);
      const images = db.images ?? [];

      const base64Images: string[] = [];
      for (const url of images) {
        try {
          const res  = await fetch(url);
          const blob = await res.blob();
          const b64  = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          base64Images.push(b64);
        } catch { /* skip */ }
      }

      const cols = Math.min(base64Images.length, 2);
      const imgHtml = base64Images.length > 0 ? (() => {
        const cellW = Math.floor(100 / cols);
        const imgW  = cols === 1 ? 460 : 230;
        return `<div class="slabel">Фото и визуализации</div>
          <table style="border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:12pt;"><tr>
            ${base64Images.map((src, i) => `
              <td style="width:${cellW}%;padding:10pt;background:#f8fafc;vertical-align:middle;text-align:center;border:4pt solid #ffffff;">
                <img src="${src}" width="${imgW}" style="border-radius:4pt;border:1px solid #cbd5e1;display:block;margin:0 auto;">
              </td>
              ${(i + 1) % cols === 0 && i + 1 < base64Images.length ? '</tr><tr>' : ''}
            `).join('')}
            ${base64Images.length % cols !== 0 ? `<td style="width:${cellW}%;border:4pt solid #ffffff;"></td>` : ''}
          </tr></table>`;
      })() : '';

      itemBlocks.push(`
        <div class="item-block">
          <h1 class="item-title"><span class="item-id">${mdEsc(item.id)}</span> ${mdEsc(item.title)}</h1>
          <p class="item-desc">${mdEsc(item.description)}</p>
          ${e.content ? `<div class="slabel">Содержание</div>${parseMarkdownToHtml(e.content)}` : ''}
          ${imgHtml}
          ${e.notes   ? `<div class="notes-wrap"><div class="slabel" style="border:none;margin-top:0">Заметки</div>${parseMarkdownToHtml(e.notes)}</div>` : ''}
        </div>
      `);
    }

    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office'
       xmlns:w='urn:schemas-microsoft-com:office:word'
       xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>${mdEsc(section.title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap');
    @page { margin: 2cm 2.2cm; }
    body   { font-family: 'Manrope','Segoe UI',Arial,sans-serif; font-size: 10.5pt; color: #1e293b; line-height: 1.55; margin: 0; }
    .doc-header { border-bottom: 3px solid #0ea5e9; padding-bottom: 10pt; margin-bottom: 20pt; }
    .brand-line { font-size: 8pt; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: #0369a1; margin-bottom: 4pt; }
    .doc-title  { font-size: 19pt; font-weight: 800; color: #0f172a; margin: 0 0 5pt 0; }
    .doc-date   { font-size: 8pt; color: #94a3b8; margin-top: 4pt; }
    .item-block { margin-bottom: 28pt; padding-bottom: 20pt; border-bottom: 2px solid #e2e8f0; page-break-inside: avoid; }
    .item-block:last-child { border-bottom: none; }
    .item-title { font-size: 13pt; font-weight: 800; color: #0f172a; margin: 0 0 4pt 0; }
    .item-id    { font-size: 10pt; font-weight: 700; color: #0369a1; font-family: 'Courier New',monospace; margin-right: 6pt; }
    .item-desc  { font-size: 9.5pt; color: #64748b; font-weight: 500; margin: 0 0 10pt 0; }
    .slabel { font-size: 8pt; font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
              color: #0369a1; margin: 14pt 0 6pt 0; padding-bottom: 3pt; border-bottom: 1px solid #e0f2fe; }
    h2 { font-size: 11pt; font-weight: 700; color: #1e3a5f; margin: 11pt 0 2pt 0; }
    h3 { font-size: 10.5pt; font-weight: 700; color: #334155; margin: 9pt 0 2pt 0; }
    h4 { font-size: 10pt; font-weight: 600; color: #475569; margin: 7pt 0 1pt 0; }
    p  { margin: 2.5pt 0; }
    strong { font-weight: 700; } em { font-style: italic; }
    code { font-family: 'Courier New',monospace; font-size: 9pt; background: #f1f5f9; padding: 0 2pt; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 8pt 0; }
    ul, ol { margin: 3pt 0; padding-left: 15pt; } li { margin: 1.5pt 0; }
    .notes-wrap { margin-top: 12pt; background: #f0f9ff; padding: 8pt 10pt; border-left: 3px solid #0ea5e9; }
  </style>
</head>
<body>
  <div class="doc-header">
    <div class="brand-line">REFOCUS &middot; Штаб франшизы</div>
    <div class="doc-title">${mdEsc(section.title)}</div>
    <div class="doc-date">${today} &middot; ${section.items.length} пунктов</div>
  </div>
  ${itemBlocks.join('\n')}
</body>
</html>`;

    const blob  = new Blob(['\ufeff', html], { type: 'application/vnd.ms-word;charset=utf-8' });
    const dlUrl = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = dlUrl;
    a.download  = `refocus-${section.id}-${section.title.replace(/[^а-яёА-ЯЁa-zA-Z0-9]/g, '-').slice(0, 50)}.doc`;
    a.click();
    URL.revokeObjectURL(dlUrl);
  }

  // ── Derived state ──

  // Returns the "real" readiness for progress bars:
  // If user never set readiness (=0) but content is filled → treat as 100.
  // This handles data that was saved before readiness field existed.
  function effectiveReadiness(id: string, initialStatus: ItemStatus): number {
    const db = getItem(id, initialStatus);
    if (db.readiness > 0) return db.readiness;
    const e = editsRef.current.get(id);
    const content = e ? e.content : (db.content ?? '');
    return content.trim().length > 0 ? 100 : 0;
  }

  function isItemDone(id: string, initialStatus: ItemStatus): boolean {
    return effectiveReadiness(id, initialStatus) === 100;
  }

  const activeSection  = useMemo(() => SECTIONS.find(s => s.id === activeSectionId) ?? SECTIONS[0], [activeSectionId]);
  const totalItems     = SECTIONS.reduce((a, s) => a + s.items.length, 0);
  const doneItems      = useMemo(() => SECTIONS.reduce((a, s) => a + s.items.filter(it => isItemDone(it.id, it.initialStatus)).length, 0), [dbMap, edits]);

  // Average effective readiness 0–100
  const overallReadiness = useMemo(() => {
    const total = SECTIONS.reduce((acc, s) =>
      acc + s.items.reduce((a, it) => a + effectiveReadiness(it.id, it.initialStatus), 0), 0);
    return totalItems > 0 ? Math.round(total / totalItems) : 0;
  }, [dbMap, edits]);

  const overallPct = overallReadiness;

  function sectionPct(s: PlanSection) {
    if (!s.items.length) return 0;
    const total = s.items.reduce((a, it) => a + effectiveReadiness(it.id, it.initialStatus), 0);
    return Math.round(total / s.items.length);
  }



  // ── Render ──
  return (
    <div className="pb-10">

      {/* ── Page header ── */}
      <div className="mb-6 rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 ring-1 ring-sky-200/70 shadow-[0_8px_36px_rgba(15,23,42,0.18)] px-6 py-5">
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <div className="h-12 w-12 rounded-2xl grid place-items-center bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-[0_6px_20px_rgba(34,211,238,0.35)] ring-1 ring-white/25 shrink-0">
            <BarChart3 size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-bold tracking-[0.25em] uppercase text-sky-600 font-kiona">REFOCUS</span>
              <span className="text-slate-300 text-[10px]">◆</span>
              <span className="text-[11px] text-slate-500 uppercase tracking-[0.18em] font-medium">Штаб франшизы</span>
            </div>
            <h1 className="text-[21px] font-bold text-slate-800 leading-tight mt-0.5">
              Центр управления упаковкой франшизы
            </h1>
          </div>
          {/* Counter badge */}
          <div className="text-right shrink-0">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Готовых документов</div>
            <div className="text-[26px] font-bold text-slate-800 leading-tight">
              {doneItems}<span className="text-[14px] text-slate-400 font-normal"> / {totalItems}</span>
            </div>
          </div>
        </div>

        {/* Big progress bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-semibold text-slate-600">
              {
                overallPct === 0   ? 'Франшиза не упакована' :
                overallPct < 25   ? 'Начало работы' :
                overallPct < 50   ? 'На четверть пути' :
                overallPct < 75   ? 'Наполовину пути' :
                overallPct < 100  ? 'Почти готова' :
                'Франшиза полностью упакована ✓'
              }
            </span>
            <span className="text-[22px] font-bold text-sky-600 tabular-nums leading-none">{overallPct}%</span>
          </div>
          <div className="h-4 rounded-full bg-slate-200/80 overflow-hidden shadow-[inset_0_1px_3px_rgba(15,23,42,0.12)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 transition-all duration-700 shadow-[0_0_10px_rgba(34,211,238,0.45)]"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-sky-100">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Для кого</span>
          <AudienceBadges audiences={['hq', 'franchisee', 'candidate']} compact />
        </div>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Left nav ── */}
        <div className="w-56 shrink-0">
          {/* Nav card — всё внутри одной карточки со скроллом */}
          <div className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50 ring-1 ring-sky-200 shadow-[0_8px_36px_rgba(15,23,42,0.15)] overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Разделы</div>
            </div>
            <div className="px-2 pb-3 space-y-0.5 max-h-[calc(100vh-220px)] overflow-y-auto">
              {SECTIONS.map(section => {
                const Icon     = section.icon;
                const pct      = sectionPct(section);
                const isActive = section.id === activeSectionId;
                const done     = section.items.filter(it => isItemDone(it.id, it.initialStatus)).length;

                return (
                  <button
                    key={section.id}
                    onClick={() => switchSection(section.id)}
                    className={cx(
                      'w-full flex flex-col px-3 py-2 rounded-xl text-left transition-all duration-150',
                      isActive
                        ? `bg-gradient-to-r ${GRAD[section.color]} shadow-[0_4px_12px_rgba(0,0,0,0.12)]`
                        : 'hover:bg-slate-100',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        size={14}
                        className={isActive ? 'text-white shrink-0' : 'text-slate-400 shrink-0'}
                      />
                      <span className={cx(
                        'flex-1 text-[12.5px] font-semibold truncate',
                        isActive ? 'text-white' : 'text-slate-700',
                      )}>
                        {section.title}
                      </span>
                      <span className={cx(
                        'text-[11px] font-bold tabular-nums shrink-0',
                        isActive
                          ? 'text-white/90'
                          : pct === 100 ? 'text-emerald-600' : 'text-slate-400',
                      )}>
                        {done}/{section.items.length}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className={cx('mt-1.5 h-1 rounded-full overflow-hidden', isActive ? 'bg-white/30' : 'bg-slate-200')}>
                      <div
                        className={cx('h-full rounded-full transition-all duration-500', isActive ? 'bg-white/80' : `bg-gradient-to-r ${GRAD[section.color]}`)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={28} className="animate-spin text-cyan-400" />
            </div>
          ) : (
            <>
              {/* Section title bar */}
              <div className={cx(
                'mb-4 rounded-3xl p-5 ring-1',
                'bg-gradient-to-br from-white via-slate-50 to-sky-50',
                RING[activeSection.color],
                'shadow-[0_8px_36px_rgba(15,23,42,0.18)]',
              )}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={cx('h-12 w-12 rounded-2xl grid place-items-center shadow-[0_6px_18px_rgba(0,0,0,0.18)]', `bg-gradient-to-br ${GRAD[activeSection.color]}`)}>
                      <activeSection.icon size={24} className="text-white" />
                    </div>
                    <div>
                      <h2 className="text-[20px] font-bold text-slate-800">{activeSection.title}</h2>
                      <p className="text-[13px] text-slate-500 mt-0.5">
                        {activeSection.items.length} пунктов ·{' '}
                        <span className="text-emerald-600 font-semibold">
                          {activeSection.items.filter(it => isItemDone(it.id, it.initialStatus)).length} выполнено
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => downloadSectionWord(activeSection)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[12px] font-semibold bg-sky-50 text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 transition-colors"
                      title="Скачать весь раздел одним Word-документом"
                    >
                      <FileDown size={14}/>
                      Скачать раздел
                    </button>
                    <div className="w-28">
                      <div className="flex justify-between text-[11px] mb-1.5">
                        <span className="text-slate-500">Прогресс</span>
                        <span className={cx('font-bold', `text-${activeSection.color}-600`)}>{sectionPct(activeSection)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={cx('h-full rounded-full bg-gradient-to-r', GRAD[activeSection.color])}
                          style={{ width: `${sectionPct(activeSection)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Item cards */}
              <div className="space-y-2">
                {activeSection.items.map(item => {
                  const db         = getItem(item.id, item.initialStatus);
                  const e          = getEdit(item.id, item.initialStatus);
                  const isDirty    = dirtyRef.current.has(item.id);
                  const isSaving   = savingSet.has(item.id);
                  const isExpanded = expandedItemId === item.id;
                  const readiness  = effectiveReadiness(item.id, item.initialStatus);
                  const audiences  = getItemAudiences(activeSection.id, item.id);
                  const hasContent = !!(e.content || e.notes);

                  // Readiness color
                  const rdColor = readiness === 0 ? 'text-slate-400'
                    : readiness < 50              ? 'text-amber-600'
                    : readiness < 100             ? 'text-sky-600'
                    : 'text-emerald-600';
                  const rdBarColor = readiness === 0 ? 'bg-slate-200'
                    : readiness < 50              ? 'bg-gradient-to-r from-amber-400 to-orange-400'
                    : readiness < 100             ? 'bg-gradient-to-r from-sky-400 to-cyan-400'
                    : 'bg-gradient-to-r from-emerald-400 to-teal-400';

                  return (
                    <div
                      key={item.id}
                      className={cx(
                        'rounded-2xl ring-1 overflow-hidden transition-all duration-200',
                        'shadow-[0_4px_20px_rgba(15,23,42,0.10)]',
                        readiness === 100
                          ? 'bg-gradient-to-br from-emerald-50 via-white to-emerald-50 ring-emerald-200 shadow-[0_4px_20px_rgba(16,185,129,0.10)]'
                          : 'bg-gradient-to-br from-white via-slate-50 to-sky-50 ring-sky-200/60 hover:ring-sky-300/70 hover:shadow-[0_6px_28px_rgba(15,23,42,0.14)]',
                      )}
                    >
                      {/* Card header — весь кликабелен для expand */}
                      <div
                        className="flex items-start gap-3 px-4 py-3.5 cursor-pointer select-none"
                        onClick={() => setExpandedItemId(prev => prev === item.id ? null : item.id)}
                      >
                        <button
                          onClick={ev => { ev.stopPropagation(); void changeReadiness(item.id, item.initialStatus, readiness === 100 ? 0 : 100); }}
                          className="mt-0.5 shrink-0 transition-all hover:scale-110 active:scale-95"
                          title={readiness === 100 ? 'Снять отметку' : 'Отметить готовым'}
                        >
                          {readiness === 100
                            ? <CheckCircle2 size={20} className="text-emerald-500" />
                            : <Circle size={20} className="text-slate-300 hover:text-sky-400 transition-colors" />
                          }
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[11px] font-mono text-slate-400 shrink-0">{item.id}</span>
                            <span className={cx(
                              'text-[14px] font-semibold leading-snug',
                              db.completed ? 'line-through text-slate-400' : 'text-slate-800',
                            )}>
                              {item.title}
                            </span>
                          </div>

                          <p className="mt-0.5 text-[12px] text-slate-500 leading-relaxed">
                            {item.description}
                          </p>

                          <div className="mt-2">
                            <AudienceBadges audiences={audiences} />
                          </div>

                          {!isExpanded && e.content && (
                            <button
                              onClick={() => setExpandedItemId(item.id)}
                              className="mt-1.5 w-full text-left text-[12px] text-slate-600 bg-sky-50 rounded-xl px-3 py-1.5 ring-1 ring-sky-100 line-clamp-2 hover:bg-sky-100/70 transition-colors"
                            >
                              {e.content.slice(0, 200)}{e.content.length > 200 ? '…' : ''}
                            </button>
                          )}

                          {/* Readiness mini bar */}
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className={cx('h-full rounded-full transition-all duration-500', rdBarColor)}
                                style={{ width: `${readiness}%` }}
                              />
                            </div>
                            <span className={cx('text-[11px] font-bold tabular-nums shrink-0', rdColor)}>
                              {readiness}%
                            </span>
                            <span className={cx('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1', priorityBadge(item.priority).bg)}>
                              {priorityBadge(item.priority).label}
                            </span>
                            {hasContent && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 bg-indigo-50 text-indigo-600 ring-indigo-200">
                                <FileText size={10}/> {e.content.length} симв.
                              </span>
                            )}
                            {isDirty && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 bg-amber-50 text-amber-600 ring-amber-200 animate-pulse">
                                Не сохранено
                              </span>
                            )}
                            {isSaving && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 bg-sky-50 text-sky-600 ring-sky-200">
                                <Loader2 size={10} className="animate-spin"/> Сохраняю…
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                          {hasContent && (
                            <button
                              onClick={e => { e.stopPropagation(); downloadWord(item); }}
                              className="p-1.5 rounded-xl hover:bg-sky-100 text-slate-400 hover:text-sky-600 transition-colors"
                              title="Скачать как Word"
                            >
                              <FileDown size={15}/>
                            </button>
                          )}
                          <div className="p-1.5 text-slate-400">
                            {isExpanded ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
                          </div>
                        </div>
                      </div>

                      {/* Expanded editor */}
                      {isExpanded && (
                        <div className="border-t border-sky-100 px-4 pb-4 pt-3 bg-white">
                          <div className="space-y-3">
                            {/* Readiness picker */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">
                                Готовность документа
                              </label>
                              <div className="flex items-stretch gap-2">
                                {([0, 25, 50, 75, 100] as const).map(pct => {
                                  const isSelected = readiness === pct;
                                  const label = pct === 0 ? 'Не начато'
                                    : pct === 25  ? 'Начато'
                                    : pct === 50  ? 'Наполовину'
                                    : pct === 75  ? 'Почти'
                                    : 'Готово ✓';
                                  const selCls = pct === 0    ? 'bg-slate-100 text-slate-600 ring-slate-300'
                                    : pct === 25  ? 'bg-amber-400 text-white ring-amber-500 shadow-[0_3px_10px_rgba(251,191,36,0.4)]'
                                    : pct === 50  ? 'bg-orange-400 text-white ring-orange-500 shadow-[0_3px_10px_rgba(251,146,60,0.4)]'
                                    : pct === 75  ? 'bg-sky-500 text-white ring-sky-600 shadow-[0_3px_10px_rgba(14,165,233,0.4)]'
                                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white ring-emerald-500 shadow-[0_3px_12px_rgba(16,185,129,0.45)]';
                                  return (
                                    <button
                                      key={pct}
                                      onClick={() => void changeReadiness(item.id, item.initialStatus, pct)}
                                      className={cx(
                                        'flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl text-[11px] font-bold ring-1 transition-all',
                                        isSelected
                                          ? selCls + ' scale-[1.04]'
                                          : 'bg-white text-slate-400 ring-slate-200 hover:ring-slate-300 hover:text-slate-600',
                                      )}
                                    >
                                      <span className="text-[13px] font-extrabold">{pct}%</span>
                                      <span className="text-[9px] font-semibold opacity-80 leading-tight text-center">{label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                                  Содержание документа
                                </label>
                                <button
                                  onClick={ev => { ev.stopPropagation(); setModalItem(item); }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-sky-50 text-sky-600 ring-1 ring-sky-200 hover:bg-sky-100 transition-colors"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                                  Открыть полноэкранно
                                </button>
                              </div>
                              <LocalTextarea
                                key={`${item.id}-content`}
                                initialValue={e.content}
                                placeholder="Вставьте текст из Word, Google Docs или напишите сами. Поддерживается любой объём."
                                rows={8}
                                className="w-full text-[13.5px] text-slate-800 leading-relaxed bg-white ring-1 ring-sky-200 focus:ring-sky-400 focus:outline-none rounded-xl px-4 py-3 resize-y placeholder:text-slate-300 transition-all min-h-[120px] shadow-[inset_0_1px_3px_rgba(15,23,42,0.05)]"
                                onCommit={val => commitEdit(item.id, item.initialStatus, 'content', val)}
                              />
                            </div>

                            {/* ── Заметки ── */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-1.5">
                                Заметки
                              </label>
                              <LocalTextarea
                                key={`${item.id}-notes`}
                                initialValue={e.notes}
                                placeholder="Краткие заметки по этому разделу…"
                                rows={3}
                                className="w-full text-[13.5px] text-slate-800 bg-white ring-1 ring-sky-200 focus:ring-sky-400 focus:outline-none rounded-xl px-4 py-3 resize-y placeholder:text-slate-300 transition-all shadow-[inset_0_1px_3px_rgba(15,23,42,0.05)]"
                                onCommit={val => commitEdit(item.id, item.initialStatus, 'notes', val)}
                              />
                            </div>

                            {/* ── Фото ── */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">
                                Фото
                              </label>

                              {(db.images ?? []).length > 0 && (
                                <div className="grid grid-cols-3 gap-2 mb-2">
                                  {(db.images ?? []).map((url, imgIdx) => (
                                    <div key={imgIdx} className="relative group rounded-xl overflow-hidden ring-1 ring-sky-100 aspect-square">
                                      <img
                                        src={url}
                                        alt={`Фото ${imgIdx + 1}`}
                                        className="w-full h-full object-cover"
                                        onClick={() => window.open(url, '_blank')}
                                        style={{ cursor: 'zoom-in' }}
                                      />
                                      <button
                                        onClick={ev => { ev.stopPropagation(); void removeImage(item.id, item.initialStatus, imgIdx); }}
                                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                                        title="Удалить"
                                      >×</button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <label
                                htmlFor={`img-upload-${item.id}`}
                                className={cx(
                                  'flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed cursor-pointer transition-all text-[12px] font-medium',
                                  uploadingSet.has(item.id)
                                    ? 'border-sky-300 bg-sky-50 text-sky-500'
                                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600',
                                )}
                              >
                                {uploadingSet.has(item.id) ? (
                                  <><Loader2 size={13} className="animate-spin"/> Загружаю...</>
                                ) : (
                                  <><Upload size={13}/> Загрузить фото</>
                                )}
                              </label>
                              <input
                                id={`img-upload-${item.id}`}
                                type="file"
                                multiple
                                accept="image/*"
                                className="hidden"
                                onChange={ev => { if (ev.target.files?.length) void uploadImages(item.id, item.initialStatus, ev.target.files); ev.target.value = ''; }}
                              />
                            </div>

                            {/* ── Документы ── */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">
                                Документы
                              </label>

                              {(db.documents ?? []).length > 0 && (
                                <div className="space-y-1.5 mb-2">
                                  {(db.documents ?? []).map((doc, docIdx) => (
                                    <div
                                      key={docIdx}
                                      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 group"
                                    >
                                      <Paperclip size={13} className="text-indigo-400 shrink-0" />
                                      <a
                                        href={doc.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-1 min-w-0 text-[12.5px] text-indigo-700 font-medium truncate hover:underline"
                                        title={doc.name}
                                      >
                                        {doc.name}
                                      </a>
                                      <button
                                        onClick={ev => { ev.stopPropagation(); void removeDocument(item.id, item.initialStatus, docIdx); }}
                                        className="shrink-0 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                                        title="Удалить"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <label
                                htmlFor={`doc-upload-${item.id}`}
                                className={cx(
                                  'flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed cursor-pointer transition-all text-[12px] font-medium',
                                  uploadingDocsSet.has(item.id)
                                    ? 'border-indigo-300 bg-indigo-50 text-indigo-500'
                                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600',
                                )}
                              >
                                {uploadingDocsSet.has(item.id) ? (
                                  <><Loader2 size={13} className="animate-spin"/> Загружаю...</>
                                ) : (
                                  <><Paperclip size={13}/> Загрузить Word / PDF</>
                                )}
                              </label>
                              <input
                                id={`doc-upload-${item.id}`}
                                type="file"
                                multiple
                                accept=".doc,.docx,.pdf,.xlsx,.xls,.pptx,.ppt,.txt"
                                className="hidden"
                                onChange={ev => { if (ev.target.files?.length) void uploadDocuments(item.id, item.initialStatus, ev.target.files); ev.target.value = ''; }}
                              />
                            </div>

                            {/* ── Видео ── */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">
                                Видеоуроки
                              </label>

                              {(db.videos ?? []).length > 0 && (
                                <div className="space-y-2 mb-2">
                                  {(db.videos ?? []).map((vid, vidIdx) => {
                                    const ytId = extractYouTubeId(vid.url);
                                    return (
                                      <div key={vidIdx} className="flex items-center gap-2 p-2 rounded-xl bg-rose-50 ring-1 ring-rose-100 group">
                                        {ytId ? (
                                          <img
                                            src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
                                            className="w-16 h-10 rounded-lg object-cover shrink-0 ring-1 ring-rose-200"
                                            alt=""
                                          />
                                        ) : (
                                          <div className="w-16 h-10 rounded-lg bg-rose-100 shrink-0 flex items-center justify-center">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-rose-400"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                          </div>
                                        )}
                                        <a
                                          href={vid.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex-1 min-w-0 text-[12.5px] text-rose-700 font-medium truncate hover:underline"
                                          title={vid.title || vid.url}
                                        >
                                          {vid.title || vid.url}
                                        </a>
                                        <button
                                          onClick={ev => { ev.stopPropagation(); void removeVideo(item.id, item.initialStatus, vidIdx); }}
                                          className="shrink-0 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                                          title="Удалить"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              <VideoAddForm
                                onAdd={(title, url) => void addVideo(item.id, item.initialStatus, title, url)}
                              />
                            </div>

                            <div className="flex items-center justify-between gap-3 pt-0.5">
                              <button
                                onClick={() => downloadWord(item)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[12px] font-medium bg-sky-50 text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 transition-colors"
                              >
                                <FileDown size={13}/>
                                Скачать Word
                              </button>
                              <button
                                onClick={() => manualSave(item.id, item.initialStatus)}
                                disabled={isSaving}
                                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[12px] font-semibold text-white bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 shadow-[0_4px_16px_rgba(34,211,238,0.30)] hover:brightness-110 active:brightness-95 transition-all disabled:opacity-50"
                              >
                                {isSaving
                                  ? <><Loader2 size={13} className="animate-spin"/> Сохраняю…</>
                                  : <><Save size={13}/> Сохранить</>
                                }
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Content Modal ── */}
      {modalItem && (
        <ContentModal
          item={modalItem}
          initialContent={getEdit(modalItem.id, modalItem.initialStatus).content}
          isSaving={savingSet.has(modalItem.id)}
          onClose={() => setModalItem(null)}
          onCommit={(val) => {
            commitEdit(modalItem.id, modalItem.initialStatus, 'content', val);
          }}
          onSave={() => manualSave(modalItem.id, modalItem.initialStatus)}
        />
      )}
    </div>
  );
}
