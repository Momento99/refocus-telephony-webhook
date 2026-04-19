# Экосистема Refocus — контекст для Claude Code

Refocus — сеть оптик с франшизой в 4 странах (Кыргызстан, Россия, Казахстан, Узбекистан).
Единый бэкенд — **Supabase** (project ID: `hbvuwnzemdifaapktaol`).

---

## 1. Refocus CRM (этот репозиторий)

**Путь:** `c:\Users\boka9\refocus-crm`

### Стек
- Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS 4
- Supabase — единственный бэкенд
- Prisma + SQLite — только для локального расчёта зарплат
- Графики: ECharts, Recharts (динамический импорт, без SSR)
- Штрихкоды: bwip-js, jsbarcode
- Excel: xlsx, xlsx-js-style
- Даты: date-fns, dayjs
- Печать: QZ Tray (через CDN)
- Уведомления: react-hot-toast
- Иконки: lucide-react
- Анимации: framer-motion, three.js, vanta, tsparticles

### Supabase-клиенты
- Браузер: `import { getBrowserSupabase } from '@/lib/supabaseBrowser'`
- Устаревший фасад (ещё используется): `import getSupabase from '@/lib/supabaseClient'`
- Сервер (SSR): `getSupabaseServerClient()` из `lib/supabaseServer.ts`
- Админ (service role): `getSupabaseAdmin()` из `lib/supabaseAdmin.ts`

### Структура маршрутов

**Основные:**
- `/new-order` — касса / новый заказ (POS)
- `/orders` — управление заказами
- `/customers` — база клиентов
- `/receipt/[id]` — просмотр чека

**Финансы:**
- `/finance/overview` — дашборд (выручка, расходы, прибыль)
- `/finance/reconciliation` — еженедельная сверка по филиалам
- `/finance/settings` — настройки финансов

**Склад:**
- `/warehouse` — учёт аксессуаров (сумки, чехлы, салфетки)
- `/warehouse/suppliers` — поставщики

**Настройки:**
- `/settings/lens-prices` — мультивалютный каталог линз
- `/settings/barcodes/overview` и `/settings/barcodes/[branchId]` — штрихкоды
- `/settings/payroll` — зарплата
- `/settings/users` — пользователи
- `/settings/integrations/whatsapp` — WhatsApp Business API
- `/settings/security` — смена пароля и глобальный выход со всех устройств
- `/settings/service-qa` — контроль качества

**Админ-панель (`/(admin)/admin/...`):**
- `/stats` — аналитика (заказы, выручка, демография, линзы, прибыль)
- `/franchise` — обзор франшизы
- `/franchise-map` — карта филиалов
- `/franchise-applications` — заявки
- `/franchise-calendar` — календарь
- `/franchise-chat` — чат с франчайзи
- `/franchise-docs` — документы
- `/franchise-finance` — финансы филиалов
- `/franchise-hq` — HQ управление
- `/franchise-portal` — портал франшизы
- `/franchise-ramp-up` — онбординг/запуск
- `/franchise-supply` — снабжение
- `/devices` — управление терминалами (POS и Kiosk)
- `/budget` — бюджетирование (линзы и оправы)
- `/ai-employee-messages` — AI-сообщения сотрудникам
- `/lens-procurement` — закупка линз
- `/notifications` — уведомления
- `/updates` — обновления приложений

**POS:**
- `/pos/login` — логин терминала
- `/pos/customer` — клиентский интерфейс

### API-маршруты (app/api/)
- `barcode` — генерация штрихкодов (Code128)
- `branches` — список филиалов
- `dashboard`, `dashboard/branches` — агрегация данных
- `admin/invite`, `admin/change-role`, `admin/set-role`, `admin/remove-user` — управление пользователями
- `admin/notifications/*` — рассылка уведомлений
- `employees`, `employees/[id]` — сотрудники (CRUD)
- `payroll/*` — зарплата (monthly, daily, summary, status, adjustments, close, config, branch, employee)
- `kiosk-build/*`, `pos-build/*` — сборки десктоп-приложений
- `qz/sign` — подпись для QZ Tray (печать)
- `telephony/zadarma` — VoIP Zadarma
- `zadarma/webrtc-key` — WebRTC ключи

