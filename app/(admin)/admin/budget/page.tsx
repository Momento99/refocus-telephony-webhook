'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  RefreshCw,
  Car,
  CreditCard as CreditCardIcon,
  Wallet,
  ChevronDown,
  Home,
  Landmark,
  Glasses,
  Eye,
  PackageOpen,
} from 'lucide-react';

/* ============ Supabase ============ */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/* ============ Константы ============ */

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

const BRANCHES = [
  { id: 1, name: 'Сокулук' },
  { id: 2, name: 'Беловодск' },
  { id: 3, name: 'Кара-Балта' },
  { id: 4, name: 'Кант' },
  { id: 5, name: 'Токмок' },
] as const;
const BRANCH_IDS = BRANCHES.map((b) => b.id);
const BRANCH_NAME = new Map<number, string>(BRANCHES.map((b) => [b.id, b.name]));

/** Два бюджета = два ИП. Привязка зашита в коде (в БД organization_id одинаков). */
const BUDGETS = [
  { key: 'A', title: 'Мои', owner: 'ИП Момбеков', branchIds: [4, 5], accent: 'cyan' as const },
  { key: 'B', title: 'Мама', owner: 'ИП Кудайкулова', branchIds: [1, 2, 3], accent: 'emerald' as const },
] as const;

/** Новые филиалы без полноценных данных — показываем как «подключается». */
const NEW_BRANCH_IDS = new Set<number>([2]); // Беловодск

/** Аренда у части филиалов платится не 1-го, а в другой день — цикл копится к этому дню.
 *  Филиалы без записи копят равномерно по календарному месяцу (оплата ~1-го). */
const RENT_DUE_DAY: Record<number, number> = { 4: 15 }; // Кант — 15-го числа

const SYSTEM_START_ISO = '2026-06-01'; // дата запуска системы накоплений

const CREDIT_AUTO_DUE_DAY = 20;     // кредит авто платим 20-го
const CREDIT_PERSONAL_DUE_DAY = 10; // личный кредит платим 10-го
const TAX_DUE_DAY = 20;             // налоги платим к 20-му

/* ============ Утилиты дат ============ */

function bishkekToday(): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bishkek',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** UTC-инстант, соответствующий полуночи указанной даты в Бишкеке. */
function bishkekMidnightUtcISO(dayISO: string) {
  return new Date(`${dayISO}T00:00:00+06:00`).toISOString();
}

function daysBetweenInclusive(fromISO: string, toDate: Date) {
  const from = new Date(`${fromISO}T00:00:00Z`);
  const diff = Math.floor((toDate.getTime() - from.getTime()) / (24 * 3600 * 1000)) + 1;
  return Math.max(0, diff);
}

function formatDateRu(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/* ============ Периоды (календарные, TZ Бишкек) ============ */

type PeriodKey = 'day' | 'week' | 'month' | 'year';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'day', label: 'День' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'year', label: 'Год' },
];

/** Календарный диапазон [from, to] по TZ Бишкека: день = сегодня, неделя = с понедельника,
 *  месяц = с 1-го числа, год = с 1 января. `today` — UTC-полночь бишкекской даты (bishkekToday). */
function calendarRange(period: PeriodKey, today: Date): { fromISO: string; toISO: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();
  const toISO = ymd(today);
  if (period === 'day') return { fromISO: toISO, toISO };
  if (period === 'week') {
    const dow = today.getUTCDay();   // 0=вс … 6=сб
    const back = (dow + 6) % 7;      // сколько дней назад до понедельника
    return { fromISO: ymd(new Date(Date.UTC(y, m, d - back))), toISO };
  }
  if (period === 'month') return { fromISO: ymd(new Date(Date.UTC(y, m, 1))), toISO };
  return { fromISO: ymd(new Date(Date.UTC(y, 0, 1))), toISO }; // year
}

/** Подпись периода для шапки блока. */
function periodRangeLabel(period: PeriodKey, today: Date): string {
  if (period === 'day') return 'сегодня';
  return `с ${formatDateRu(calendarRange(period, today).fromISO)}`;
}

const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function monthGenitive(mIdx: number) { return MONTHS_GEN[mIdx] ?? ''; }

/** Месяц ПОВЫШЕННОГО налога — это месяц ОПЛАТЫ за прошедший квартал, а не месяц самого квартала:
 *    за 1-й квартал (янв–мар) платим в апреле
 *    за 2-й квартал (апр–июн) платим в июле      ← факт: 20.07.2026 ушло 31 353 сом
 *    за 3-й квартал (июл–сен) платим в октябре
 *    за 4-й квартал (окт–дек) платим в январе
 *  Итого 4 повышенных месяца в году. Копим по месяцу оплаты: 31 000 на сеть вместо 21 000. */
function isQuarterTaxMonth(mIdx: number) {
  return mIdx === 0 || mIdx === 3 || mIdx === 6 || mIdx === 9; // январь/апрель/июль/октябрь
}

/**
 * Цикл накопления к фиксированному числу оплаты (dueDay).
 * Копим РАВНОМЕРНО с (dueDay+1) прошлого месяца по dueDay текущего — так к дню
 * оплаты накоплена ровно вся сумма, а сразу после оплаты цикл начинается заново.
 */
function dueCycle(today: Date, dueDay: number, monthlyAmount: number) {
  const mIdx = today.getUTCMonth();
  const dayOfMonth = today.getUTCDate();
  const offset = dayOfMonth <= dueDay ? 0 : 1;
  const dueDate = new Date(Date.UTC(today.getUTCFullYear(), mIdx + offset, dueDay));
  const cycleStart = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() - 1, dueDay + 1));
  const cycleStartISO = ymd(cycleStart);
  const cycleDays = daysBetweenInclusive(cycleStartISO, dueDate);
  const elapsed = Math.min(daysBetweenInclusive(cycleStartISO, today), cycleDays);
  const daysLeft = Math.max(0, Math.round((dueDate.getTime() - today.getTime()) / (24 * 3600 * 1000)));
  const fraction = cycleDays > 0 ? elapsed / cycleDays : 0;
  const amount = Math.min(monthlyAmount, Math.round(fraction * monthlyAmount));
  return { amount, fraction, cycleStartISO, cycleDays, elapsed, daysLeft, dueDate };
}

/* ============ Классификаторы COGS ============ */

const norm = (s: string) =>
  s.trim().toLowerCase().replace(/[ёЁ]/g, 'е').replace(/\s+/g, ' ');

// Классификация item → frame/lens/consumable и подвиды расходников живёт на сервере
// (RPC budget_box_accruals + budget_period_summary) — один источник правды, без лимита строк.
// На клиенте остаётся только norm() для категории аренды.

/* ============ Типы ============ */

type CogsParts = { frames: number; lenses: number; consumables: number };

type BranchContribution = {
  branchId: number;
  name: string;
  isNew: boolean;
  rent: number;
  tax: number;
  cogs: number;
  cogsParts: CogsParts;
  consumableSubs: { name: string; amount: number }[]; // Футляры/Пакеты/Платочки …
  total: number;
  ordersCount: number;
};

type BudgetView = {
  key: string;
  title: string;
  owner: string;
  accent: 'cyan' | 'emerald';
  branches: BranchContribution[];
  total: number;
  revenue: number;
  payroll: number;
};

type Totals = {
  branchesSum: number;   // сумма по всем филиалам (аренда+налог+COGS)
  creditsSum: number;    // оба кредита
  grandTotal: number;    // сколько должно быть в котле всего (накоплено)
  revenue: number;
  payroll: number;
  expenses: number;      // расходы, НАЧИСЛЕННЫЕ за период (аренда+налоги+кредиты+себест., поток)
  free: number;          // выручка − расходы за период − зарплата
  fromISO: string;
};

type CategoryRow = { label: string; amount: number; mine: boolean | null };
type SpendInfo = { spendKey: string; accrued: number; spent: number; balance: number };
type CategoryBox = {
  key: string;
  title: string;
  icon: React.ElementType;
  total: number;       // остаток (для спендуемых = начислено − оплачено/закуплено, может быть < 0)
  mine: number;   // доля бюджета «Мои» (Кант+Токмок)
  mama: number;   // доля бюджета «Мама»
  rows: CategoryRow[];
  tone: 'op' | 'credit';
  group?: 'fixed' | 'goods';  // постоянные платежи / товарные резервы
  hint?: string;              // подпись (срок оплаты для аренды/налогов/кредитов)
  target?: number;            // месячная сумма для прогресс-бара (накоплено к цели)
  spend?: SpendInfo;          // коробка со списаниями (оправы/линзы/налоги/аренда/кредиты/подвиды)
  subBoxes?: CategoryBox[];   // «Расходники»/«Кредиты» → мини-коробочки
};

