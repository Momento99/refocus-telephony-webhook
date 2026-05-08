'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import {
  BookOpen, TrendingUp, Gavel, ClipboardList, GraduationCap,
  Megaphone, UserSearch, Rocket, Shield, FolderOpen,
  CheckCircle2, Circle, ChevronDown, ChevronUp, FileDown,
  Save, BarChart3, Loader2, FileText, Clock, AlertCircle, Minus,
  Paperclip, Trash2, Upload, Building2, Store, FileSignature,
  Camera, Play, Maximize2, UserRound,
} from 'lucide-react';
import { parseMarkdownToHtml as sharedParseMarkdown, stripTrainerSections } from '@/lib/franchiseMarkdown';

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
  isSignable?: boolean; // правовой документ, подписывается с франчайзи
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
      { id: '1.1', title: 'Паспорт франшизы Refocus', description: 'Единый внутренний документ франшизы: суть, позиционирование, формат точки, команда, стандарты обслуживания, ассортимент, экономика, портрет франчайзи.', initialStatus: 'Есть', priority: 'critical' },
      { id: '1.4', title: 'Подходит ли вам франшиза Refocus', description: 'Документ для кандидата. Самопроверка из 8 вопросов: подходит ли модель Refocus, что вы получите взамен, с кем у нас не получится. Без воды, формат «прочитайте — оставьте заявку или сэкономим время друг другу».', initialStatus: 'Есть', priority: 'high' },
      { id: '1.5', title: 'Формат точки', description: 'Полноценная оптика (не островок), 30–50 м², эталон Токмок, какие зоны обязательны.', initialStatus: 'Есть', priority: 'high' },
    ],
  },
  {
    id: 'economics', title: 'Экономика', icon: TrendingUp, color: 'emerald',
    items: [
      { id: '2.1', title: 'Полная финмодель (штаб)', description: 'Внутренний документ HQ: всё включая закупочные цены, маржу HQ, доход HQ с точки, HQ OPEX, безубыточность штаба. Не для показа франчайзи.', initialStatus: 'Есть', priority: 'critical' },
      { id: '2.2', title: 'Финмодель для франчайзи', description: 'Документ для действующего и потенциального франчайзи: вход, CAPEX, стартовая загрузка, OPEX, прибыль, окупаемость, роялти, что включено. Без закупочных цен HQ.', initialStatus: 'Есть', priority: 'critical' },
      { id: '2.5', title: 'Сезонная модель по месяцам', description: 'Как просаживаются и растут продажи по месяцам, таблица сезонности.', initialStatus: 'Частично', priority: 'high' },
    ],
  },
  {
    id: 'package', title: 'Пакет франчайзи', icon: Gavel, color: 'violet',
    items: [
      { id: '3.1', title: 'Основной договор франшизы', description: 'Рамочный договор: преамбула, термины, предмет, срок, общие принципы, прекращение, реквизиты, подписи. Конкретика — в приложениях 3.2–3.6 и страновых 3.7.', initialStatus: 'Нет', priority: 'critical', isSignable: true },
      { id: '3.2', title: 'Приложение №1. Стандарты бренда', description: 'Полный перечень обязательных стандартов: бренд-элементы, цифровая инфраструктура, ассортимент, поставщики, обновления стандартов. Отсылки к гайдам 4.x.', initialStatus: 'Частично', priority: 'critical', isSignable: true },
      { id: '3.3', title: 'Приложение №2. Финансовые условия', description: 'Паушальный, роялти, маркетинговый сбор, валюта, индексация, налоги, сроки оплаты, порядок изменения сумм.', initialStatus: 'Нет', priority: 'critical', isSignable: true },
      { id: '3.4', title: 'Приложение №3. Территориальная логика', description: 'Адрес точки, локальная зона, отсутствие эксклюзива на город, право Франчайзера развивать сеть, первое предложение на 2-ю точку.', initialStatus: 'Частично', priority: 'high', isSignable: true },
      { id: '3.5', title: 'Приложение №4. Лестница санкций и нарушений', description: 'Классификация, стадии реагирования, штрафные тарифы, документирование, обжалование, восстановление.', initialStatus: 'Частично', priority: 'critical', isSignable: true },
      { id: '3.6', title: 'Приложение №5. NDA / Конфиденциальность', description: 'Конф. информация, обязательства Франчайзи и его персонала, срок 10 лет, штрафы, исключения.', initialStatus: 'Нет', priority: 'high', isSignable: true },
      { id: '3.7', title: 'Приложение №6. Страновые особенности (РФ, KZ, UZ, KG)', description: 'По блоку на каждую страну: подписант со стороны HQ, регистрация ТЗ, регистрация коммерческой концессии (РФ — Роспатент), валюта, язык, применимое право, подсудность.', initialStatus: 'Нет', priority: 'critical', isSignable: true },
      { id: '3.8', title: 'Приложение №7. Личное поручительство владельца(ев) Франчайзи', description: 'Физическое лицо — владелец/бенефициар Франчайзи — лично отвечает за исполнение Договора. Применяется, если Франчайзи — юр. лицо или ИП с совладельцами.', initialStatus: 'Нет', priority: 'critical', isSignable: true },
      { id: '3.9', title: 'Приложение №8. Лицензионный договор на ПО Refocus', description: 'CRM, POS, мобильное приложение, сенсорный экран, аналитика, сайт. SLA, обновления, отключение доступа, ответственность за простой.', initialStatus: 'Нет', priority: 'critical', isSignable: true },
      { id: '3.10', title: 'Приложение №9. Соглашение об обработке персональных данных (DPA)', description: 'Защита данных клиентов сети по 152-ФЗ (РФ) и аналогам в KZ/UZ/KG. Распределение ролей, безопасность, уведомления о нарушениях, права субъектов.', initialStatus: 'Нет', priority: 'critical', isSignable: true },
      { id: '3.11', title: 'Приложение №10. Требования к страхованию', description: 'Минимальные виды и суммы страхования: профессиональная (медицинская) ответственность, имущество, товары, общая гражданская ответственность. Refocus как Дополнительный застрахованный.', initialStatus: 'Нет', priority: 'critical', isSignable: true },
      { id: '3.12', title: 'Приложение №11. Расписка о получении Операционного руководства', description: 'Подтверждение получения Операционного руководства Refocus и обязательство соблюдать его и все его обновления. Подписывается одновременно с Договором.', initialStatus: 'Нет', priority: 'high', isSignable: true },
      { id: '4.2', title: 'Гайд по оформлению точки', description: 'Полный стандарт интерьера и фасада: материалы, размеры, мебель, свет, наружная вывеска, входная группа, фасад здания. Эталон — Токмок.', initialStatus: 'Есть', priority: 'critical' },
    ],
  },
  {
    id: 'standards', title: 'Стандарты', icon: ClipboardList, color: 'orange',
    items: [
      { id: '6.1', title: 'Операционный manual точки', description: 'Единая книга повседневной работы точки: открытие/закрытие дня, чистота, выкладка оправ, цены/скидки, возвраты и спорные ситуации.', initialStatus: 'Нет', priority: 'critical' },
      { id: '6.2', title: 'Стандарт контроля качества сервиса', description: 'Как HQ контролирует точку: AI-прослушка, аудит, матрица нарушений, KPI, корректировка персонала.', initialStatus: 'Частично', priority: 'critical' },
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
      { id: '7.6.1', title: 'Аттестация продавца', description: 'Устный экзамен 60 минут: 30 вопросов из банка 60, практический кейс, лист оценки, сертификат на 1 год, ежегодная ре-сертификация.', initialStatus: 'Нет', priority: 'high' },
      { id: '7.6.2', title: 'Аттестация диагноста', description: 'Устный экзамен 60 минут: 30 вопросов из банка 60, практический кейс, лист оценки, сертификат на 1 год, ежегодная ре-сертификация.', initialStatus: 'Нет', priority: 'high' },
      { id: '7.7', title: 'Видео-уроки', description: 'Обучающие видео по всем направлениям.', initialStatus: 'Нет', priority: 'later' },
      { id: '7.8', title: 'База знаний', description: 'Централизованная база знаний франшизы.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.1', title: 'Портреты должностей', description: 'Продавец, мастер, управляющий — описания должностей.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.2', title: 'Шаблоны вакансий', description: 'Готовые шаблоны объявлений для найма.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.3', title: 'Анкета кандидата (сотрудник)', description: 'Анкета для соискателей на позиции в точке.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.4', title: 'Скрипт собеседования', description: 'Готовый скрипт для проведения собеседований.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.5', title: 'Чек-лист отбора сотрудника', description: 'Критерии выбора кандидата на должность.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.6', title: 'Стажировочная программа', description: 'Программа стажировки нового сотрудника.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.7', title: 'План первых 30 дней сотрудника', description: 'Структурированный план адаптации нового сотрудника.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.8', title: 'Трудовой договор продавца', description: 'Типовой трудовой договор продавца-консультанта по Трудовому кодексу КР: испытательный срок, режим, оплата, материальная ответственность, конфиденциальность, расторжение.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.9', title: 'Трудовой договор мастера', description: 'Типовой трудовой договор мастера-оптика по ТК КР: материальная ответственность за оправы и линзы, обязанности по сборке очков, дисциплинарные нормы.', initialStatus: 'Нет', priority: 'high' },
      { id: '8.10', title: 'Договор ГПХ с промоутером', description: 'Гражданско-правовой договор (возмездное оказание услуг) с промоутером по ГК КР: оплата за результат, без режима рабочего времени, признаки, которые избегаем во избежание переквалификации в трудовые отношения.', initialStatus: 'Нет', priority: 'high' },
      { id: '14.1', title: 'Гайд: POS — кассовая программа', description: 'Полный гайд по работе в POS со скриншотами и аннотациями: вход, новый заказ, оплата, склад линз, расходники, переписки.', initialStatus: 'Есть', priority: 'critical' },
      { id: '14.2', title: 'Гайд: Touch-screen kiosk — подбор линз', description: 'Гайд по сенсорному экрану для клиента: типы линз, видео, оценки.', initialStatus: 'Нет', priority: 'high' },
      { id: '14.3', title: 'Гайд: Мобильное приложение клиента', description: 'Гайд по приложению Refocus для клиентов: регистрация, заказы, гарантии, бонусы.', initialStatus: 'Нет', priority: 'high' },
      { id: '14.4', title: 'Гайд: Портал для управляющего', description: 'Гайд по порталу франшизы (refocus-franchise-portal): дашборд, заказы, клиенты, зарплата, расходники, дефицит линз, сообщения от HQ, роялти.', initialStatus: 'Нет', priority: 'high' },
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

// Тональная палитра по секции: пастельный фон под иконку + цвет иконки + цвет прогресс-полоски.
// Используется в плитках секций — даёт визуальное разделение без «пестроты».
const SECTION_TONE: Record<string, { iconBg: string; iconText: string; bar: string }> = {
  sky:     { iconBg: 'bg-sky-50',     iconText: 'text-sky-600',     bar: 'bg-sky-500' },
  emerald: { iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', bar: 'bg-emerald-500' },
  violet:  { iconBg: 'bg-violet-50',  iconText: 'text-violet-600',  bar: 'bg-violet-500' },
  orange:  { iconBg: 'bg-orange-50',  iconText: 'text-orange-600',  bar: 'bg-orange-500' },
  cyan:    { iconBg: 'bg-cyan-50',    iconText: 'text-cyan-600',    bar: 'bg-cyan-500' },
  pink:    { iconBg: 'bg-pink-50',    iconText: 'text-pink-600',    bar: 'bg-pink-500' },
  amber:   { iconBg: 'bg-amber-50',   iconText: 'text-amber-600',   bar: 'bg-amber-500' },
  indigo:  { iconBg: 'bg-indigo-50',  iconText: 'text-indigo-600',  bar: 'bg-indigo-500' },
  red:     { iconBg: 'bg-rose-50',    iconText: 'text-rose-600',    bar: 'bg-rose-500' },
  yellow:  { iconBg: 'bg-yellow-50',  iconText: 'text-yellow-700',  bar: 'bg-yellow-500' },
};
const TONE_FALLBACK = SECTION_TONE.cyan;

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
  '2.2': ['hq', 'franchisee', 'candidate'],
  '2.3': ['hq', 'franchisee', 'candidate'],
  '2.5': ['hq', 'franchisee', 'candidate'],
  '3.1': ['hq', 'franchisee'],
  '3.2': ['hq', 'franchisee'],
  '3.3': ['hq', 'franchisee'],
  '3.4': ['hq', 'franchisee'],
  '3.5': ['hq', 'franchisee'],
  '3.6': ['hq', 'franchisee'],
  '3.7': ['hq', 'franchisee'],
  '3.8': ['hq', 'franchisee'],
  '3.9': ['hq', 'franchisee'],
  '3.10': ['hq', 'franchisee'],
  '3.11': ['hq', 'franchisee'],
  '3.12': ['hq', 'franchisee'],
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

const AUDIENCE_PILL: Record<Audience, { cls: string; iconCls: string }> = {
  hq:         { cls: 'bg-slate-100 text-slate-700 ring-slate-200',   iconCls: 'text-slate-500' },
  franchisee: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', iconCls: 'text-emerald-500' },
  candidate:  { cls: 'bg-amber-50 text-amber-700 ring-amber-200',     iconCls: 'text-amber-500' },
};

function AudienceBadges({
  audiences,
}: {
  audiences: Audience[];
  compact?: boolean;
}) {
  // Цветные мини-pills с иконкой и полным названием. Только активные.
  // Каждая аудитория — собственный семантический цвет, чтобы разделение было видно сразу.
  return (
    <div className="flex flex-wrap items-center gap-1">
      {audiences.map((aud) => {
        const meta = AUDIENCE_META[aud];
        const Icon = meta.icon;
        const palette = AUDIENCE_PILL[aud];
        return (
          <span
            key={aud}
            className={cx(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1',
              palette.cls,
            )}
          >
            <Icon size={10} className={palette.iconCls} />
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
    critical: { dot: 'bg-rose-500',   label: 'Обязательно' },
    high:     { dot: 'bg-cyan-500',   label: 'Сделать' },
    later:    { dot: 'bg-slate-400',  label: 'Позже' },
    skip:     { dot: 'bg-slate-300',  label: 'Пропустить' },
  };
  return map[p];
}

// ─── Markdown parser (shared with PDF API) ─────────────────────────────────────

// Re-export from lib so we have a single source of truth shared with the PDF API.
const parseMarkdownToHtml = sharedParseMarkdown;

// ─── Two-audience training programs ───────────────────────────────────────────
// Items below render two PDFs: full (for the trainer/owner) and a trimmed
// version for the trainee, with sections wrapped in <!-- TRAINER:START/END -->
// markers cut out. Whitelist intentionally narrow.
const TWO_AUDIENCE_ITEMS: Record<string, { traineeRole: string }> = {
  '7.1': { traineeRole: 'владельца' },
  '7.2': { traineeRole: 'управляющего' },
  '7.3': { traineeRole: 'продавца' },
  '7.4': { traineeRole: 'специалиста' },
  '7.6.1': { traineeRole: 'продавца' },
  '7.6.2': { traineeRole: 'специалиста' },
};

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
  const traineeRole           = TWO_AUDIENCE_ITEMS[item.id]?.traineeRole;
  const [audience, setAudience] = React.useState<'full' | 'trainee'>('full');
  const textareaRef           = React.useRef<HTMLTextAreaElement>(null);

  const trainerInfo = React.useMemo(() => stripTrainerSections(text), [text]);
  const showAudienceSwitch = !!traineeRole && trainerInfo.hasMarkers;

  // Render markdown for the chosen audience. For the trainee view, replace each
  // trainer-only block with a sentinel paragraph that we then turn into a dashed
  // cyan strip, so the user can see *where* content was cut.
  const renderedHtml = React.useMemo(() => {
    if (audience === 'full') return parseMarkdownToHtml(text);
    const withSentinels = text.replace(
      /<!--\s*TRAINER:START\s*-->[\s\S]*?<!--\s*TRAINER:END\s*-->/gi,
      '\n\n[[TRAINER_CUT]]\n\n',
    );
    return parseMarkdownToHtml(withSentinels).replace(
      /<p>\[\[TRAINER_CUT\]\]<\/p>/g,
      '<div class="trainer-cut-strip">Здесь вырезан тренерский блок</div>',
    );
  }, [text, audience]);

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

        {/* Audience toggle — only for items with two-audience workflow and only in preview mode */}
        {showAudienceSwitch && mode === 'preview' && (
          <div className="shrink-0 flex items-center bg-white/8 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setAudience('full')}
              className={cx(
                'px-3 py-1 rounded-md text-[12px] font-medium transition-all',
                audience === 'full' ? 'bg-white text-slate-800 shadow-sm' : 'text-white/50 hover:text-white/80',
              )}
              title="Что видит тренер/владелец"
            >Полный</button>
            <button
              onClick={() => setAudience('trainee')}
              className={cx(
                'px-3 py-1 rounded-md text-[12px] font-medium transition-all',
                audience === 'trainee' ? 'bg-white text-slate-800 shadow-sm' : 'text-white/50 hover:text-white/80',
              )}
              title={`Что видит ${traineeRole}`}
            >Для {traineeRole}</button>
          </div>
        )}

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
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 cursor-zoom-out"
        // Клик в области по бокам от документа закрывает модалку.
        // Клик внутри document paper не дойдёт сюда (e.stopPropagation на нём).
        onMouseDown={e => { if (e.target === e.currentTarget) { onCommit(text); onClose(); } }}
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.10) transparent' }}
      >
        <div
          className="mx-auto bg-white rounded-xl overflow-hidden cursor-default"
          onMouseDown={e => e.stopPropagation()}
          style={{
            maxWidth: '800px',
            minHeight: 'calc(100vh - 100px)',
            boxShadow: '0 28px_90px rgba(0,0,0,0.60), 0 4px 20px rgba(0,0,0,0.35)',
          }}
        >
          {/* Document title block */}
          <div className="px-14 pt-10 pb-6 border-b border-slate-100">
            <div
              className="font-kiona text-slate-900 leading-none mb-2"
              style={{ fontSize: '52px', letterSpacing: '0.01em' }}
            >
              refocus
            </div>
            <div
              className="rounded-full mb-4"
              style={{
                height: '4px',
                width: '240px',
                background: 'linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%)',
              }}
            />
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <div className="text-[10px] font-bold text-sky-700 uppercase tracking-[0.22em]">
                Штаб франшизы · {item.id}
              </div>
              {item.isSignable && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 bg-violet-50 text-violet-700 ring-violet-200">
                  <FileSignature size={10}/> Документ к подписи
                </span>
              )}
            </div>
            <h1 className="text-[22px] font-bold text-slate-900 leading-snug" style={{ fontFamily: 'Georgia, serif' }}>
              {item.title}
            </h1>
            <p className="mt-1.5 text-[12.5px] text-slate-500 leading-relaxed">{item.description}</p>
          </div>

          {/* Content area */}
          <div className="px-14 py-8">
            {trainerInfo.unbalanced && (
              <div className="mb-5 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-[12.5px] text-amber-800">
                <div className="font-semibold mb-0.5">Несбалансированные маркеры тренера</div>
                <div className="text-amber-700">
                  В тексте есть незакрытый блок <code className="font-mono text-[11px]">&lt;!-- TRAINER:START --&gt;</code> или одинокий <code className="font-mono text-[11px]">&lt;!-- TRAINER:END --&gt;</code>.
                  Версия для обучаемого может вырезать не то, что ты ожидаешь.
                </div>
              </div>
            )}
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
        .doc-content h5 { font-size: 13px; font-weight: 700; color: #0369a1; margin: 12px 0 3px; }
        .doc-content h6 { font-size: 12px; font-weight: 600; color: #64748b; margin: 10px 0 3px; text-transform: uppercase; letter-spacing: 0.04em; }
        .doc-content p  { margin: 0 0 10px; }
        .doc-content ul { margin: 6px 0 10px 20px; list-style: disc; }
        .doc-content ol { margin: 6px 0 10px 20px; list-style: decimal; }
        .doc-content li { margin: 3px 0; }
        .doc-content hr { border: none; border-top: 1px solid #cbd5e1; margin: 20px 0; }
        .doc-content strong { font-weight: 700; color: #0f172a; }
        .doc-content em { font-style: italic; color: #334155; }
        .doc-content code { font-family: "Consolas", monospace; font-size: 12.5px; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; color: #0369a1; }
        .doc-content .md-sp { height: 8px; }
        .doc-content table.md-table {
          width: 100%;
          border-collapse: collapse;
          margin: 14px 0 20px;
          font-size: 13px;
          line-height: 1.5;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 0 0 1px #e2e8f0;
          background: #ffffff;
        }
        .doc-content table.md-table thead tr { background: #f0f9ff; }
        .doc-content table.md-table th {
          padding: 10px 13px;
          font-weight: 700;
          color: #0c4a6e;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 2px solid #bae6fd;
          text-align: left;
          white-space: nowrap;
        }
        .doc-content table.md-table td {
          padding: 9px 13px;
          color: #1e293b;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: top;
        }
        .doc-content table.md-table tbody tr:last-child td { border-bottom: none; }
        .doc-content table.md-table tbody tr:nth-child(even) td { background: #f8fafc; }
        .doc-content table.md-table tbody tr:hover td { background: #f0f9ff; }
        .doc-content blockquote {
          margin: 14px 0;
          padding: 10px 16px;
          border-left: 3px solid #0ea5e9;
          background: #f0f9ff;
          color: #0c4a6e;
          border-radius: 0 6px 6px 0;
          font-size: 13.5px;
        }
        .doc-content blockquote p { margin: 0; }
        .doc-content .md-figure {
          display: block;
          margin: 16px 0;
          padding: 0;
          text-align: center;
        }
        .doc-content .md-figure img {
          max-width: 100%;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          margin: 0;
        }
        .doc-content .trainer-cut-strip {
          margin: 14px 0;
          padding: 7px 14px;
          border: 1px dashed #67e8f9;
          background: rgba(207, 250, 254, 0.40);
          color: #0e7490;
          border-radius: 8px;
          font-size: 11.5px;
          font-style: italic;
          text-align: center;
          letter-spacing: 0.02em;
        }
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
  // Раскрытая категория вложений в expanded карточке: itemId → 'photos' | 'files' | 'videos'.
  const [attachOpen,    setAttachOpen]    = useState<Map<string, 'photos' | 'files' | 'videos'>>(new Map());

  function toggleAttach(itemId: string, kind: 'photos' | 'files' | 'videos') {
    setAttachOpen(prev => {
      const next = new Map(prev);
      if (next.get(itemId) === kind) next.delete(itemId);
      else next.set(itemId, kind);
      return next;
    });
  }

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
    const db = getItem(id, initialStatus);
    const dbValue = field === 'notes' ? db.notes : db.content;
    // No-op: value unchanged from DB and no prior dirty edits → don't write back.
    // Prevents the modal from overwriting external/concurrent updates whenever
    // it's closed without actual editing.
    if (value === dbValue && !editsRef.current.has(id)) return;

    const curr = editsRef.current.get(id) ?? { notes: db.notes, content: db.content };
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

  // ── PDF download (server-rendered via Puppeteer) ──
  // Key: itemId for full version, itemId + ':trainee' for the trainee version,
  // so the two buttons spin independently.
  const [pdfDownloadingSet, setPdfDownloadingSet] = useState<Set<string>>(new Set());

  async function downloadPdf(item: PlanItem, audience: 'full' | 'trainee' = 'full') {
    const key = audience === 'trainee' ? `${item.id}:trainee` : item.id;
    if (pdfDownloadingSet.has(key)) return;
    const e = getEdit(item.id, item.initialStatus);
    if (!e.content?.trim()) {
      toast.error('Нет содержимого для экспорта');
      return;
    }

    const isTrainee = audience === 'trainee';
    const traineeRole = TWO_AUDIENCE_ITEMS[item.id]?.traineeRole;
    const audienceLabel = isTrainee && traineeRole ? `Версия для ${traineeRole}` : undefined;
    const fileSuffix = isTrainee ? '-trainee' : '';

    setPdfDownloadingSet(prev => new Set(prev).add(key));
    const t = toast.loading(isTrainee ? 'Генерирую PDF (для обучаемого)…' : 'Генерирую PDF…');
    try {
      const res = await fetch('/api/franchise-hq/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          title: item.title,
          description: item.description,
          content: e.content,
          notes: e.notes,
          audience,
          audienceLabel,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка сервера' }));
        throw new Error(err.error || 'Ошибка генерации PDF');
      }
      const blob = await res.blob();
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = `refocus-${item.id}${fileSuffix}-${item.title.replace(/[^а-яёА-ЯЁa-zA-Z0-9]/g, '-').slice(0, 50)}.pdf`;
      a.click();
      URL.revokeObjectURL(dlUrl);
      toast.dismiss(t);
      toast.success('PDF готов');
    } catch (err) {
      toast.dismiss(t);
      const msg = err instanceof Error ? err.message : 'Не удалось создать PDF';
      toast.error(msg);
      console.error('[downloadPdf]', err);
    } finally {
      setPdfDownloadingSet(prev => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    }
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

      {/* ── Page header (CLAUDE.md spec) ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Gavel className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">
              Штаб франшизы
            </div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Упаковка франшизы Refocus
            </div>
          </div>
        </div>
      </div>

      {/* ── Hero progress block — общая готовность франшизы ── */}
      <div className="mb-6 relative overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_12px_40px_rgba(15,23,42,0.18)] px-6 py-5">
        {/* Декоративные cyan-glow пятна — теперь на светлом, мягкие */}
        <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-cyan-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-44 w-44 rounded-full bg-emerald-200/30 blur-3xl" />

        <div className="relative flex flex-wrap items-end justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-700 mb-2">
              Готовность к упаковке
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-[44px] font-bold leading-none tracking-tight text-slate-900 tabular-nums">
                {overallPct}<span className="text-[28px] text-cyan-500 ml-0.5">%</span>
              </span>
              <span className="text-[13px] text-slate-500">
                <span className="text-slate-900 font-semibold tabular-nums">{doneItems}</span>
                <span className="mx-1">из</span>
                <span className="tabular-nums">{totalItems}</span>
                <span className="ml-1">пунктов готовы</span>
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 mb-1">
              Статус
            </div>
            <div className={cx(
              'text-[14px] font-semibold',
              overallPct === 100 ? 'text-emerald-600' :
              overallPct >= 75    ? 'text-cyan-700' :
              overallPct >= 50    ? 'text-cyan-600' :
              overallPct >= 25    ? 'text-amber-600' :
              overallPct > 0      ? 'text-slate-600' :
              'text-slate-400',
            )}>
              {overallPct === 100 ? 'Полностью упакована ✓' :
               overallPct >= 75    ? 'Финальная стадия' :
               overallPct >= 50    ? 'Зрелость' :
               overallPct >= 25    ? 'Развитие' :
               overallPct > 0      ? 'Старт' :
               'Не начато'}
            </div>
          </div>
        </div>

        <div className="relative">
          {/* Полоска прогресса */}
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden shadow-[inset_0_2px_4px_rgba(15,23,42,0.10)]">
            <div
              className={cx(
                'h-full rounded-full transition-all duration-700',
                overallPct === 100
                  ? 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.55)]'
                  : 'bg-gradient-to-r from-cyan-400 via-cyan-500 to-emerald-400 shadow-[0_0_18px_rgba(34,211,238,0.55)]',
              )}
              style={{ width: `${overallPct}%` }}
            />
          </div>
          {/* Метки шкалы */}
          <div className="mt-2 flex justify-between text-[10px] font-medium tabular-nums text-slate-400">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      {/* ── Section tiles grid (5 в ряд × 2 строки = 10 секций) ── */}
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {SECTIONS.map(section => {
          const Icon       = section.icon;
          const isActive   = section.id === activeSectionId;
          const done       = section.items.filter(it => isItemDone(it.id, it.initialStatus)).length;
          const isComplete = done === section.items.length && section.items.length > 0;
          const pct        = sectionPct(section);
          const tone       = SECTION_TONE[section.color] ?? TONE_FALLBACK;
          return (
            <button
              key={section.id}
              onClick={() => switchSection(section.id)}
              className={cx(
                'group relative flex flex-col items-start gap-3 rounded-2xl px-4 pt-4 pb-5 text-left transition-all overflow-hidden',
                isActive
                  ? 'bg-gradient-to-br from-cyan-500 to-cyan-600 ring-1 ring-cyan-700/40 shadow-[0_16px_44px_rgba(8,145,178,0.45)] -translate-y-0.5'
                  : 'bg-white ring-1 ring-sky-100 hover:ring-sky-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.18)] hover:-translate-y-0.5',
              )}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <div className={cx(
                  'grid h-12 w-12 place-items-center rounded-xl transition-transform group-hover:scale-105',
                  isActive
                    ? 'bg-white text-cyan-600 shadow-[0_6px_16px_rgba(0,0,0,0.18)]'
                    : tone.iconBg + ' shadow-sm',
                )}>
                  <Icon size={22} className={isActive ? 'text-cyan-600' : tone.iconText} />
                </div>
                <span className={cx(
                  'inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums shrink-0',
                  isActive
                    ? 'bg-white/25 text-white ring-1 ring-white/30 backdrop-blur-sm'
                    : isComplete
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-slate-100 text-slate-600',
                )}>
                  {done}/{section.items.length}
                </span>
              </div>
              <span className={cx(
                'text-[13.5px] font-semibold leading-tight tracking-tight line-clamp-2 min-h-[36px]',
                isActive ? 'text-white' : 'text-slate-900',
              )}>
                {section.title}
              </span>

              {/* Прогресс: процент + полоска внизу плитки */}
              <div className="absolute left-0 right-0 bottom-0 px-3 pb-1.5">
                <div className="flex items-center justify-between mb-1">
                  <span className={cx(
                    'text-[10px] font-bold tabular-nums tracking-wide',
                    isActive
                      ? 'text-white/85'
                      : isComplete
                        ? 'text-emerald-600'
                        : pct > 0
                          ? 'text-cyan-600'
                          : 'text-slate-400',
                  )}>
                    {pct}%
                  </span>
                  {isComplete && !isActive && (
                    <CheckCircle2 size={11} className="text-emerald-500" />
                  )}
                </div>
                <div className={cx(
                  'h-1.5 rounded-full overflow-hidden',
                  isActive ? 'bg-white/20' : 'bg-slate-100',
                )}>
                  <div
                    className={cx(
                      'h-full rounded-full transition-all duration-500',
                      isActive
                        ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.65)]'
                        : isComplete
                          ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                          : `bg-gradient-to-r ${pct > 0 ? 'from-cyan-400 to-cyan-500' : ''}`,
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Main content ── */}
      <div>
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={28} className="animate-spin text-cyan-400" />
          </div>
        ) : (
          <>

              {/* Item cards */}
              <div className="space-y-2.5">
                {activeSection.items.map(item => {
                  const db         = getItem(item.id, item.initialStatus);
                  const e          = getEdit(item.id, item.initialStatus);
                  const isDirty    = dirtyRef.current.has(item.id);
                  const isSaving   = savingSet.has(item.id);
                  const isExpanded = expandedItemId === item.id;
                  const readiness  = effectiveReadiness(item.id, item.initialStatus);
                  const audiences  = getItemAudiences(activeSection.id, item.id);
                  const hasContent = !!(e.content || e.notes);

                  // Цвет акцент-полоски слева: emerald=done, cyan=в работе, slate=не начато
                  const accentColor = readiness === 100 ? 'bg-emerald-500'
                    : readiness > 0   ? 'bg-cyan-500'
                    : 'bg-slate-200';

                  return (
                    <div
                      key={item.id}
                      className={cx(
                        'group relative rounded-2xl bg-white ring-1 overflow-hidden transition-all',
                        readiness === 100
                          ? 'ring-emerald-200/70 shadow-[0_4px_20px_rgba(16,185,129,0.10)]'
                          : 'ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.12)] hover:ring-sky-200 hover:shadow-[0_10px_36px_rgba(15,23,42,0.16)]',
                      )}
                    >
                      {/* Цветная акцент-полоска слева */}
                      <div className={cx('absolute left-0 top-0 bottom-0 w-[3px] transition-colors', accentColor)} />

                      {/* Card header — весь кликабелен для expand */}
                      <div
                        className="flex items-start gap-3 pl-5 pr-4 py-3.5 cursor-pointer select-none"
                        onClick={() => setExpandedItemId(prev => prev === item.id ? null : item.id)}
                      >
                        <button
                          onClick={ev => { ev.stopPropagation(); void changeReadiness(item.id, item.initialStatus, readiness === 100 ? 0 : 100); }}
                          className="mt-0.5 shrink-0 transition-transform hover:scale-110 active:scale-95"
                          title={readiness === 100 ? 'Снять отметку' : 'Отметить готовым'}
                        >
                          {readiness === 100
                            ? <CheckCircle2 size={22} className="text-emerald-500" />
                            : <Circle size={22} className="text-slate-300 hover:text-cyan-500 transition-colors" />
                          }
                        </button>

                        <div className="flex-1 min-w-0">
                          {/* Title row */}
                          <div className="flex items-center gap-2.5">
                            <span className="inline-flex items-center justify-center min-w-[40px] h-6 px-1.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-bold font-mono tabular-nums shrink-0">
                              {item.id}
                            </span>
                            <span className="text-[16px] font-semibold leading-snug tracking-tight text-slate-900 min-w-0">
                              {item.title}
                            </span>
                            {(isDirty || isSaving) && (
                              <span
                                title={isSaving ? 'Сохраняю…' : 'Не сохранено'}
                                className={cx(
                                  'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                                  isSaving ? 'bg-cyan-500 animate-pulse' : 'bg-amber-500',
                                )}
                              />
                            )}
                            <span className={cx(
                              'ml-auto inline-flex items-center justify-center min-w-[48px] px-2 py-1 rounded-md text-[12px] font-bold tabular-nums shrink-0 ring-1',
                              readiness === 100
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                : readiness > 0
                                  ? 'bg-cyan-50 text-cyan-700 ring-cyan-200'
                                  : 'bg-slate-50 text-slate-400 ring-slate-200',
                            )}>
                              {readiness}%
                            </span>
                          </div>

                          {/* Meta row: audience + signable */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <AudienceBadges audiences={audiences} />
                            {item.isSignable && (
                              <span
                                className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200"
                                title="Юридический документ — подписывается с франчайзи"
                              >
                                <FileSignature size={10}/> К подписи
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                          {hasContent && (() => {
                            const traineeRole = TWO_AUDIENCE_ITEMS[item.id]?.traineeRole;
                            const showTraineeBtn =
                              !!traineeRole && /<!--\s*TRAINER:START\s*-->/i.test(e.content);
                            return (
                              <>
                                <button
                                  onClick={ev => { ev.stopPropagation(); void downloadPdf(item, 'full'); }}
                                  disabled={pdfDownloadingSet.has(item.id)}
                                  className="p-1.5 rounded-lg hover:bg-cyan-50 text-slate-400 hover:text-cyan-600 transition-colors disabled:opacity-50"
                                  title={showTraineeBtn ? 'Скачать PDF — полный (для меня)' : 'Скачать PDF'}
                                >
                                  {pdfDownloadingSet.has(item.id)
                                    ? <Loader2 size={14} className="animate-spin"/>
                                    : <FileDown size={14}/>
                                  }
                                </button>
                                {showTraineeBtn && (
                                  <button
                                    onClick={ev => { ev.stopPropagation(); void downloadPdf(item, 'trainee'); }}
                                    disabled={pdfDownloadingSet.has(`${item.id}:trainee`)}
                                    className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-colors disabled:opacity-50"
                                    title={`Скачать PDF — для ${traineeRole}`}
                                  >
                                    {pdfDownloadingSet.has(`${item.id}:trainee`)
                                      ? <Loader2 size={14} className="animate-spin"/>
                                      : <UserRound size={14}/>
                                    }
                                  </button>
                                )}
                              </>
                            );
                          })()}
                          <div className="p-1.5 text-slate-400">
                            {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                          </div>
                        </div>
                      </div>

                      {/* Полоска прогресса в нижнем крае карточки — всегда видна (для нулевых — серый трек). */}
                      {!isExpanded && (
                        <div className="h-1 bg-slate-100 overflow-hidden">
                          <div
                            className={cx(
                              'h-full transition-all duration-500',
                              readiness === 100
                                ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                                : readiness > 0
                                  ? 'bg-gradient-to-r from-cyan-400 to-cyan-500'
                                  : '',
                            )}
                            style={{ width: `${readiness}%` }}
                          />
                        </div>
                      )}

                      {/* Expanded editor — компактная версия */}
                      {isExpanded && (() => {
                        const attachKind   = attachOpen.get(item.id) ?? null;
                        const photoCount   = (db.images ?? []).length;
                        const docCount     = (db.documents ?? []).length;
                        const videoCount   = (db.videos ?? []).length;
                        return (
                          <div className="border-t border-sky-100 px-5 pb-3 pt-2.5 bg-white space-y-2.5">
                            {/* Readiness — узкий segment в одну строку */}
                            <div className="grid grid-cols-5 gap-px rounded-xl ring-1 ring-sky-200 overflow-hidden bg-sky-100">
                              {([0, 25, 50, 75, 100] as const).map(pct => {
                                const isSelected = readiness === pct;
                                const isDone     = pct === 100;
                                return (
                                  <button
                                    key={pct}
                                    onClick={() => void changeReadiness(item.id, item.initialStatus, pct)}
                                    className={cx(
                                      'py-1.5 text-[12px] font-bold tabular-nums transition-colors',
                                      isSelected
                                        ? isDone
                                          ? 'bg-emerald-500 text-white'
                                          : 'bg-cyan-500 text-white'
                                        : 'bg-white text-slate-500 hover:bg-sky-50',
                                    )}
                                  >
                                    {pct}%
                                  </button>
                                );
                              })}
                            </div>

                            {/* Content panel — редактирование только в полноэкранной модалке */}
                            {(() => {
                              const hasC = e.content.trim().length > 0;
                              return (
                                <button
                                  onClick={ev => { ev.stopPropagation(); setModalItem(item); }}
                                  className={cx(
                                    'group w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all ring-1',
                                    hasC
                                      ? 'bg-gradient-to-r from-sky-50 to-cyan-50 ring-cyan-100 hover:ring-cyan-300 hover:shadow-[0_4px_14px_rgba(34,211,238,0.18)]'
                                      : 'bg-slate-50 ring-slate-200 hover:bg-cyan-50/50 hover:ring-cyan-200',
                                  )}
                                >
                                  <div className={cx(
                                    'grid h-10 w-10 place-items-center rounded-lg shrink-0 transition-colors ring-1',
                                    hasC
                                      ? 'bg-white text-cyan-600 ring-cyan-200 group-hover:bg-cyan-500 group-hover:text-white group-hover:ring-cyan-500'
                                      : 'bg-white text-slate-400 ring-slate-200 group-hover:text-cyan-500 group-hover:ring-cyan-200',
                                  )}>
                                    <FileText size={18} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className={cx(
                                      'text-[13px] font-semibold',
                                      hasC ? 'text-slate-900' : 'text-slate-600',
                                    )}>
                                      {hasC ? 'Содержание документа' : 'Содержание не заполнено'}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-slate-500">
                                      {hasC
                                        ? `${e.content.length.toLocaleString('ru')} символов · markdown`
                                        : 'Открыть полноэкранный редактор и создать'
                                      }
                                    </div>
                                  </div>
                                  <span className={cx(
                                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold shrink-0 transition-colors',
                                    hasC
                                      ? 'text-cyan-700 group-hover:bg-white/60'
                                      : 'text-slate-600 group-hover:text-cyan-600',
                                  )}>
                                    <Maximize2 size={13} />
                                    {hasC ? 'Открыть' : 'Создать'}
                                  </span>
                                </button>
                              );
                            })()}

                            {/* Attachments row — три pill'а */}
                            <div className="flex items-center gap-1.5">
                              {([
                                { kind: 'photos' as const, label: 'Фото',   count: photoCount, Icon: Camera    },
                                { kind: 'files'  as const, label: 'Файлы',  count: docCount,   Icon: Paperclip },
                                { kind: 'videos' as const, label: 'Видео',  count: videoCount, Icon: Play      },
                              ]).map(({ kind, label, count, Icon }) => {
                                const isOpen = attachKind === kind;
                                return (
                                  <button
                                    key={kind}
                                    onClick={ev => { ev.stopPropagation(); toggleAttach(item.id, kind); }}
                                    className={cx(
                                      'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
                                      isOpen
                                        ? 'bg-cyan-500 text-white shadow-[0_3px_10px_rgba(34,211,238,0.30)]'
                                        : count > 0
                                          ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200 hover:bg-cyan-100'
                                          : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100',
                                    )}
                                  >
                                    <Icon size={12} />
                                    {label}
                                    <span className={cx(
                                      'inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[10px] font-bold tabular-nums',
                                      isOpen
                                        ? 'bg-white/25 text-white'
                                        : count > 0
                                          ? 'bg-cyan-200 text-cyan-800'
                                          : 'bg-slate-200 text-slate-500',
                                    )}>{count}</span>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Раскрытая категория вложений */}
                            {attachKind === 'photos' && (
                              <div className="rounded-xl ring-1 ring-cyan-100 bg-cyan-50/40 p-2.5 space-y-2">
                                {photoCount > 0 && (
                                  <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-1.5">
                                    {(db.images ?? []).map((url, imgIdx) => (
                                      <div key={imgIdx} className="relative group rounded-lg overflow-hidden ring-1 ring-sky-100 aspect-square">
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
                                    'flex items-center justify-center gap-2 w-full py-1.5 rounded-lg border border-dashed cursor-pointer transition-colors text-[11px] font-medium',
                                    uploadingSet.has(item.id)
                                      ? 'border-cyan-300 bg-cyan-50 text-cyan-600'
                                      : 'border-slate-300 bg-white text-slate-500 hover:border-cyan-300 hover:text-cyan-600',
                                  )}
                                >
                                  {uploadingSet.has(item.id)
                                    ? <><Loader2 size={12} className="animate-spin"/> Загружаю…</>
                                    : <><Upload size={12}/> Добавить фото</>
                                  }
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
                            )}

                            {attachKind === 'files' && (
                              <div className="rounded-xl ring-1 ring-cyan-100 bg-cyan-50/40 p-2.5 space-y-1.5">
                                {(db.documents ?? []).map((doc, docIdx) => (
                                  <div
                                    key={docIdx}
                                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white ring-1 ring-slate-200 group"
                                  >
                                    <Paperclip size={12} className="text-slate-400 shrink-0" />
                                    <a
                                      href={doc.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex-1 min-w-0 text-[12px] text-slate-700 font-medium truncate hover:underline"
                                      title={doc.name}
                                    >
                                      {doc.name}
                                    </a>
                                    <button
                                      onClick={ev => { ev.stopPropagation(); void removeDocument(item.id, item.initialStatus, docIdx); }}
                                      className="shrink-0 p-1 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100"
                                      title="Удалить"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                ))}
                                <label
                                  htmlFor={`doc-upload-${item.id}`}
                                  className={cx(
                                    'flex items-center justify-center gap-2 w-full py-1.5 rounded-lg border border-dashed cursor-pointer transition-colors text-[11px] font-medium',
                                    uploadingDocsSet.has(item.id)
                                      ? 'border-cyan-300 bg-cyan-50 text-cyan-600'
                                      : 'border-slate-300 bg-white text-slate-500 hover:border-cyan-300 hover:text-cyan-600',
                                  )}
                                >
                                  {uploadingDocsSet.has(item.id)
                                    ? <><Loader2 size={12} className="animate-spin"/> Загружаю…</>
                                    : <><Paperclip size={12}/> Добавить Word / PDF</>
                                  }
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
                            )}

                            {attachKind === 'videos' && (
                              <div className="rounded-xl ring-1 ring-cyan-100 bg-cyan-50/40 p-2.5 space-y-2">
                                {(db.videos ?? []).map((vid, vidIdx) => {
                                  const ytId = extractYouTubeId(vid.url);
                                  return (
                                    <div key={vidIdx} className="flex items-center gap-2 p-1.5 rounded-lg bg-white ring-1 ring-slate-200 group">
                                      {ytId ? (
                                        <img
                                          src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
                                          className="w-14 h-9 rounded object-cover shrink-0 ring-1 ring-slate-200"
                                          alt=""
                                        />
                                      ) : (
                                        <div className="w-14 h-9 rounded bg-slate-100 shrink-0 flex items-center justify-center">
                                          <Play size={14} className="text-slate-400" />
                                        </div>
                                      )}
                                      <a
                                        href={vid.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-1 min-w-0 text-[12px] text-slate-700 font-medium truncate hover:underline"
                                        title={vid.title || vid.url}
                                      >
                                        {vid.title || vid.url}
                                      </a>
                                      <button
                                        onClick={ev => { ev.stopPropagation(); void removeVideo(item.id, item.initialStatus, vidIdx); }}
                                        className="shrink-0 p-1 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100"
                                        title="Удалить"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  );
                                })}
                                <VideoAddForm
                                  onAdd={(title, url) => void addVideo(item.id, item.initialStatus, title, url)}
                                />
                              </div>
                            )}

                            {/* Bottom bar */}
                            {(() => {
                              const traineeRole = TWO_AUDIENCE_ITEMS[item.id]?.traineeRole;
                              const showTraineeBtn =
                                !!traineeRole && /<!--\s*TRAINER:START\s*-->/i.test(e.content);
                              return (
                                <div className="flex items-center justify-between gap-2 pt-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button
                                      onClick={() => void downloadPdf(item, 'full')}
                                      disabled={pdfDownloadingSet.has(item.id)}
                                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      {pdfDownloadingSet.has(item.id)
                                        ? <><Loader2 size={13} className="animate-spin"/> Генерирую…</>
                                        : <><FileDown size={13}/> {showTraineeBtn ? 'PDF — для меня' : 'Скачать PDF'}</>
                                      }
                                    </button>
                                    {showTraineeBtn && (
                                      <button
                                        onClick={() => void downloadPdf(item, 'trainee')}
                                        disabled={pdfDownloadingSet.has(`${item.id}:trainee`)}
                                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-sky-700 ring-1 ring-sky-200 bg-sky-50/60 transition hover:bg-sky-50 disabled:opacity-50"
                                      >
                                        {pdfDownloadingSet.has(`${item.id}:trainee`)
                                          ? <><Loader2 size={13} className="animate-spin"/> Генерирую…</>
                                          : <><UserRound size={13}/> PDF — для {traineeRole}</>
                                        }
                                      </button>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => manualSave(item.id, item.initialStatus)}
                                    disabled={isSaving}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-[0_3px_12px_rgba(34,211,238,0.25)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50"
                                  >
                                    {isSaving
                                      ? <><Loader2 size={13} className="animate-spin"/> Сохраняю…</>
                                      : <><Save size={13}/> Сохранить</>
                                    }
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </>
          )}
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