### Авторизация
- Роли из `app_metadata.role`: `seller`, `manager`, `owner`
- `getUserRole()` — получение роли (SSR)
- Middleware: только обновление cookies, без блокировки маршрутов
- Проверки доступа — на уровне страниц и API

---

## 2. Refocus POS Terminal (десктоп-приложение)

**Путь:** `C:\refocusTerminal\refocus-pos`
**Репозиторий:** `github.com/Momento99/refocus-pos` (приватный)

### Стек
- Next.js 15.5 (standalone mode), React 18, TypeScript 5.6
- Electron 31.7 + electron-builder (NSIS Windows installer)
- electron-updater — автообновление через GitHub Releases
- next-intl — i18n (ru, uz, kk)
- Supabase, react-hot-toast, lucide-react, react-imask

### Маршруты
- `/pos/login` — логин сотрудника (логин + PIN + автодетект терминала)
- `/new-order` — создание заказа со сканером штрихкодов (RU→EN маппинг клавиатуры)
- `/orders` — список заказов
- `/customers`, `/customers/[id]` — клиенты
- `/my-shift` — итоги смены, план по зарплате
- `/expenses` — учёт расходов (дорога, промоутеры, питание, расходники)
- `/pos/consumables` — учёт расходников (сумки, чехлы, салфетки)
- `/pos/lens-warehouse` — склад линз (партии, остатки)
- `/customer-screen` — экран для клиента (двухмониторный режим)
- `/admin/notifications` — управление push-уведомлениями

### Ключевые особенности
- Авторизация: логин + PIN → RPC `fn_pos_open_by_branch` → сессия в sessionStorage
- Терминал автодетект из Electron или localStorage
- `TerminalGuard` — удалённая блокировка терминала (поллинг каждый час)
- `UpdateGate` — UI автообновления Electron
- Мультистрановая конфигурация: валюта, таймзона, склад, телефонные коды
- App ID: `com.refocus.pos`, версия: 0.8.2

### API
- `/api/payroll/day` — расчёт зарплаты за день
- `/api/admin/notifications/dispatch` — отправка push через Expo Push API

---

## 3. Refocus Mobile App

**Путь:** `C:\refocus-mobile\refocus-mobile`

### Стек
- React Native 0.81, Expo 54, Expo Router 6
- React 19, TypeScript 5.9
- Supabase 2.97
- expo-notifications (FCM/APNs), expo-camera, react-native-maps
- Шрифты: Manrope (4 веса) + RefocusDisplay

### Экраны
- `/brand` — онбординг с видео + ввод телефона
- `/code` — OTP верификация (SMS / WhatsApp)
- **Табы (5 штук с glassmorphism tab bar):**
  - `home` — главный дашборд с видео
  - `orders` — история визитов, "Моё зрение"
  - `glasses` — купленные очки, гарантия, рецепт (Rx)
  - `bonuses` — система штампов (7 = бесплатная оправа), скидки
  - `more` — доп. навигация
- `/lens-price` — каталог линз с ценами
- `/vision-history` — график зрения
- `/settings` — язык, страна, push, удаление аккаунта

### Особенности
- 5 языков: ru, en, kg, kz, uz (файлы i18n 30-50KB каждый)
- 4 страны: KG, KZ, UZ, RU (динамические валюты из Supabase)
- Телефонная авторизация через OTP (SMS/WhatsApp)
- 13-этапный трекинг заказа (от транспортировки оправы до выдачи)
- Лояльность: штампы + скидки по количеству покупок
- Push-уведомления через Expo + RPC `mobile_push_register`
- Supabase Edge Functions: `delete-my-account`, `sms_send_otp`, `whatsapp_send_otp`, `whatsapp_verify_otp`
- App ID: `kg.refocus.app`, версия: 1.3.0

---

## 4. Refocus Lens Kiosk (сенсорный экран)

**Путь:** `C:\TouchScreenRefocus\refocus-lens-kiosk`

### Стек
- React 19 + Vite 7 + TypeScript 5.9
- Electron 40 + electron-builder (NSIS)
- electron-updater — автообновление
- Supabase 2.103
- Иконки: @phosphor-icons/react