type CardPerson = {
  accrued: number;      // накоплено обязательств с запуска (валово, монотонно)
  transferred: number;  // уже переведено на карту
  toTransfer: number;   // сколько занести с прошлого пополнения = accrued − transferred (≥0)
};
type CardState = { A: CardPerson; B: CardPerson };

type NextPayment = { daysLeft: number; dueLabel: string; items: { label: string; amount: number }[] };

/* ============ Страница ============ */

/** Строка P&L за период из RPC budget_period_summary (см. миграцию budget_period_summary).
 *  Чистая прибыль = Выручка − Возвраты − Себестоимость − Расходы(opex+ручные) − Зарплата.
 *  Кредиты в прибыль НЕ входят (погашение долга, не операционный расход). */
type SummaryRow = {
  revenue: number;
  refunds: number;
  cogs_total: number;
  cogs_frames: number;
  cogs_lenses: number;
  cogs_cons: number;
  opex_total: number;
  opex_rent: number;
  opex_utilities: number;
  opex_tax: number;
  opex_manual: number;
  payroll_total: number;
  net_profit: number;
  n_days: number;
};

/** Накоплено к сегодняшнему дню (МОНОТОННО с startISO): за завершённые месяцы — полная
 *  месячная сумма, за текущий — пропорционально прошедшим дням. amountForMonth(y,m) —
 *  месячная сумма (для налогов меняется в квартальные месяцы). Без автосписания: уменьшается
 *  только явными оплатами (budget_box_spends). */
function accruedMonthlySince(
  startISO: string,
  today: Date,
  amountForMonth: (y: number, m: number) => number,
): number {
  const start = new Date(`${startISO}T00:00:00Z`);
  if (today.getTime() < start.getTime()) return 0;
  const ty = today.getUTCFullYear(), tm = today.getUTCMonth();
  let total = 0, y = start.getUTCFullYear(), m = start.getUTCMonth();
  for (let i = 0; i < 600; i++) {
    const daysInM = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const firstDay = (y === start.getUTCFullYear() && m === start.getUTCMonth()) ? start.getUTCDate() : 1;
    const lastDay = (y === ty && m === tm) ? today.getUTCDate() : daysInM;
    total += amountForMonth(y, m) * (Math.max(0, lastDay - firstDay + 1) / daysInM);
    if (y === ty && m === tm) break;
    if (++m > 11) { m = 0; y++; }
  }
  return total;
}