### Функционал
- **TerminalSetupScreen** — логин сотрудника + PIN филиала + выбор терминала
- **Основной экран** — сетка из 17 типов линз в 3 категориях (Basic, Special, Premium)
- **LensDetailOverlay** — полноэкранная карточка линзы: видео, оценки (8 критериев, 1-5), плюсы/минусы, советы, мнение консультанта
- Цены из `lens_catalog_localized` с фоллбэком на хардкод
- Автосброс после 60 сек бездействия
- Секретный сброс: 5 кликов в левый верхний угол
- Kiosk mode: полный экран, без escape, display always on

### Особенности
- Автообновление каждые 6 часов + force update из БД (`update_channels`)
- Удалённая блокировка через `terminals.is_enabled` (поллинг каждые 60 мин)
- App ID: `kg.refocus.lenskiosk`, версия: 1.2.21

---

## 5. Лендинг Refocus (статический сайт)

**Путь:** `C:\Users\boka9\OneDrive\Рабочий стол\Работа\Лендинг Refocus\`

### Стек
- Статический HTML5 + Vanilla JS (ES6+)
- CSS3 с анимациями и градиентами
- Playwright (для тестирования/скриншотов)
- Шрифты: Manrope, Inter, San Francisco, RefocusDisplay

### Страницы
- `index.html` — главная
- `franchise.html` — франшиза/партнёрство
- `about.html` — о компании
- `app.html` — информация о приложении
- `delete-account.html` — удаление аккаунта
- `verify.html` — верификация
- `privacy.html` — политика конфиденциальности

### Особенности
- Глобальная навигация через `js/nav.js` (инжектится на все страницы)
- Анимированный canvas-фон с волнами (`js/wave-bg.js`)
- Каталог линз с ценами (`js/lens-data.js` ~60KB, `js/lens-prices.js` ~23KB)
- Дизайн: тёмный navy (#0F172A) + cyan акцент (#22D3EE), glassmorphism

---

## 6. Refocus Franchise Portal

**Путь:** `C:\refocus-franchise-portal`

### Стек
- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- Supabase 2.103
- ECharts 6 (графики)
- lucide-react, react-hot-toast, react-markdown
- Деплой: Vercel, порт 3003

### Маршруты
- `/login` — логин + PIN (franchise_users)
- `/dashboard` — аналитика: заказы, выручка, клиенты, зарплата, расходники, дефицит линз, сообщения HQ, роялти
- `/orders` — заказы
- `/customers` — клиенты
- `/payroll` — зарплата/смены
- `/attendance` — посещаемость
- `/warehouse` — склад/расходники
- `/stats` — статистика
- `/finance` — финансы
- `/rating` — рейтинг филиала
- `/training` — обучающие материалы
- `/checklist` — ежедневные чеклисты
- `/calendar` — календарь событий
- `/documents` — документы
- `/control` — связь с HQ
- `/launch` — гайд по запуску нового филиала

### Особенности
- Авторизация: логин + PIN из таблицы `franchise_users`
- Realtime: подписка на непрочитанные сообщения HQ в сайдбаре
- Доступ ограничен branch_id пользователя

---

## Общая база данных (Supabase)

Все проекты используют один Supabase проект (`hbvuwnzemdifaapktaol`).

### Основные таблицы

**Заказы и клиенты:**
- `orders`, `order_items`, `customers`, `customer_notes`, `payments`, `refunds`, `products`
- Views: `orders_view`, `order_items_view`, `customer_orders_view`, `order_payments_view`

**Филиалы и страны:**
- `branches`, `franchise_countries`, `branch_workhours`, `locations`, `branch_location_map`, `warehouses`
- View: `branches_with_settings`

**Линзы и оправы:**
- `lens_catalog` — мастер-каталог (цены в KGS)
- `lens_catalog_prices` — переопределения цен по странам
- `lens_catalog_localized` — VIEW: автоконвертация + overrides
- `lens_skus`, `lens_family_map`, `lens_purchase_batches`, `lens_purchase_batch_items`
- `frames`, `frame_barcodes`

**Сотрудники и зарплата:**
- `employees`, `employee_credentials`, `employee_payroll_profiles`
- `payroll_entries`, `payroll_adjustments`, `payroll_config`
- Views: `v_payroll_daily`, `v_payroll_monthly`, `v_payroll_monthly_ui`, `v_payroll_adjustments_monthly`, `v_payroll_branch_turnover_daily`
- `v_employee_logins` — логин для POS/Kiosk

**Посещаемость:**
- `attendance_sessions`, `attendance_branch_schedules`, `attendance_penalty_rules`, `attendance_session_penalties`
- `pos_shifts`

**Финансы:**
- `expenses`, `pos_expenses`, `opex_daily_rates`, `cogs_per_order_rates`, `runtime_settings`
- Views: `v_reconciliation_weekly_branch_income`

**Франшиза:**
- `organizations`, `franchise_applications`, `franchise_users`, `franchise_contracts`
- `franchise_messages`, `franchise_notifications`, `franchise_documents`
- `franchise_calendar_templates`, `franchise_calendar_events`
- `franchise_invoices`, `franchise_supply_orders`, `franchise_supply_plans`
- `franchise_hq_items`, `franchise_launch_stages`, `franchise_launch_progress`, `franchise_launch_items`

**Терминалы и обновления:**
- `terminals` — реестр POS и Kiosk устройств
- `update_channels` — каналы автообновления по странам

**Уведомления:**
- `notification_campaigns`, `notification_dispatch_queue`, `notification_logs`, `notification_rules`

**Пользователи:**
- `profiles`, `app_settings`

**Расходники и склад:**
- `pos_consumables` — расходники (сумки, чехлы, салфетки)

**Бюджетирование:**
- Views: `v_frame_budget_plan_monthly`, `v_lens_budget_plan_monthly` (+ `_total`)

### Ключевые RPC-функции
- `fn_pos_open_by_branch(p_login, p_pin, p_terminal_id)` — открытие смены
- `fn_logout_and_close(p_session_id, p_reason)` — закрытие смены
- `get_active_session_id(p_terminal_code, p_login)` — восстановление сессии
- `mobile_push_register(p_platform, p_expo_push_token, p_device_id)` — регистрация push-токена
- Множество `rpc_*` функций для аналитики (40+)

---

## Каталог линз — архитектура

### Таблицы

**`lens_catalog`** — мастер-каталог (цены в KGS):
```
id           TEXT PK     -- slug: 'antiglare', 'chameleon', 'screen'
name         TEXT        -- 'Антибликовый', 'Защита от экранов'
category     TEXT        -- 'basic' | 'special' | 'premium'
price_from   INTEGER     -- нижняя граница
price_to     INTEGER     -- верхняя граница
is_active    BOOLEAN
sort_order   INTEGER
```

**`franchise_countries`** — страны с валютами:
```
id               TEXT PK   -- 'kg', 'ru', 'kz', 'uz'
name             TEXT
currency         TEXT      -- 'KGS', 'RUB', 'KZT', 'UZS'
currency_symbol  TEXT      -- 'с', '₽', '₸', 'сўм'
exchange_rate    NUMERIC   -- курс к KGS (авто из ЦБ РФ)
rate_updated_at  TIMESTAMPTZ
is_active        BOOLEAN
```

**`lens_catalog_prices`** — overrides по странам:
```
country_id  TEXT FK → franchise_countries
lens_id     TEXT FK → lens_catalog
price_from  INTEGER
price_to    INTEGER
PRIMARY KEY (country_id, lens_id)
```

**`lens_catalog_localized`** — VIEW:
```sql
-- Если есть override → берёт его. Иначе: smart_round(price * exchange_rate)
SELECT * FROM lens_catalog_localized WHERE country_id = 'ru';
```

---

## POS / Касса — ценообразование

**Цены берутся из базы.** POS при загрузке запрашивает `lens_catalog_localized` по `country_id` филиала.
Цепочка: CRM (`settings/lens-prices`) → `lens_catalog` / `lens_catalog_prices` → view `lens_catalog_localized` → POS.

`PRICE_MATRIX` в `new-order/page.tsx` — **только fallback** на случай, если линза ещё не добавлена в каталог.
Приоритет: `buildRangesFromDb(...)` из БД, если нет — `rangesForLensId(...)` из хардкода.

Два тира цен: `price_from` (до ±2.75 дптр), `price_to` (от ±3.00 дптр).

---

## Правила разработки
- Старую таблицу `lens_prices` **не трогать**
- Все мутации только через Supabase-клиент, никакого хардкода цен
- Компоненты: Tailwind utility classes, без shadcn/ui
- `react-hot-toast` для уведомлений
- Иконки: `lucide-react`
- CRM Supabase-клиент в браузере: `getBrowserSupabase()`, не `supabaseClient` напрямую (для нового кода)
- Подтверждения destructive-действий — брендовая модалка, **не** `window.confirm`

---

## Дизайн-система CRM (обязательно для всех страниц)

Единый визуальный язык. Любая новая страница и рефакторинг существующей — строго по этой системе. Эталон: [/settings/users](app/settings/users/page.tsx).

### Палитра

- Фон страницы: `#0F172A` (slate-900), задан в `globals.css`. **Не переопределять**. Не добавлять свои background'ы, градиентные баннеры, cyan/teal blur-свечения (дымку), SVG-паттерны и т.п.
- Primary accent: `cyan-500` (`#22D3EE`) — иконки шапки, primary-кнопки, фокус, активные чипы.
- Тени для primary: `shadow-[0_4px_20px_rgba(34,211,238,0.40)]` (иконка шапки), `shadow-[0_4px_16px_rgba(34,211,238,0.28)]` (кнопки).
- Текст на тёмном: `text-slate-50` (primary), `text-cyan-300/50` (подзаголовок шапки), `text-slate-400` (вторичный).
- Текст на белом: `text-slate-900` (primary), `text-slate-600` (secondary), `text-slate-500` (метки/подсказки), `text-slate-400` (placeholder).
- Border / ring на белых карточках: `ring-1 ring-sky-100` (по умолчанию), `ring-sky-200` для инпутов/селектов.
- Destructive: `rose-500` (иконка-квадрат в confirm-модалке, кнопка удаления), `rose-50` / `rose-600` / `rose-200` (hover-состояния).
- Семантические состояния: `bg-{color}-50 text-{color}-700 ring-{color}-200` — чипы/бейджи/инфо-блоки (`cyan` owner, `sky` manager, `teal` seller, `amber` warning, `rose` error).