export default function BudgetPage() {
  const today = useMemo(() => bishkekToday(), []);
  const todayISO = useMemo(() => ymd(today), [today]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BudgetView[]>([]);
  const [categoryBoxes, setCategoryBoxes] = useState<CategoryBox[]>([]);
  const [card, setCard] = useState<CardState | null>(null);
  const [nextPay, setNextPay] = useState<NextPayment | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [spendTarget, setSpendTarget] = useState<{ spendKey: string; title: string; suggest: number } | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ person: 'A' | 'B'; label: string; suggest: number } | null>(null);

  // Период для блока «Чистая прибыль» (календарный, TZ Бишкек).
  const [profitPeriod, setProfitPeriod] = useState<PeriodKey>('month');
  const [profitData, setProfitData] = useState<SummaryRow | null>(null);
  const [profitBusy, setProfitBusy] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      /* 1. Базовые запросы */
      const [resetsR, extrasR, opexR, spendsR, transfersR] = await Promise.all([
        supabase.from('budget_box_resets').select('box_key, last_reset_at'),
        supabase.from('budget_extra_items').select('key, monthly_amount').eq('is_active', true),
        supabase
          .from('opex_daily_rates')
          .select('branch_id, category, daily_rate')
          .eq('is_active', true)
          .in('branch_id', BRANCH_IDS),
        supabase.from('budget_box_spends').select('box_key, amount, spent_on, is_correction'),
        supabase.from('budget_card_transfers').select('person, amount'),
      ]);
      if (resetsR.error) throw resetsR.error;
      if (opexR.error) throw opexR.error;
      if (spendsR.error) console.warn('[budget] spends read error', spendsR.error);
      if (transfersR.error) console.warn('[budget] transfers read error', transfersR.error);

      /* 2. Даты обнуления (дефолт — 1 число месяца) */
      const defaultReset = ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
      const resetMap = new Map<string, string>();
      for (const r of resetsR.data ?? []) resetMap.set(String(r.box_key), String(r.last_reset_at));
      const resetOf = (key: string) => {
        const r = resetMap.get(key) ?? defaultReset;
        return r < SYSTEM_START_ISO ? SYSTEM_START_ISO : r; // не копим до запуска системы
      };

      const cogsReset = resetOf('consumables'); // окно для выручки/зарплаты (помесячно)
      // Коробки оправ/линз/расходников — НАКОПИТЕЛЬНЫЕ: копят с запуска системы (или с явного
      // ручного сброса в budget_box_resets), 1-го числа НЕ обнуляются. Минус по закупке держится,
      // пока продажи не добьют коробочку (см. RPC budget_box_accruals + таблицу budget_box_spends).
      const manualCogsReset = resetMap.get('consumables');
      const boxAccrualStart =
        manualCogsReset && manualCogsReset > SYSTEM_START_ISO ? manualCogsReset : SYSTEM_START_ISO;

      /* 3. Настраиваемые суммы */
      const extra = new Map<string, number>();
      for (const e of extrasR.data ?? []) extra.set(String((e as any).key), Number((e as any).monthly_amount) || 0);
      const creditAutoAmt     = extra.get('credit_auto')        ?? 58000;
      const creditPersonalAmt = extra.get('credit_personal')    ?? 16000;
      const taxNormal         = extra.get('tax_branch_normal')  ?? 4200;
      const taxQuarter        = extra.get('tax_branch_quarter') ?? 6200;

      /* 4. Ставки аренды по филиалам (daily_rate × 30 = месячная аренда) */
      const rentRateByBranch = new Map<number, number>();
      for (const o of opexR.data ?? []) {
        if (norm(String(o.category)) === 'аренда') {
          rentRateByBranch.set(o.branch_id as number, Number(o.daily_rate) || 0);
        }
      }

      /* 5. Накопленный резерв по коробкам — СЕРВЕРНО (RPC budget_box_accruals), накопительно
         с boxAccrualStart. На клиенте не агрегируем по сырым заказам: их с запуска уже сотни,
         выборка упёрлась бы в лимит PostgREST (1000) и занизила бы цифры. */
      const { data: accrData, error: accrErr } = await supabase.rpc('budget_box_accruals', {
        from_dt: boxAccrualStart,
        to_dt: todayISO,
        branch_ids: BRANCH_IDS,
      });
      if (accrErr) throw accrErr;

      const frameAccByBranch = new Map<number, number>();
      const lensAccByBranch = new Map<number, number>();
      const consSubAccByBranch = new Map<number, Map<string, number>>(); // филиал → {Футляры: накоплено, …}
      const ordersCountByBranch = new Map<number, number>();
      const allSubs = new Set<string>();
      for (const r of accrData ?? []) {
        const bid = Number((r as any).branch_id);
        frameAccByBranch.set(bid, Number((r as any).frame_accrued) || 0);
        lensAccByBranch.set(bid, Number((r as any).lens_accrued) || 0);
        ordersCountByBranch.set(bid, Number((r as any).orders_count) || 0);
        const subs = ((r as any).cons_subs ?? {}) as Record<string, number>;
        const m = new Map<string, number>();
        for (const k of Object.keys(subs)) { m.set(k, Number(subs[k]) || 0); allSubs.add(k); }
        consSubAccByBranch.set(bid, m);
      }

      /* 5b. Списания (закупки) по коробкам — сетевые суммы; раскидываем по филиалам
         пропорционально накопленному. Остаток коробки = накоплено − закуплено (может быть минус). */
      const spentByBox = new Map<string, number>();
      // Корректировки (is_correction) — подмножество списаний: это не закуп, а снятие
      // начисления, которого не должно было быть (например, хамелеон до 23.07 покупали
      // на Дордое за свои). Коробку они гасят наравне с закупом, но требование к карте
      // должны уменьшать тоже — см. personAccrued ниже.
      const correctionByBox = new Map<string, number>();
      for (const s of spendsR.data ?? []) {
        const k = String((s as any).box_key);
        const amt = Number((s as any).amount) || 0;
        spentByBox.set(k, (spentByBox.get(k) ?? 0) + amt);
        if ((s as any).is_correction) correctionByBox.set(k, (correctionByBox.get(k) ?? 0) + amt);
      }
      // Аренда/налоги/кредиты копятся монотонно с запуска (или с явного ручного сброса),
      // НЕ обнуляются по дате — уходят только при ручной оплате.
      const fixedStart = (key: string) => {
        const r = resetMap.get(key);
        return r && r > SYSTEM_START_ISO ? r : SYSTEM_START_ISO;
      };
      const sumMap = (m: Map<number, number>) => Array.from(m.values()).reduce((s, v) => s + v, 0);
      /** Остаток по филиалам = накопленное − раскиданное списание (∝ накопленному; при нулевом
       *  накоплении делим поровну). Сумма остатков по филиалам = накоплено − списано. */
      const netByBranchOf = (accByBranch: Map<number, number>, spent: number): Map<number, number> => {
        const net = new Map<number, number>();
        const accTotal = sumMap(accByBranch);
        if (accTotal > 0) {
          for (const [bid, acc] of accByBranch) net.set(bid, acc - spent * (acc / accTotal));
        } else {
          for (const bid of BRANCH_IDS) net.set(bid, -(spent / BRANCH_IDS.length));
        }
        return net;
      };
      const frameNetByBranch = netByBranchOf(frameAccByBranch, spentByBox.get('frames') ?? 0);
      const lensNetByBranch = netByBranchOf(lensAccByBranch, spentByBox.get('lenses') ?? 0);
      const consSubNet = new Map<string, Map<number, number>>(); // подвид → филиал → остаток
      const consSubAccTotal = new Map<string, number>();          // подвид → накоплено (сеть)
      for (const sub of allSubs) {
        const accBy = new Map<number, number>();
        for (const bid of BRANCH_IDS) accBy.set(bid, consSubAccByBranch.get(bid)?.get(sub) ?? 0);
        consSubAccTotal.set(sub, sumMap(accBy));
        consSubNet.set(sub, netByBranchOf(accBy, spentByBox.get(`consumable:${sub}`) ?? 0));
      }

      /* 6. Окно периода для выручки/зарплаты (помесячно, от cogsReset). Себестоимость коробок
         сюда НЕ входит — она накопительная и приходит из budget_box_accruals (см. секцию 5). */
      const periodStart = cogsReset;
      const tomorrowISO = ymd(new Date(today.getTime() + 24 * 3600 * 1000));

      /* 7. Налоги: ставка месяца оплаты (обычная/квартальная) — для строки «ближайшая оплата». */
      const taxCyc = dueCycle(today, TAX_DUE_DAY, 1);
      const taxMonthlyPerBranch = isQuarterTaxMonth(taxCyc.dueDate.getUTCMonth()) ? taxQuarter : taxNormal;

      /* 8. (Остаток коробок по филиалам = накоплено − списано — посчитано в секции 5.) */

      /* 9. Взнос каждого филиала = аренда + налог + остаток коробок (cogs) */
      const contribOf = (branchId: number): BranchContribution => {
        const name = BRANCH_NAME.get(branchId) ?? `#${branchId}`;
        const rentRate = rentRateByBranch.get(branchId) ?? 0;
        // Аренда копится монотонно с запуска; уходит только при ручной оплате (rent:<branch>).
        const rent = accruedMonthlySince(fixedStart(`rent:${branchId}`), today, () => rentRate * 30) - (spentByBox.get(`rent:${branchId}`) ?? 0);
        const tax = 0; // налоги — отдельная сетевая коробка, по филиалам не разносим
        // Остаток коробок по филиалу (накоплено − раскиданное списание). Не округляем здесь:
        // суммы по филиалам должны сходиться к сетевому остатку; округление — только при выводе.
        const frames = frameNetByBranch.get(branchId) ?? 0;
        const lenses = lensNetByBranch.get(branchId) ?? 0;
        let consumables = 0;
        const consumableSubs: { name: string; amount: number }[] = [];
        for (const sub of allSubs) {
          const v = consSubNet.get(sub)?.get(branchId) ?? 0;
          consumables += v;
          if (Math.abs(v) >= 0.5) consumableSubs.push({ name: sub, amount: v });
        }
        consumableSubs.sort((a, b) => b.amount - a.amount);
        const cogsParts = { frames, lenses, consumables };
        const cogs = frames + lenses + consumables;
        return {
          branchId,
          name,
          isNew: NEW_BRANCH_IDS.has(branchId),
          rent,
          tax,
          cogs,
          cogsParts,
          consumableSubs,
          total: rent + tax + cogs,
          ordersCount: ordersCountByBranch.get(branchId) ?? 0,
        };
      };

      /* 10. Выручка = ДЕНЬГИ, ПОЛУЧЕННЫЕ за период (оплаты по дате в TZ Бишкека), не сумма заказов.
         Так картина денежная: учитываются доплаты за старые заказы, а неоплаченное — не считается. */
      const { data: payRev, error: payRevErr } = await supabase
        .from('payments')
        .select('amount, orders!inner(branch_id)')
        .in('orders.branch_id', BRANCH_IDS)
        .gte('created_at', bishkekMidnightUtcISO(periodStart))
        .lt('created_at', bishkekMidnightUtcISO(tomorrowISO));
      if (payRevErr) console.warn('[budget] payments revenue error', payRevErr);
      const revenueByBranch = new Map<number, number>();
      for (const p of payRev ?? []) {
        const bid = Number((p as any).orders?.branch_id);
        if (!bid) continue;
        revenueByBranch.set(bid, (revenueByBranch.get(bid) ?? 0) + (Number((p as any).amount) || 0));
      }
      // Зарплата по филиалам для котла/бюджетов (период страницы). Работа мастера и чистая
      // прибыль считаются отдельно — через RPC budget_period_summary с выбором периода.
      const { data: payRows, error: payErr } = await supabase
        .from('v_payroll_daily')
        .select('day, net_day, branch_id')
        .gte('day', periodStart)
        .lte('day', todayISO)
        .in('branch_id', BRANCH_IDS);
      if (payErr) throw payErr;
      const payrollByBranch = new Map<number, number>();
      for (const r of payRows ?? []) {
        const bid = (r as any).branch_id as number;
        const amt = Number((r as any).net_day) || 0;
        payrollByBranch.set(bid, (payrollByBranch.get(bid) ?? 0) + amt);
      }

      /* 11. Бюджеты */
      const budgetViews: BudgetView[] = BUDGETS.map((b) => {
        const branches = b.branchIds.map(contribOf);
        return {
          key: b.key,
          title: b.title,
          owner: b.owner,
          accent: b.accent,
          branches,
          total: branches.reduce((s, x) => s + x.total, 0),
          revenue: b.branchIds.reduce((s, id) => s + (revenueByBranch.get(id) ?? 0), 0),
          payroll: b.branchIds.reduce((s, id) => s + (payrollByBranch.get(id) ?? 0), 0),
        };
      });

      /* 12. Сроки оплаты (dueCycle — ТОЛЬКО для подписи «к N числа», без автосписания). */
      const autoCyc = dueCycle(today, CREDIT_AUTO_DUE_DAY, creditAutoAmt);
      const personalCyc = dueCycle(today, CREDIT_PERSONAL_DUE_DAY, creditPersonalAmt);

      /* 11b. Коробки по категориям + доли «Мои»/«Мама».
         Постоянные платежи (аренда/налоги/кредиты) копятся МОНОТОННО с запуска и уходят
         только при ручной оплате — никакого автосписания по дате. */
      const mineIds = new Set<number>(BUDGETS[0].branchIds); // Кант + Токмок

      // ── Аренда: по филиалам, оплата каждого отдельно (как кредиты) ──
      const rentSubBoxes: CategoryBox[] = BRANCH_IDS
        .filter((bid) => (rentRateByBranch.get(bid) ?? 0) > 0)
        .map((bid) => {
          const monthly = (rentRateByBranch.get(bid) ?? 0) * 30;
          const accrued = accruedMonthlySince(fixedStart(`rent:${bid}`), today, () => monthly);
          const spent = spentByBox.get(`rent:${bid}`) ?? 0;
          const total = accrued - spent;
          const dueDay = RENT_DUE_DAY[bid] ?? 1;
          const dd = dueCycle(today, dueDay, 1).dueDate;
          const mine = mineIds.has(bid) ? total : 0;
          return {
            key: `rent:${bid}`, title: BRANCH_NAME.get(bid) ?? `#${bid}`, icon: Home,
            total, mine, mama: total - mine, rows: [], tone: 'op' as const, group: 'fixed' as const,
            hint: `к ${dueDay} ${monthGenitive(dd.getUTCMonth())}`, target: monthly,
            spend: { spendKey: `rent:${bid}`, accrued, spent, balance: total },
          };
        })
        .sort((a, z) => z.total - a.total);
      const rentBox: CategoryBox = {
        key: 'rent', title: 'Аренда', icon: Home, tone: 'op', group: 'fixed', rows: [],
        total: rentSubBoxes.reduce((s, b) => s + b.total, 0),
        mine: rentSubBoxes.reduce((s, b) => s + b.mine, 0),
        mama: rentSubBoxes.reduce((s, b) => s + b.mama, 0),
        spend: {
          spendKey: '',
          accrued: rentSubBoxes.reduce((s, b) => s + (b.spend?.accrued ?? 0), 0),
          spent: rentSubBoxes.reduce((s, b) => s + (b.spend?.spent ?? 0), 0),
          balance: rentSubBoxes.reduce((s, b) => s + b.total, 0),
        },
        subBoxes: rentSubBoxes,
      };

      // ── Налоги: одна сетевая коробка (3000/мес, 5000 в квартальный месяц × филиалы) ──
      const taxMonthlyNet = (_y: number, m: number) => (isQuarterTaxMonth(m) ? taxQuarter : taxNormal) * BRANCH_IDS.length;
      const taxAccrued = accruedMonthlySince(fixedStart('taxes'), today, taxMonthlyNet);
      const taxSpent = spentByBox.get('taxes') ?? 0;
      const taxTotal = taxAccrued - taxSpent;
      const taxMineFrac = mineIds.size / BRANCH_IDS.length; // налог поровну по филиалам
      const taxBox: CategoryBox = {
        key: 'tax', title: 'Налоги', icon: Landmark, tone: 'op', group: 'fixed', rows: [],
        total: taxTotal, mine: taxTotal * taxMineFrac, mama: taxTotal * (1 - taxMineFrac),
        hint: `к ${TAX_DUE_DAY} ${monthGenitive(taxCyc.dueDate.getUTCMonth())}`,
        target: taxMonthlyNet(today.getUTCFullYear(), today.getUTCMonth()),
        spend: { spendKey: 'taxes', accrued: taxAccrued, spent: taxSpent, balance: taxTotal },
      };

      // ── Кредиты: Авто/Личный, монотонно, оплата по каждому ──
      const creditSubBox = (
        spendKey: string, title: string, icon: React.ElementType, monthly: number,
        cyc: ReturnType<typeof dueCycle>, dueDay: number,
      ): CategoryBox => {
        const accrued = accruedMonthlySince(fixedStart(spendKey), today, () => monthly);
        const spent = spentByBox.get(spendKey) ?? 0;
        const total = accrued - spent;
        return {
          key: spendKey, title, icon, total, mine: total / 2, mama: total / 2, rows: [], tone: 'credit', group: 'fixed',
          hint: `к ${dueDay} ${monthGenitive(cyc.dueDate.getUTCMonth())}`, target: monthly,
          spend: { spendKey, accrued, spent, balance: total },
        };
      };
      const autoSubBox = creditSubBox('credit_auto', 'Авто', Car, creditAutoAmt, autoCyc, CREDIT_AUTO_DUE_DAY);
      const personalSubBox = creditSubBox('credit_personal', 'Личный', CreditCardIcon, creditPersonalAmt, personalCyc, CREDIT_PERSONAL_DUE_DAY);
      const creditsBox: CategoryBox = {
        key: 'credits', title: 'Кредиты', icon: Car, tone: 'credit', group: 'fixed', rows: [],
        total: autoSubBox.total + personalSubBox.total,
        mine: autoSubBox.mine + personalSubBox.mine,
        mama: autoSubBox.mama + personalSubBox.mama,
        spend: {
          spendKey: '',
          accrued: (autoSubBox.spend?.accrued ?? 0) + (personalSubBox.spend?.accrued ?? 0),
          spent: (autoSubBox.spend?.spent ?? 0) + (personalSubBox.spend?.spent ?? 0),
          balance: autoSubBox.total + personalSubBox.total,
        },
        subBoxes: [autoSubBox, personalSubBox],
      };

      // ── Товарные резервы (накопительные): остаток = накоплено − закуплено, может уйти в минус ──
      const spendBox = (
        key: string, title: string, icon: React.ElementType, spendKey: string,
        netByBranch: Map<number, number>, accruedTotal: number,
      ): CategoryBox => {
        const spent = spentByBox.get(spendKey) ?? 0;
        const total = accruedTotal - spent;
        let mine = 0;
        for (const bid of BRANCH_IDS) if (mineIds.has(bid)) mine += netByBranch.get(bid) ?? 0;
        return {
          key, title, icon, total, mine, mama: total - mine, rows: [], tone: 'op', group: 'goods',
          spend: { spendKey, accrued: accruedTotal, spent, balance: total },
        };
      };

      const framesBox = spendBox('frames', 'Оправы', Glasses, 'frames', frameNetByBranch, sumMap(frameAccByBranch));
      const lensesBox = spendBox('lenses', 'Линзы', Eye, 'lenses', lensNetByBranch, sumMap(lensAccByBranch));
      const consSubBoxes: CategoryBox[] = Array.from(allSubs)
        .map((sub) => spendBox(`consumable:${sub}`, sub, PackageOpen, `consumable:${sub}`,
          consSubNet.get(sub)!, consSubAccTotal.get(sub) ?? 0))
        .sort((a, z) => z.total - a.total);
      const consumablesBox: CategoryBox = {
        key: 'consumables', title: 'Расходники', icon: PackageOpen, tone: 'op', group: 'goods', rows: [],
        total: consSubBoxes.reduce((s, b) => s + b.total, 0),
        mine: consSubBoxes.reduce((s, b) => s + b.mine, 0),
        mama: consSubBoxes.reduce((s, b) => s + b.mama, 0),
        spend: {
          spendKey: '',
          accrued: consSubBoxes.reduce((s, b) => s + (b.spend?.accrued ?? 0), 0),
          spent: consSubBoxes.reduce((s, b) => s + (b.spend?.spent ?? 0), 0),
          balance: consSubBoxes.reduce((s, b) => s + b.total, 0),
        },
        subBoxes: consSubBoxes,
      };

      const categoryBoxesArr: CategoryBox[] = [rentBox, taxBox, creditsBox, framesBox, lensesBox, consumablesBox];

      /* 11c. «Сколько занести в котёл с прошлого пополнения» = накоплено (ВАЛОВО, монотонно) −
         уже переведено. Накопленное берём до оплат: оплата гасит и резерв, и карту одинаково,
         поэтому «сколько занести» от оплат не зависит. Нажал «Перевёл» → переведено растёт → сумма падает. */
      const transferredByPerson: Record<string, number> = { A: 0, B: 0 };
      for (const t of transfersR.data ?? []) {
        const p = String((t as any).person);
        if (p === 'A' || p === 'B') transferredByPerson[p] += Number((t as any).amount) || 0;
      }
      const consAccOf = (bid: number) => {
        const m = consSubAccByBranch.get(bid);
        return m ? Array.from(m.values()).reduce((s, v) => s + v, 0) : 0;
      };
      /* Корректировки начисления (is_correction) уменьшают и «занести в котёл»: обязательства
         не было, значит и финансировать переводом нечего. Обычный закуп так НЕ работает —
         он гасит коробку, но деньги на карту всё равно нужны. Раскладываем так же, как
         списания: товарные коробки — пропорционально накопленному, аренда — на свой филиал,
         налоги и кредиты — на уровне бюджета. */
      const correctionByBranch = new Map<number, number>();
      const spreadCorrection = (key: string, accBy: Map<number, number>) => {
        const corr = correctionByBox.get(key) ?? 0;
        if (!corr) return;
        const accTotal = sumMap(accBy);
        for (const bid of BRANCH_IDS) {
          const share = accTotal > 0 ? (accBy.get(bid) ?? 0) / accTotal : 1 / BRANCH_IDS.length;
          correctionByBranch.set(bid, (correctionByBranch.get(bid) ?? 0) + corr * share);
        }
      };
      spreadCorrection('frames', frameAccByBranch);
      spreadCorrection('lenses', lensAccByBranch);
      for (const sub of allSubs) {
        const accBy = new Map<number, number>();
        for (const bid of BRANCH_IDS) accBy.set(bid, consSubAccByBranch.get(bid)?.get(sub) ?? 0);
        spreadCorrection(`consumable:${sub}`, accBy);
      }
      for (const bid of BRANCH_IDS) {
        const corr = correctionByBox.get(`rent:${bid}`) ?? 0;
        if (corr) correctionByBranch.set(bid, (correctionByBranch.get(bid) ?? 0) + corr);
      }
      const taxCorrection = correctionByBox.get('taxes') ?? 0;
      const creditCorrection =
        (correctionByBox.get('credit_auto') ?? 0) + (correctionByBox.get('credit_personal') ?? 0);
      // ВАЖНО: «сколько занести» считаем по МОНОТОННОМУ накоплению с запуска системы
      // (SYSTEM_START), а НЕ по датам оплат. Оплата гасит долг, но не отменяет, что
      // обязательство накопилось и его надо профинансировать переводами. Если брать
      // начисление «с даты оплаты», сумма «занести» падала бы при каждой оплате — неверно.
      const rentMonoByBranch = new Map<number, number>();
      for (const bid of BRANCH_IDS) {
        const monthly = (rentRateByBranch.get(bid) ?? 0) * 30;
        rentMonoByBranch.set(bid, accruedMonthlySince(SYSTEM_START_ISO, today, () => monthly));
      }
      const taxMono = accruedMonthlySince(SYSTEM_START_ISO, today, taxMonthlyNet);
      const autoMono = accruedMonthlySince(SYSTEM_START_ISO, today, () => creditAutoAmt);
      const personalMono = accruedMonthlySince(SYSTEM_START_ISO, today, () => creditPersonalAmt);
      const personAccrued = (ids: readonly number[]) => {
        let total = 0;
        for (const bid of ids) {
          total += (rentMonoByBranch.get(bid) ?? 0)
            + (frameAccByBranch.get(bid) ?? 0) + (lensAccByBranch.get(bid) ?? 0) + consAccOf(bid)
            - (correctionByBranch.get(bid) ?? 0);
        }
        total += (taxMono - taxCorrection) * (ids.length / BRANCH_IDS.length); // налог поровну по филиалам
        total += (autoMono + personalMono - creditCorrection) / 2; // кредиты 50/50
        return Math.max(0, Math.round(total));
      };
      const cardPersonOf = (key: 'A' | 'B', ids: readonly number[]): CardPerson => {
        const accrued = personAccrued(ids);
        const transferred = Math.round(transferredByPerson[key]);
        return { accrued, transferred, toTransfer: Math.max(0, accrued - transferred) };
      };
      const cardState: CardState = {
        A: cardPersonOf('A', BUDGETS[0].branchIds),
        B: cardPersonOf('B', BUDGETS[1].branchIds),
      };

      /* 11d. Ближайшая оплата (по фиксированным срокам: кредиты, аренда Канта, налоги) */
      const paymentDefs = [
        { label: 'Личный кредит', amount: creditPersonalAmt, dueDay: CREDIT_PERSONAL_DUE_DAY },
        { label: 'Кредит авто',   amount: creditAutoAmt,     dueDay: CREDIT_AUTO_DUE_DAY },
        { label: 'Аренда Кант',   amount: (rentRateByBranch.get(4) ?? 0) * 30, dueDay: RENT_DUE_DAY[4] ?? 1 },
        { label: 'Налоги',        amount: taxMonthlyPerBranch * BRANCH_IDS.length, dueDay: TAX_DUE_DAY },
      ].filter((p) => p.amount > 0);
      const upcoming = paymentDefs
        .map((p) => { const c = dueCycle(today, p.dueDay, p.amount); return { ...p, daysLeft: c.daysLeft, dueDate: c.dueDate }; })
        .sort((a, b) => a.daysLeft - b.daysLeft);
      let nextPayVal: NextPayment | null = null;
      if (upcoming.length > 0) {
        const d0 = upcoming[0].daysLeft;
        const grp = upcoming.filter((p) => p.daysLeft === d0); // всё, что платится в один ближайший день
        const dd = upcoming[0].dueDate;
        nextPayVal = {
          daysLeft: d0,
          dueLabel: `${dd.getUTCDate()} ${monthGenitive(dd.getUTCMonth())}`,
          items: grp.map((p) => ({ label: p.label, amount: p.amount })),
        };
      }

      /* 13. Итоги: «в котле должно быть» = сумма остатков всех коробок. */
      const grandTotal = categoryBoxesArr.reduce((s, b) => s + b.total, 0);
      const creditsSum = creditsBox.total;
      const branchesSum = grandTotal - creditsSum;
      const revenue = budgetViews.reduce((s, b) => s + b.revenue, 0);
      const payroll = budgetViews.reduce((s, b) => s + b.payroll, 0);

      /* «Свободные деньги» — ЧЕСТНО за период: выручка − обязательства, начисленные за ЭТОТ ЖЕ
         период (поток, без «авансов» циклов) − зарплата. Иначе в начале месяца ложный дефицит. */
      const daysInPeriod = daysBetweenInclusive(periodStart, today);
      const rentDailyAll = Array.from(rentRateByBranch.values()).reduce((s, r) => s + r, 0); // daily_rate = аренда/день
      const periodRent   = rentDailyAll * daysInPeriod;
      const periodTax    = (taxMonthlyPerBranch * BRANCH_IDS.length / 30) * daysInPeriod;
      const periodCredit = ((creditAutoAmt + creditPersonalAmt) / 30) * daysInPeriod;
      const periodCogs   = budgetViews.reduce((s, bv) => s + bv.branches.reduce((ss, b) => ss + b.cogs, 0), 0);
      const expenses     = Math.round(periodRent + periodTax + periodCredit + periodCogs);

      setBudgets(budgetViews);
      setCategoryBoxes(categoryBoxesArr);
      setCard(cardState);
      setNextPay(nextPayVal);
      setTotals({
        branchesSum,
        creditsSum,
        grandTotal,
        revenue,
        payroll,
        expenses,
        free: revenue - expenses - payroll,
        fromISO: periodStart,
      });
    } catch (e: any) {
      console.error('[budget] load error', e);
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [today, todayISO]);

  useEffect(() => { void load(); }, [load]);

  // P&L за выбранный период (через RPC budget_period_summary — серверная агрегация, без лимита строк).
  const fetchSummary = useCallback(async (period: PeriodKey): Promise<SummaryRow | null> => {
    const { fromISO, toISO } = calendarRange(period, today);
    const { data, error } = await supabase.rpc('budget_period_summary', {
      from_dt: fromISO,
      to_dt: toISO,
      branch_ids: BRANCH_IDS,
    });
    if (error) { console.warn('[budget] budget_period_summary error', error); return null; }
    const row: any = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const num = (v: any) => Number(v) || 0;
    return {
      revenue: num(row.revenue),
      refunds: num(row.refunds),
      cogs_total: num(row.cogs_total),
      cogs_frames: num(row.cogs_frames),
      cogs_lenses: num(row.cogs_lenses),
      cogs_cons: num(row.cogs_cons),
      opex_total: num(row.opex_total),
      opex_rent: num(row.opex_rent),
      opex_utilities: num(row.opex_utilities),
      opex_tax: num(row.opex_tax),
      opex_manual: num(row.opex_manual),
      payroll_total: num(row.payroll_total),
      net_profit: num(row.net_profit),
      n_days: Number(row.n_days) || 0,
    };
  }, [today]);

  useEffect(() => {
    let alive = true;
    setProfitBusy(true);
    void fetchSummary(profitPeriod).then((r) => { if (alive) { setProfitData(r); setProfitBusy(false); } });
    return () => { alive = false; };
  }, [profitPeriod, fetchSummary]);

  async function recordTransfer(person: 'A' | 'B', amount: number): Promise<boolean> {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const { error } = await supabase.from('budget_card_transfers').insert({ person, amount: Math.round(amount) });
    if (error) { alert(`Не удалось записать перевод: ${error.message}`); return false; }
    await load();
    return true;
  }

  return (
    <div className="text-slate-50">
      {/* Header */}
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
            <Wallet className="h-5 w-5 text-teal-300" />
          </div>
          <div>
            <div className="text-[21px] font-semibold tracking-tight text-white">Накопления</div>
            <div className="mt-0.5 text-[12px] text-slate-400">{formatDateRu(todayISO)} · сегодня</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3.5 py-2 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white disabled:opacity-50 transition"
        >
          <RefreshCw className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} />
          Обновить
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3">
          <div className="text-sm font-semibold text-rose-700">Ошибка</div>
          <div className="mt-1 text-xs text-slate-600">{err}</div>
        </div>
      )}

      {todayISO < SYSTEM_START_ISO && (
        <div className="mb-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3">
          <div className="text-sm font-semibold text-amber-800">
            Система запускается {formatDateRu(SYSTEM_START_ISO)}
          </div>
          <div className="mt-0.5 text-xs text-amber-700">
            До этой даты копилки = 0. После старта начнут копиться по правилам.
          </div>
        </div>
      )}

      {!loading && totals && card && (
        <PersonHero
          card={card}
          totals={totals}
          nextPay={nextPay}
          onOpen={(person, suggest) =>
            setTransferTarget({ person, label: person === 'A' ? 'Я · Мои' : 'Мама', suggest })
          }
        />
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          <SectionLabel>Постоянные платежи · копим к дате оплаты</SectionLabel>
          <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {categoryBoxes.filter((b) => b.group === 'fixed').map((box) => (
              <CategoryCard key={box.key} box={box} onSpend={(k, t, s) => setSpendTarget({ spendKey: k, title: t, suggest: s })} />
            ))}
          </div>

          <SectionLabel tone="price">Товарные резервы · копим с продаж, тратим на закупку</SectionLabel>
          <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {categoryBoxes.filter((b) => b.group === 'goods').map((box) => (
              <CategoryCard key={box.key} box={box} onSpend={(k, t, s) => setSpendTarget({ spendKey: k, title: t, suggest: s })} />
            ))}
          </div>

          <BranchSummary budgets={budgets} />
        </>
      )}

      {!loading && (
        <ProfitPanel data={profitData} period={profitPeriod} onPeriod={setProfitPeriod} busy={profitBusy} today={today} />
      )}

      {spendTarget && (
        <SpendModal
          spendKey={spendTarget.spendKey}
          title={spendTarget.title}
          suggest={spendTarget.suggest}
          onClose={() => setSpendTarget(null)}
          onChanged={() => { void load(); }}
        />
      )}

      {transferTarget && (
        <TransferModal
          label={transferTarget.label}
          suggest={transferTarget.suggest}
          onClose={() => setTransferTarget(null)}
          onConfirm={(amount) => recordTransfer(transferTarget.person, amount)}
        />
      )}
    </div>
  );
}