### Типографика

- Заголовок страницы: `text-2xl font-bold tracking-tight text-slate-50`.
- Подзаголовок шапки: `text-[12px] text-cyan-300/50`.
- Заголовок карточки/модалки: `text-lg font-bold tracking-tight text-slate-900`.
- Метка поля/StatCard: `text-[11px] font-medium uppercase tracking-wide text-slate-500`.
- Значение StatCard: `text-2xl font-bold text-slate-900`.
- Подсказка/hint: `text-[11px] text-slate-500`.
- Таблица: заголовки `text-[11px] font-semibold uppercase tracking-wide text-slate-500`, тело `text-sm text-slate-900`.

### Иконки

- Только `lucide-react`. Никаких `react-icons/*`.
- В шапке: 20px (`h-5 w-5`), белая, внутри cyan-квадрата `h-10 w-10 rounded-2xl bg-cyan-500`.
- В кнопках/инпутах: 16px (`h-4 w-4`) или 18px (`h-[18px] w-[18px]`), цвет `text-slate-400` для декоративных, `text-white` для primary-кнопок.
- В иконках-кнопках таблицы: `h-9 w-9 rounded-xl ring-1 ring-slate-200`, внутри иконка 16px, hover-цвет по семантике (`hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200` для удаления).

### Шапка страницы (header pattern — обязательно)

```tsx
<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
  <div className="flex items-start gap-3">
    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
      <Icon className="h-5 w-5 text-white" />
    </div>
    <div>
      <div className="text-2xl font-bold tracking-tight text-slate-50">
        Название страницы
      </div>
      <div className="mt-0.5 text-[12px] text-cyan-300/50">
        Короткое описание
      </div>
    </div>
  </div>

  {/* Опционально справа: primary-кнопка или счётчики-pills */}
</div>
```

Иконка подбирается по смыслу страницы (`UserCog`, `Barcode`, `Globe`, `Settings2`, `Bell`, `LineChart` и т.д.).

### Карточки

Белая карточка — основной контейнер контента на тёмном фоне.

```tsx
<div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
  ...
</div>
```

StatCard (метрика):

```tsx
<div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Метка</div>
  <div className="mt-1 text-2xl font-bold text-slate-900">123</div>
  {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
</div>
```

Ряд метрик: `<div className="mb-6 grid gap-4 md:grid-cols-3">...</div>`.

### Таблицы

```tsx
<div className="overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-slate-50/80">
        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <th className="px-5 py-3">Колонка</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 text-slate-900">
        <tr className="transition hover:bg-sky-50/40">
          <td className="px-5 py-4">...</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

Skeleton-строка при `loading`:

```tsx
<tr className="animate-pulse">
  <td className="px-5 py-5"><div className="h-4 w-56 rounded bg-slate-200" /></td>