/* ============ HERO: сколько скинуть Я / Мама ============ */

function PersonHero({ card, totals, nextPay, onOpen }: {
  card: CardState;
  totals: Totals;
  nextPay: NextPayment | null;
  onOpen: (person: 'A' | 'B', suggest: number) => void;
}) {
  return (
    <div className="relative mb-8 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 shadow-[0_1px_3px_rgba(2,6,23,0.04),0_24px_48px_-28px_rgba(2,6,23,0.28)]">
      <div className="brand-gradient h-1.5" />
      <div className="relative px-6 py-6 md:px-8 md:py-7">
        <div className="inline-block text-[11px] font-semibold uppercase tracking-[0.2em] brand-text-gradient">
          Занести в котёл с прошлого пополнения
        </div>

        {/* Мои | КОТЁЛ | Мама — котёл крупной цифрой по центру */}
        <div className="mt-4 grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
          <TransferCard title="Я · Мои" subtitle="Кант + Токмок" person="A" data={card.A} accent="cyan" onOpen={onOpen} />

          <div className="flex flex-col items-center justify-center px-2 py-3 text-center md:px-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">В общем котле должно быть</div>
            <div className="mt-1.5 inline-block text-5xl md:text-6xl font-extrabold tabular-nums leading-none tracking-tight brand-text-gradient">
              {nf.format(Math.round(totals.grandTotal))}
            </div>
            <div className="mt-2 text-[11px] font-medium text-slate-400">сом · должно быть отложено</div>
          </div>

          <TransferCard title="Мама" subtitle="Сокулук + Беловодск + Кара-Балта" person="B" data={card.B} accent="emerald" onOpen={onOpen} />
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-200/70">
          Слева/справа — сколько занести в котёл с прошлого пополнения (накоплено − уже переведено). По центру — сколько всего должно быть отложено под обязательства (резервы за вычетом оплат).
        </div>

        {nextPay && (
          <div className="mt-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200/70 px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ближайшая оплата</span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/70">
                {nextPay.daysLeft === 0 ? 'сегодня' : `через ${nextPay.daysLeft} ${pluralDays(nextPay.daysLeft)}`} · {nextPay.dueLabel}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-stretch justify-center gap-2">
              {nextPay.items.map((it) => (
                <div key={it.label} className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2 text-center">
                  <div className="text-[11px] font-medium text-slate-400">{it.label}</div>
                  <div className="text-base font-semibold tabular-nums text-slate-900">{nf.format(Math.round(it.amount))} сом</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PERSON_ACCENT: Record<string, { dot: string; bg: string; ring: string; amt: string }> = {
  cyan:    { dot: 'bg-cyan-500',    bg: 'bg-gradient-to-br from-cyan-50 to-sky-50/60',     ring: 'ring-cyan-100',    amt: 'text-cyan-700' },
  emerald: { dot: 'bg-emerald-500', bg: 'bg-gradient-to-br from-emerald-50 to-teal-50/60', ring: 'ring-emerald-100', amt: 'text-emerald-700' },
};

function TransferCard({ title, subtitle, person, data, accent, onOpen }: {
  title: string;
  subtitle: string;
  person: 'A' | 'B';
  data: CardPerson;
  accent: 'cyan' | 'emerald';
  onOpen: (person: 'A' | 'B', suggest: number) => void;
}) {
  const a = PERSON_ACCENT[accent];
  return (
    <div className={`rounded-2xl ${a.bg} ring-1 ${a.ring} px-5 py-4`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${a.dot}`} />
          <div className="text-[13px] font-bold text-slate-700">{title}</div>
        </div>
        <div className="text-[10px] text-slate-400">из {nf.format(data.accrued)} накоплено</div>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`text-4xl md:text-5xl font-bold tabular-nums leading-none ${a.amt}`}>{nf.format(data.toTransfer)}</span>
        <span className="text-base font-medium text-slate-400">сом</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{subtitle} · занести с прошлого пополнения</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onOpen(person, data.toTransfer)}
          disabled={data.toTransfer <= 0}
          className="brand-gradient inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-[0_4px_14px_rgba(34,211,238,0.30)] transition hover:opacity-90 disabled:opacity-40"
        >
          ✓ Перевёл {nf.format(data.toTransfer)}
        </button>
        <button
          type="button"
          onClick={() => onOpen(person, data.toTransfer)}
          className="rounded-lg bg-white/70 px-2.5 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200 transition hover:bg-white"
        >
          другая сумма
        </button>
      </div>
      {data.transferred > 0 && (
        <div className="mt-2 text-[11px] text-slate-400">Уже переведено: {nf.format(data.transferred)} сом</div>
      )}
    </div>
  );
}

/* ============ Коробка категории ============ */

// Брендовые градиенты для иконок-плашек: платежи — фирменный teal→cyan→sky,
// товарные резервы — «денежный» teal→emerald→green (как .price-grad).
const BRAND_TILE = 'bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-[0_4px_14px_rgba(34,211,238,0.30)]';
const GOODS_TILE = 'bg-gradient-to-br from-teal-400 via-emerald-400 to-green-400 shadow-[0_4px_14px_rgba(16,185,129,0.30)]';

const CARD_CLS =
  'rounded-2xl bg-white ring-1 ring-slate-200/70 shadow-[0_1px_3px_rgba(2,6,23,0.04),0_18px_40px_-26px_rgba(2,6,23,0.22)] transition-shadow duration-200 hover:shadow-[0_1px_3px_rgba(2,6,23,0.05),0_26px_50px_-28px_rgba(2,6,23,0.30)]';

function SectionLabel({ children, tone = 'brand' }: { children: React.ReactNode; tone?: 'brand' | 'price' }) {
  return (
    <div className={`mb-3 inline-block text-[11px] font-semibold uppercase tracking-[0.2em] ${tone === 'price' ? 'price-text-gradient' : 'brand-text-gradient'}`}>
      {children}
    </div>
  );
}

function CategoryCard({ box, onSpend }: {
  box: CategoryBox;
  onSpend: (spendKey: string, title: string, suggest: number) => void;
}) {
  const Icon = box.icon;
  const goods = box.group === 'goods';
  const neg = box.total < 0;
  const amountColor = neg ? 'text-rose-600' : 'text-slate-900';
  const subLabel = box.spend
    ? (goods ? (neg ? 'в минусе' : 'остаток') : (box.total > 0 ? 'к оплате' : 'оплачено'))
    : (box.subBoxes ? (goods ? 'всего остаток' : 'всего к оплате') : 'в коробочку');
  const accruedLabel = goods ? 'Накоплено' : 'Начислено';
  const spentLabel = goods ? 'Закуплено' : 'Оплачено';
  const actionLabel = goods ? 'Закупить' : 'Оплатить';

  return (
    <div className={CARD_CLS}>
      <div className="px-5 pt-5 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={`grid h-10 w-10 place-items-center rounded-xl ${goods ? GOODS_TILE : BRAND_TILE}`}>
              <Icon className="h-5 w-5 text-white" />
            </span>
            <div>
              <div className="text-[15px] font-semibold tracking-tight text-slate-900">{box.title}</div>
              {box.hint && <div className="text-[11px] text-slate-400">{box.hint}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-3xl md:text-[34px] font-bold tabular-nums leading-none ${amountColor}`}>
              {nf.format(Math.round(box.total))}<span className="ml-1 text-sm font-medium text-slate-400">сом</span>
            </div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{subLabel}</div>
          </div>
        </div>

        {box.spend && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-slate-500">
              {accruedLabel} <b className="font-semibold tabular-nums text-slate-700">{nf.format(Math.round(box.spend.accrued))}</b>
              <span className="text-slate-300"> · </span>{spentLabel} <b className="font-semibold tabular-nums text-slate-700">{nf.format(Math.round(box.spend.spent))}</b>
            </div>
            {box.spend.spendKey && (
              <button
                type="button"
                onClick={() => onSpend(box.spend!.spendKey, box.title, Math.max(0, Math.round(box.spend!.balance)))}
                className="brand-gradient inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-[0_4px_14px_rgba(34,211,238,0.30)] transition hover:opacity-90"
              >
                {actionLabel}
              </button>
            )}
          </div>
        )}

        {goods && neg && box.spend?.spendKey && (
          <div className="mt-2.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-600 ring-1 ring-rose-100">
            В минусе на {nf.format(Math.abs(Math.round(box.total)))} сом — добьётся с продаж, следующую партию закажи позже.
          </div>
        )}

        {box.target && box.target > 0 && !box.subBoxes && (
          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70">
              <div className="h-full rounded-full brand-gradient" style={{ width: `${Math.max(0, Math.min(100, Math.round((box.total / box.target) * 100)))}%` }} />
            </div>
            <span className={`shrink-0 text-right text-[10px] font-semibold ${box.total >= box.target ? 'text-amber-600' : 'tabular-nums text-slate-400'}`}>{box.total >= box.target ? 'пора платить' : `${Math.max(0, Math.round((box.total / box.target) * 100))}%`}</span>
          </div>
        )}

        {/* Доли Мои / Мама */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-cyan-50/70 px-3.5 py-2.5 ring-1 ring-cyan-100">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700">Мои</span>
            </div>
            <div className="mt-0.5 text-[15px] font-bold tabular-nums text-cyan-700">{nf.format(Math.round(box.mine))}</div>
          </div>
          <div className="rounded-xl bg-emerald-50/70 px-3.5 py-2.5 ring-1 ring-emerald-100">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Мама</span>
            </div>
            <div className="mt-0.5 text-[15px] font-bold tabular-nums text-emerald-700">{nf.format(Math.round(box.mama))}</div>
          </div>
        </div>

        {/* Подкоробочки (кредиты Авто/Личный, подвиды расходников) — всегда видны */}
        {box.subBoxes && box.subBoxes.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            {box.subBoxes.map((sb) => <MiniSpendBox key={sb.key} box={sb} onSpend={onSpend} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ Мини-коробочка (подвид расходника / кредит) ============ */

function MiniSpendBox({ box, onSpend }: {
  box: CategoryBox;
  onSpend: (spendKey: string, title: string, suggest: number) => void;
}) {
  const goods = box.group === 'goods';
  const neg = box.total < 0;
  const sp = box.spend!;
  const accruedLabel = goods ? 'Накоплено' : 'Начислено';
  const spentLabel = goods ? 'Закуплено' : 'Оплачено';
  const subLabel = goods ? (neg ? 'в минусе' : 'остаток') : (box.total > 0 ? 'к оплате' : 'оплачено');
  const pct = box.target && box.target > 0 ? Math.round((box.total / box.target) * 100) : null;
  return (
    <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-800">
            {box.title}{box.hint && <span className="ml-1.5 text-[10px] font-normal text-slate-400">{box.hint}</span>}
          </div>
          <div className="text-[10px] text-slate-400">
            {accruedLabel} {nf.format(Math.round(sp.accrued))} · {spentLabel} {nf.format(Math.round(sp.spent))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className={`text-base font-semibold tabular-nums ${neg ? 'text-rose-600' : 'text-slate-900'}`}>{nf.format(Math.round(box.total))}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{subLabel}</div>
          </div>
          <button
            type="button"
            onClick={() => onSpend(sp.spendKey, box.title, Math.max(0, Math.round(box.total)))}
            className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
          >
            {goods ? 'Списать' : 'Оплатить'}
          </button>
        </div>
      </div>
      {pct !== null && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70">
            <div className="h-full rounded-full brand-gradient" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
          <span className={`shrink-0 text-right text-[9px] font-semibold ${pct >= 100 ? 'text-amber-600' : 'tabular-nums text-slate-400'}`}>{pct >= 100 ? 'пора платить' : `${Math.max(0, pct)}%`}</span>
        </div>
      )}
    </div>
  );
}

/* ============ Модалка списания (закупки) из коробочки ============ */

type SpendRow = { id: number; amount: number; spent_on: string; note: string | null };

function SpendModal({ spendKey, title, suggest, onClose, onChanged }: {
  spendKey: string;
  title: string;
  suggest: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => ymd(bishkekToday()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SpendRow[] | null>(null);

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from('budget_box_spends')
      .select('id, amount, spent_on, note')
      .eq('box_key', spendKey)
      .order('spent_on', { ascending: false })
      .order('id', { ascending: false });
    if (error) { setError(error.message); return; }
    setHistory((data ?? []) as SpendRow[]);
  }, [spendKey]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function add() {
    const n = Number(amount.replace(/[\s ,]/g, ''));
    if (!Number.isFinite(n) || n <= 0) { setError('Нужна положительная сумма'); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.from('budget_box_spends').insert({
      box_key: spendKey, amount: Math.round(n), spent_on: date, note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setAmount(''); setNote('');
    await loadHistory();
    onChanged();
  }

  async function remove(id: number) {
    if (!confirm('Удалить это списание? Остаток коробочки вернётся.')) return;
    const { error } = await supabase.from('budget_box_spends').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    await loadHistory();
    onChanged();
  }

  const total = (history ?? []).reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="brand-gradient h-1" />
        <div className="px-5 pt-5 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-block text-[11px] font-semibold uppercase tracking-[0.18em] brand-text-gradient">Списание</div>
              <div className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">{title}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-600"
            >
              ✕
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500">Сумма списания, сом</label>
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="напр. 75 000"
                className="mt-1 w-full rounded-xl bg-slate-50 px-3.5 py-2.5 text-base font-semibold tabular-nums text-slate-900 outline-none ring-1 ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-slate-900/15"
              />
              {suggest > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.round(suggest)))}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200"
                >
                  Вся сумма · {nf.format(Math.round(suggest))}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-500">Дата</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none ring-1 ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-slate-900/15"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500">Заметка</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="напр. 500 шт"
                  className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none ring-1 ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-slate-900/15"
                />
              </div>
            </div>
            {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-100">{error}</div>}
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              className="brand-gradient w-full rounded-xl px-4 py-2.5 text-sm font-semibold shadow-[0_6px_18px_rgba(34,211,238,0.30)] transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Сохраняю…' : 'Списать из коробочки'}
            </button>
            <div className="text-[11px] text-slate-400">
              Можно списать больше, чем в коробочке — остаток уйдёт в минус и восстановится с начислениями. На «Чистую прибыль» это не влияет.
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">История списаний</div>
              {total > 0 && <div className="text-[11px] text-slate-400">всего {nf.format(Math.round(total))} сом</div>}
            </div>
            {history === null ? (
              <div className="mt-2 text-xs text-slate-400">Загрузка…</div>
            ) : history.length === 0 ? (
              <div className="mt-2 text-xs text-slate-400">Пока ничего не списано.</div>
            ) : (
              <div className="mt-2 max-h-52 space-y-1.5 overflow-auto pr-1">
                {history.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50/70 px-3 py-2 ring-1 ring-slate-100">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold tabular-nums text-slate-800">{nf.format(Math.round(Number(r.amount)))} сом</div>
                      <div className="truncate text-[11px] text-slate-400">{formatDateRu(r.spent_on)}{r.note ? ` · ${r.note}` : ''}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void remove(r.id)}
                      className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-rose-500 transition hover:bg-rose-50"
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ Модалка перевода на карту ============ */

function TransferModal({ label, suggest, onClose, onConfirm }: {
  label: string;
  suggest: number;
  onClose: () => void;
  onConfirm: (amount: number) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState(suggest > 0 ? String(Math.round(suggest)) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const n = Number(amount.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n) || n <= 0) { setError('Нужна положительная сумма'); return; }
    setBusy(true); setError(null);
    const ok = await onConfirm(n);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="brand-gradient h-1" />
        <div className="px-5 pt-5 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-block text-[11px] font-semibold uppercase tracking-[0.18em] brand-text-gradient">Перевод на карту</div>
              <div className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">{label}</div>
            </div>
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-600">✕</button>
          </div>
          <div className="mt-4">
            <label className="text-[11px] font-semibold text-slate-500">Сумма перевода, сом</label>
            <input
              inputMode="numeric"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-xl bg-slate-50 px-3.5 py-2.5 text-base font-semibold tabular-nums text-slate-900 outline-none ring-1 ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-slate-900/15"
            />
            {suggest > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(Math.round(suggest)))}
                className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200"
              >
                Вся сумма · {nf.format(Math.round(suggest))}
              </button>
            )}
            {error && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-100">{error}</div>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="brand-gradient mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold shadow-[0_6px_18px_rgba(34,211,238,0.30)] transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Сохраняю…' : 'Записать перевод'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ По филиалам (мелкий итог) ============ */

function BranchSummary({ budgets }: { budgets: BudgetView[] }) {
  const all = budgets.flatMap((b) => b.branches.map((br) => ({ branch: br, accent: b.accent })));
  if (all.length === 0) return null;
  return (
    <section className="mb-2">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
        По филиалам · нажми, чтобы раскрыть
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {all.map(({ branch, accent }) => (
          <BranchSummaryCard key={branch.branchId} branch={branch} accent={accent} />
        ))}
      </div>
    </section>
  );
}

function BranchSummaryCard({ branch: b, accent }: { branch: BranchContribution; accent: 'cyan' | 'emerald' }) {
  const [open, setOpen] = useState(false);
  const dot = accent === 'cyan' ? 'bg-teal-500' : 'bg-indigo-400';
  const tone = 'text-slate-900';

  const rows: { label: string; amount: number; sub?: { label: string; amount: number }[] }[] = [
    { label: 'Аренда', amount: b.rent },
  ];
  if (b.cogsParts.frames > 0) rows.push({ label: 'Оправы', amount: b.cogsParts.frames });
  if (b.cogsParts.lenses > 0) rows.push({ label: 'Линзы', amount: b.cogsParts.lenses });
  if (b.cogsParts.consumables > 0) {
    rows.push({
      label: 'Расходники',
      amount: b.cogsParts.consumables,
      sub: b.consumableSubs.map((s) => ({ label: s.name, amount: s.amount })),
    });
  }

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200/70 shadow-[0_1px_3px_rgba(2,6,23,0.04),0_14px_30px_-22px_rgba(2,6,23,0.2)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-slate-50/60 rounded-2xl"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            <span className="truncate text-[13px] font-semibold text-slate-700">{b.name}</span>
          </span>
          <span className={`mt-0.5 block text-xl font-bold tabular-nums ${tone}`}>
            {nf.format(Math.round(b.total))} <span className="text-xs font-medium text-slate-400">сом</span>
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-slate-100 px-4 py-3">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-slate-600">{r.label}</span>
                <span className="font-semibold tabular-nums text-slate-800">{nf.format(Math.round(r.amount))} сом</span>
              </div>
              {r.sub && r.sub.length > 0 && (
                <div className="mt-1 space-y-0.5 border-l-2 border-slate-100 pl-3">
                  {r.sub.map((s) => (
                    <div key={s.label} className="flex items-center justify-between text-[12px] text-slate-400">
                      <span>{s.label}</span>
                      <span className="tabular-nums">{nf.format(Math.round(s.amount))} сом</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ Переключатель периода ============ */

function PeriodToggle({ period, onPeriod }: {
  period: PeriodKey;
  onPeriod: (p: PeriodKey) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-0.5 ring-1 ring-slate-200/70">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPeriod(p.key)}
          className={[
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
            period === p.key ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-500 hover:text-slate-700',
          ].join(' ')}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/* ============ Чистая прибыль ============ */

function ProfitPanel({ data, period, onPeriod, busy, today }: {
  data: SummaryRow | null;
  period: PeriodKey;
  onPeriod: (p: PeriodKey) => void;
  busy: boolean;
  today: Date;
}) {
  const net = data?.net_profit ?? 0;
  const positive = net >= 0;
  const amountColor = positive ? 'text-emerald-600' : 'text-rose-600';
  const revenueNet = (data?.revenue ?? 0) - (data?.refunds ?? 0);
  const expenses: { label: string; amount: number }[] = [
    { label: 'Себестоимость оправ', amount: data?.cogs_frames ?? 0 },
    { label: 'Себестоимость линз', amount: data?.cogs_lenses ?? 0 },
    { label: 'Расходники', amount: data?.cogs_cons ?? 0 },
    { label: 'Аренда', amount: data?.opex_rent ?? 0 },
    { label: 'Коммуналка', amount: data?.opex_utilities ?? 0 },
    { label: 'Налоги', amount: data?.opex_tax ?? 0 },
    { label: 'Зарплата', amount: data?.payroll_total ?? 0 },
    { label: 'Прочее (промоутеры, дорога)', amount: data?.opex_manual ?? 0 },
  ].filter((e) => e.amount > 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="relative mt-8 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 shadow-[0_1px_3px_rgba(2,6,23,0.04),0_24px_48px_-28px_rgba(2,6,23,0.28)]">
      <div className={`h-1.5 ${positive ? 'bg-gradient-to-r from-teal-400 via-emerald-400 to-green-400' : 'bg-gradient-to-r from-rose-400 to-orange-400'}`} />
      <div className="relative px-6 py-6 md:px-8 md:py-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className={`inline-block text-[11px] font-semibold uppercase tracking-[0.2em] ${positive ? 'price-text-gradient' : 'text-rose-500'}`}>
              {positive ? 'Чистая прибыль' : 'Убыток'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">{periodRangeLabel(period, today)} · за вычетом всех расходов</div>
          </div>
          <PeriodToggle period={period} onPeriod={onPeriod} />
        </div>

        <div className="mt-4 leading-none tracking-tight">
          {busy ? (
            <span className="text-4xl md:text-5xl font-extrabold tabular-nums text-slate-300">…</span>
          ) : (
            <span className={`inline-block text-4xl md:text-5xl font-extrabold tabular-nums ${positive ? 'price-text-gradient' : 'text-rose-600'}`}>{nf.format(Math.round(net))}</span>
          )}
          <span className="ml-1 text-base font-medium text-slate-400">сом</span>
        </div>

        {/* Водопад: выручка − каждый расход = чистая прибыль */}
        <div className="mt-5 overflow-hidden rounded-2xl ring-1 ring-slate-200/70">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
            <span className="inline-flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-slate-700">
              <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Выручка</span>
              {data && data.refunds > 0 && <span className="text-[11px] font-normal text-slate-400">минус возвраты {nf.format(Math.round(data.refunds))}</span>}
            </span>
            <span className="text-[13px] font-bold tabular-nums text-emerald-600">+{nf.format(Math.round(revenueNet))}</span>
          </div>
          {expenses.map((e) => (
            <div key={e.label} className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
              <span className="text-[13px] text-slate-500">{e.label}</span>
              <span className="text-[13px] font-medium tabular-nums text-slate-600">−{nf.format(Math.round(e.amount))}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-2.5">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">Всего расходов</span>
            <span className="text-[13px] font-semibold tabular-nums text-slate-700">−{nf.format(Math.round(totalExpenses))}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">{positive ? 'Чистая прибыль' : 'Убыток'}</span>
            <span className={`text-lg font-bold tabular-nums ${amountColor}`}>{nf.format(Math.round(net))} сом</span>
          </div>
        </div>

        <div className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Выручка = полученные оплаты. Учтены все расходы: себестоимость (оправы, линзы, расходники), аренда, коммуналка, налоги (по всем филиалам), зарплата и ручные. Кредиты не вычитаются — это погашение долга.
        </div>
      </div>
    </div>
  );
}

/* ============ Скелет ============ */

function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200/70 px-5 py-5 shadow-[0_1px_3px_rgba(2,6,23,0.04)] animate-pulse">
      <div className="h-5 w-32 rounded bg-slate-200" />
      <div className="mt-4 h-9 w-40 rounded bg-slate-200" />
      <div className="mt-5 space-y-2">
        <div className="h-3 w-full rounded bg-slate-100" />
        <div className="h-3 w-full rounded bg-slate-100" />
      </div>
    </div>
  );
}

/* ============ Плюрализация ============ */

function pluralDays(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}