</tr>
```

### Кнопки

**Primary (cyan pill)** — все главные действия:

```tsx
<button className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50">
  <Icon className="h-4 w-4" />
  Действие
</button>
```

**Secondary (ghost на белом)**:

```tsx
<button className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50">
  Отмена
</button>
```

**Destructive (rose)**:

```tsx
<button className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(244,63,94,0.28)] transition hover:bg-rose-400 focus:ring-2 focus:ring-rose-300/70 disabled:opacity-50">
  <Trash2 className="h-4 w-4" />
  Удалить
</button>
```

**Icon-only (в таблице)**:

```tsx
<button className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200 disabled:opacity-50">
  <Trash2 className="h-4 w-4" />
</button>
```

### Инпуты и селекты

```tsx
<input className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400" />

<select className="rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 disabled:opacity-50" />
```

Инпут с иконкой слева: `pl-10`, иконка `pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400`.

Метка поля:

```tsx
<span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Метка</span>
```

### Сегментные кнопки (выбор из 2–4 опций)

Вместо селекта для коротких наборов (роль, период, статус):

```tsx
<div className="grid grid-cols-3 gap-2">
  {options.map(opt => (
    <button
      type="button"
      onClick={() => setValue(opt)}
      className={
        'rounded-xl px-3 py-2 text-sm font-semibold transition ' +
        (active === opt
          ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
          : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
      }
    >
      {opt.label}
    </button>
  ))}
</div>
```

### Чипы / бейджи

```tsx
<span className="inline-flex items-center rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 ring-1 ring-cyan-200">
  Статус
</span>
```

Нейтральный: `bg-slate-100 text-slate-500 ring-slate-200`. Остальные — по семантическому цвету (`sky`, `teal`, `amber`, `rose`).

### Модалки

Overlay + белая карточка, всегда по этой схеме:

```tsx
<div
  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
  onClick={onClose}
>
  <div
    className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100"
    onClick={e => e.stopPropagation()}
  >
    <div className="mb-5 flex items-start justify-between">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.3)]">
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-lg font-bold tracking-tight text-slate-900">Заголовок</div>
          <div className="text-[12px] text-slate-500">Подпись</div>
        </div>
      </div>
      <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
        <X className="h-5 w-5" />
      </button>
    </div>

    {/* body */}

    <div className="flex items-center justify-end gap-2 pt-2">
      <button className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">Отмена</button>
      <button className="rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] hover:bg-cyan-400">Действие</button>
    </div>
  </div>
</div>
```

Confirm-модалка для destructive: иконка `AlertTriangle` в `rose-500`-квадрате, кнопка действия `bg-rose-500`. См. `ConfirmDeleteModal` в [/settings/users](app/settings/users/page.tsx).

### Уведомления

- Только `react-hot-toast`. Конфиг уже в [app/layout.tsx](app/layout.tsx).
- `toast.success`, `toast.error` — короткие, без эмодзи.
- Для длинных операций: `const t = toast.loading('…')` → `toast.dismiss(t)` в `finally`.

### Что запрещено на страницах CRM

- Градиентные баннеры, цветные подложки под всей страницей, собственные `bg-*` на корневом `<div>`.
- Cyan/teal blur-«дымка» на фиксированных overlay (встречается в старом коде — не копировать в новые страницы).
- Фиолетовые/индиго градиенты кнопок и бейджей (из старого дизайна).
- Иконки `react-icons/*`, `@heroicons/react`.
- shadcn/ui, Material UI, Ant Design и любые UI-киты.
- `window.confirm`, `window.alert`, `window.prompt` — только брендовые модалки.
- Собственные цвета вне Tailwind-палитры и переменных выше.
