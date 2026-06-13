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
const RENT_DUE_DAY: Record<number, number> = { 4: 10 }; // Кант — 10-го числа

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

/** Дата (YYYY-MM-DD) по часовому поясу Бишкека из UTC-таймстампа без TZ. */
const bishkekDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit',
});
function bishkekDayOf(ts: string) {
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(ts);
  const iso = hasTz ? ts : `${ts.replace(' ', 'T')}Z`;
  return bishkekDayFmt.format(new Date(iso));
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

const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function monthGenitive(mIdx: number) { return MONTHS_GEN[mIdx] ?? ''; }

function isQuarterEndMonth(mIdx: number) {
  return mIdx === 2 || mIdx === 5 || mIdx === 8 || mIdx === 11; // март/июнь/сентябрь/декабрь
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

/** Сколько полных циклов оплаты (dueDay-е число месяца) завершилось с момента startISO.
 *  strict=true (для dueCycle-категорий: их fraction = 1.0 В ДЕНЬ оплаты) — цикл считается
 *  завершённым только СТРОГО ПОСЛЕ дня оплаты (due < today), иначе день оплаты учёлся бы
 *  дважды (duesPassed +1 и fraction=1.0). strict=false (для аренды по календарному месяцу,
 *  где monthFraction обнуляется 1-го) — учитываем день оплаты включительно (due <= today). */
function duesPassed(startISO: string, today: Date, dueDay: number, strict = false): number {
  const start = new Date(`${startISO}T00:00:00Z`);
  let cnt = 0;
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (let i = 0; i < 600; i++) {
    const due = Date.UTC(y, m, dueDay);
    if (strict ? due >= today.getTime() : due > today.getTime()) break;
    if (due > start.getTime()) cnt++;
    if (++m > 11) { m = 0; y++; }
  }
  return cnt;
}

/* ============ Классификаторы COGS ============ */

const norm = (s: string) =>
  s.trim().toLowerCase().replace(/[ёЁ]/g, 'е').replace(/\s+/g, ' ');

const isLeafletItem    = (item: string) => /листов|leaflet/i.test(item);
const isConsumableItem = (item: string) => /футляр|пакет|салфет|платоч|тряпоч|премиал|подароч/i.test(norm(item));
const isFrameItem      = (item: string) => /оправ|frame/i.test(item) && !isLeafletItem(item) && !isConsumableItem(item);
const isLensItem       = (item: string) => /линз|lens/i.test(item) && !isLeafletItem(item) && !isConsumableItem(item);

/** Подкатегория расходника: «Себест. футляров»/«Футляры» → «Футляры» и т.п. */
function consumableSubKey(item: string): string {
  const n = norm(item);
  if (/футляр/.test(n)) return 'Футляры';
  if (/пакет/.test(n)) return 'Пакеты';
  if (/салфет|тряпоч|платоч/.test(n)) return 'Платочки/салфетки';
  if (/премиал/.test(n)) return 'Премиальный набор';
  if (/подароч/.test(n)) return 'Подарочный набор';
  return item.trim();
}

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

type CreditView = {
  key: string;
  title: string;
  icon: React.ElementType;
  amount: number;
  target: number;
  dueDay: number;
  daysLeft: number;
  dueLabel: string;
  cycleStartISO: string;
  elapsed: number;
  hint: string;
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
type CategoryBox = {
  key: string;
  title: string;
  icon: React.ElementType;
  total: number;
  mine: number;   // доля бюджета «Мои» (Кант+Токмок)
  mama: number;   // доля бюджета «Мама»
  rows: CategoryRow[];
  tone: 'op' | 'credit';
};
type PersonTotals = { mine: number; mama: number };

type CardPerson = {
  accrued: number;      // накоплено обязательств с запуска (монотонно)
  transferred: number;  // уже переведено на виртуальную карту
  toTransfer: number;   // осталось перевести = accrued − transferred (не меньше 0)
};
type CardState = { A: CardPerson; B: CardPerson };

type NextPayment = { daysLeft: number; dueLabel: string; items: { label: string; amount: number }[] };

/* ============ Страница ============ */

/** Справочная разбивка «работа мастера» (уже сидит в зарплате, не отдельная копилка). */
type MasterRefRow = { label: string; amount: number; mine: boolean };
type MasterRef = { total: number; mine: number; mama: number; rows: MasterRefRow[]; fromISO: string };

export default function BudgetPage() {
  const today = useMemo(() => bishkekToday(), []);
  const todayISO = useMemo(() => ymd(today), [today]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BudgetView[]>([]);
  const [credits, setCredits] = useState<CreditView[]>([]);
  const [categoryBoxes, setCategoryBoxes] = useState<CategoryBox[]>([]);
  const [personTotals, setPersonTotals] = useState<PersonTotals | null>(null);
  const [card, setCard] = useState<CardState | null>(null);
  const [nextPay, setNextPay] = useState<NextPayment | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [masterRef, setMasterRef] = useState<MasterRef | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      /* 1. Базовые запросы */
      const [resetsR, extrasR, opexR, cogsR, transfersR] = await Promise.all([
        supabase.from('budget_box_resets').select('box_key, last_reset_at'),
        supabase.from('budget_extra_items').select('key, monthly_amount').eq('is_active', true),
        supabase
          .from('opex_daily_rates')
          .select('branch_id, category, daily_rate')
          .eq('is_active', true)
          .in('branch_id', BRANCH_IDS),
        supabase
          .from('cogs_per_order_rates')
          .select('branch_id, item, amount_per_order')
          .eq('is_active', true)
          .in('branch_id', BRANCH_IDS),
        supabase.from('budget_card_transfers').select('person, amount'),
      ]);
      if (resetsR.error) throw resetsR.error;
      if (opexR.error) throw opexR.error;
      if (cogsR.error) throw cogsR.error;
      if (transfersR.error) console.warn('[budget] transfers read error', transfersR.error);

      /* 2. Даты обнуления (дефолт — 1 число месяца) */
      const defaultReset = ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
      const resetMap = new Map<string, string>();
      for (const r of resetsR.data ?? []) resetMap.set(String(r.box_key), String(r.last_reset_at));
      const resetOf = (key: string) => {
        const r = resetMap.get(key) ?? defaultReset;
        return r < SYSTEM_START_ISO ? SYSTEM_START_ISO : r; // не копим до запуска системы
      };

      const rentReset = resetOf('rent');
      const taxReset = resetOf('taxes');
      const cogsReset = resetOf('consumables'); // frames/lenses/consumables копятся с одной даты

      /* 3. Настраиваемые суммы */
      const extra = new Map<string, number>();
      for (const e of extrasR.data ?? []) extra.set(String((e as any).key), Number((e as any).monthly_amount) || 0);
      const creditAutoAmt     = extra.get('credit_auto')        ?? 58000;
      const creditPersonalAmt = extra.get('credit_personal')    ?? 16000;
      const taxNormal         = extra.get('tax_branch_normal')  ?? 3000;
      const taxQuarter        = extra.get('tax_branch_quarter') ?? 5000;

      /* 4. Ставки аренды по филиалам (daily_rate × 30 = месячная аренда) */
      const rentRateByBranch = new Map<number, number>();
      for (const o of opexR.data ?? []) {
        if (norm(String(o.category)) === 'аренда') {
          rentRateByBranch.set(o.branch_id as number, Number(o.daily_rate) || 0);
        }
      }

      /* 5. Себестоимость на заказ по филиалам */
      const cogsByBranch = new Map<number, { frame: number; lens: number; consumables: number }>();
      const consumableSubByBranch = new Map<number, Map<string, number>>(); // филиал → {Футляры: ставка, …}
      for (const c of cogsR.data ?? []) {
        const bid = c.branch_id as number;
        const cur = cogsByBranch.get(bid) ?? { frame: 0, lens: 0, consumables: 0 };
        const amount = Number(c.amount_per_order) || 0;
        const item = String(c.item);
        if (isLeafletItem(item)) {
          /* листовки — это реклама, в себестоимость копилки не берём */
        } else if (isFrameItem(item)) cur.frame += amount;
        else if (isLensItem(item)) cur.lens += amount;
        else {
          cur.consumables += amount; // футляры/пакеты/салфетки/платочки и пр.
          const sub = consumableSubKey(item);
          const m = consumableSubByBranch.get(bid) ?? new Map<string, number>();
          m.set(sub, (m.get(sub) ?? 0) + amount);
          consumableSubByBranch.set(bid, m);
        }
        cogsByBranch.set(bid, cur);
      }

      /* 6. Заказы за период (COGS/выручка считаются на ОДНОМ окне — от cogsReset).
         Границы и день заказа — по часовому поясу Бишкека (created_at хранится в UTC). */
      const periodStart = cogsReset;
      const tomorrowISO = ymd(new Date(today.getTime() + 24 * 3600 * 1000));
      const { data: orders, error: ordErr } = await supabase
        .from('orders')
        .select('id, branch_id, created_at, total_amount')
        .gte('created_at', bishkekMidnightUtcISO(periodStart))
        .lt('created_at', bishkekMidnightUtcISO(tomorrowISO))
        .eq('is_deleted', false)
        .in('branch_id', BRANCH_IDS);
      if (ordErr) throw ordErr;

      const ordersRows = (orders ?? []).map((o: any) => ({
        id: o.id as number,
        branch_id: o.branch_id as number,
        day: bishkekDayOf(String(o.created_at)),
        total: Number(o.total_amount) || 0,
      }));

      const orderIds = ordersRows.map((o) => o.id);
      let items: { order_id: number; item_type: string }[] = [];
      if (orderIds.length > 0) {
        const { data: itemsRaw, error: itErr } = await supabase
          .from('order_items')
          .select('order_id, item_type')
          .in('order_id', orderIds);
        if (itErr) throw itErr;
        items = itemsRaw as any;
      }
      const orderTypes = new Map<number, Set<string>>();
      for (const it of items) {
        if (!orderTypes.has(it.order_id)) orderTypes.set(it.order_id, new Set());
        orderTypes.get(it.order_id)!.add(it.item_type);
      }

      /* 7. Общие параметры месяца */
      const mIdx = today.getUTCMonth();
      const dayOfMonth = today.getUTCDate();
      const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), mIdx + 1, 0)).getUTCDate();
      const monthFraction = dayOfMonth / daysInMonth;               // аренда: 1-е → конец месяца

      /* Налог копится к 20-му. Ставка (обычная/квартальная) — по месяцу ОПЛАТЫ
         (а не текущему), иначе на стыке кварталов один цикл шёл бы по двум ставкам. */
      const taxCyc = dueCycle(today, TAX_DUE_DAY, 1);
      const isQuarter = isQuarterEndMonth(taxCyc.dueDate.getUTCMonth());
      const taxMonthlyPerBranch = isQuarter ? taxQuarter : taxNormal;
      const taxFraction = todayISO >= taxReset ? taxCyc.fraction : 0;

      /* 8. Себестоимость по филиалам за период */
      const cogsAccum = new Map<number, CogsParts>();
      const ordersCountByBranch = new Map<number, number>();
      for (const o of ordersRows) {
        if (o.day < cogsReset) continue;
        const rates = cogsByBranch.get(o.branch_id);
        if (!rates) continue;
        const types = orderTypes.get(o.id);
        const cur = cogsAccum.get(o.branch_id) ?? { frames: 0, lenses: 0, consumables: 0 };
        if (types?.has('frame')) cur.frames += rates.frame;
        if (types?.has('lens')) cur.lenses += rates.lens;
        cur.consumables += rates.consumables; // расходники — на каждый заказ
        cogsAccum.set(o.branch_id, cur);
        ordersCountByBranch.set(o.branch_id, (ordersCountByBranch.get(o.branch_id) ?? 0) + 1);
      }

      /* 9. Взнос каждого филиала = аренда + налог + себестоимость */
      const contribOf = (branchId: number): BranchContribution => {
        const name = BRANCH_NAME.get(branchId) ?? `#${branchId}`;
        const rentRate = rentRateByBranch.get(branchId) ?? 0;
        // Кант платит аренду 10-го → копим к 10-му (dueCycle); остальные — по календарному месяцу.
        const rentDue = RENT_DUE_DAY[branchId];
        const rentFraction = rentDue ? dueCycle(today, rentDue, 1).fraction : monthFraction;
        const rent = todayISO >= rentReset ? Math.round(rentRate * 30 * rentFraction) : 0;
        const tax = Math.round(taxMonthlyPerBranch * taxFraction);
        const parts = cogsAccum.get(branchId) ?? { frames: 0, lenses: 0, consumables: 0 };
        const cogsParts = {
          frames: Math.round(parts.frames),
          lenses: Math.round(parts.lenses),
          consumables: Math.round(parts.consumables),
        };
        const cogs = cogsParts.frames + cogsParts.lenses + cogsParts.consumables; // = сумме разбивки
        const cnt = ordersCountByBranch.get(branchId) ?? 0;
        const subRates = consumableSubByBranch.get(branchId);
        // Округляем подвиды так, чтобы их сумма РОВНО равнялась cogsParts.consumables
        // (метод наибольших остатков) — иначе при дробных ставках детализация
        // расходников не сошлась бы со строкой «Расходники».
        let consumableSubs: { name: string; amount: number }[] = [];
        if (subRates && cnt > 0) {
          const parts = Array.from(subRates.entries()).map(([name, rate]) => {
            const exact = rate * cnt;
            const floor = Math.floor(exact);
            return { name, amount: floor, rem: exact - floor };
          });
          let leftover = cogsParts.consumables - parts.reduce((s, p) => s + p.amount, 0);
          parts.sort((a, b) => b.rem - a.rem);
          for (let i = 0; i < parts.length && leftover > 0; i++, leftover--) parts[i].amount += 1;
          consumableSubs = parts
            .map(({ name, amount }) => ({ name, amount }))
            .filter((s) => s.amount > 0)
            .sort((a, b) => b.amount - a.amount);
        }
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
      // Мастера-сдельщики (динамически): их весь net_day в v_payroll_daily — это работа
      // по 150 сом/заказ, уже РАЗНЕСЁННАЯ по филиалам пропорционально их заказам.
      const { data: masterRows } = await supabase.from('master_shift_output').select('employee_id');
      const masterIds = new Set<number>((masterRows ?? []).map((r: any) => Number(r.employee_id)));

      const { data: payRows, error: payErr } = await supabase
        .from('v_payroll_daily')
        .select('day, net_day, branch_id, employee_id')
        .gte('day', periodStart)
        .lte('day', todayISO)
        .in('branch_id', BRANCH_IDS);
      if (payErr) throw payErr;
      const payrollByBranch = new Map<number, number>();
      const masterByBranch = new Map<number, number>();
      for (const r of payRows ?? []) {
        const bid = (r as any).branch_id as number;
        const amt = Number((r as any).net_day) || 0;
        payrollByBranch.set(bid, (payrollByBranch.get(bid) ?? 0) + amt);
        if (masterIds.has(Number((r as any).employee_id))) {
          masterByBranch.set(bid, (masterByBranch.get(bid) ?? 0) + amt);
        }
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

      /* 12. Общие кредиты («скидываются все») */
      const autoReset = resetOf('credit_auto');
      const personalReset = resetOf('credit_personal');
      const autoCyc = dueCycle(today, CREDIT_AUTO_DUE_DAY, creditAutoAmt);
      const personalCyc = dueCycle(today, CREDIT_PERSONAL_DUE_DAY, creditPersonalAmt);
      const creditViews: CreditView[] = [
        {
          key: 'credit_auto',
          title: 'Кредит авто',
          icon: Car,
          amount: todayISO >= autoReset ? autoCyc.amount : 0,
          target: creditAutoAmt,
          dueDay: CREDIT_AUTO_DUE_DAY,
          daysLeft: autoCyc.daysLeft,
          dueLabel: `До ${CREDIT_AUTO_DUE_DAY} ${monthGenitive(autoCyc.dueDate.getUTCMonth())}`,
          cycleStartISO: autoCyc.cycleStartISO,
          elapsed: autoCyc.elapsed,
          hint:
            autoCyc.daysLeft === 0
              ? '💳 Сегодня день оплаты'
              : `${nf.format(creditAutoAmt)} сом · копится к ${CREDIT_AUTO_DUE_DAY} числу`,
        },
        {
          key: 'credit_personal',
          title: 'Личный кредит',
          icon: CreditCardIcon,
          amount: todayISO >= personalReset ? personalCyc.amount : 0,
          target: creditPersonalAmt,
          dueDay: CREDIT_PERSONAL_DUE_DAY,
          daysLeft: personalCyc.daysLeft,
          dueLabel: `До ${CREDIT_PERSONAL_DUE_DAY} ${monthGenitive(personalCyc.dueDate.getUTCMonth())}`,
          cycleStartISO: personalCyc.cycleStartISO,
          elapsed: personalCyc.elapsed,
          hint:
            personalCyc.daysLeft === 0
              ? '💳 Сегодня день оплаты'
              : `${nf.format(creditPersonalAmt)} сом · копится к ${CREDIT_PERSONAL_DUE_DAY} числу`,
        },
      ];

      /* 11b. Коробки по категориям + доли «Мои»/«Мама» (кредиты скидываются оба) */
      const allContribs = budgetViews.flatMap((b) => b.branches);
      const mineIds = new Set<number>(BUDGETS[0].branchIds); // Кант + Токмок
      const autoAmt = creditViews[0].amount;
      const personalAmt = creditViews[1].amount;

      const opBox = (
        key: string, title: string, icon: React.ElementType,
        pick: (b: BranchContribution) => number,
      ): CategoryBox => {
        const total = allContribs.reduce((s, b) => s + pick(b), 0);
        const mine = allContribs.filter((b) => mineIds.has(b.branchId)).reduce((s, b) => s + pick(b), 0);
        const rows: CategoryRow[] = allContribs
          .map((b) => ({ label: b.name, amount: pick(b), mine: mineIds.has(b.branchId) as boolean | null }))
          .filter((r) => r.amount > 0)
          .sort((a, z) => z.amount - a.amount);
        return { key, title, icon, total, mine, mama: total - mine, rows, tone: 'op' };
      };

      const creditsTotal = autoAmt + personalAmt;
      const creditsMine = Math.round(creditsTotal / 2); // делим поровну между «Мои» и «Мама»
      const creditsBox: CategoryBox = {
        key: 'credits', title: 'Кредиты', icon: Car,
        total: creditsTotal, mine: creditsMine, mama: creditsTotal - creditsMine,
        rows: [
          { label: `Авто · к ${CREDIT_AUTO_DUE_DAY} ${monthGenitive(autoCyc.dueDate.getUTCMonth())}`, amount: autoAmt, mine: null },
          { label: `Личный · к ${CREDIT_PERSONAL_DUE_DAY} ${monthGenitive(personalCyc.dueDate.getUTCMonth())}`, amount: personalAmt, mine: null },
        ],
        tone: 'credit',
      };

      const categoryBoxesArr: CategoryBox[] = [
        opBox('rent', 'Аренда', Home, (b) => b.rent),
        opBox('tax', 'Налоги', Landmark, (b) => b.tax),
        creditsBox,
        opBox('frames', 'Оправы', Glasses, (b) => b.cogsParts.frames),
        opBox('lenses', 'Линзы', Eye, (b) => b.cogsParts.lenses),
        opBox('consumables', 'Расходники', PackageOpen, (b) => b.cogsParts.consumables),
      ];

      const personTotalsVal: PersonTotals = {
        mine: categoryBoxesArr.reduce((s, x) => s + x.mine, 0),
        mama: categoryBoxesArr.reduce((s, x) => s + x.mama, 0),
      };

      /* 11c. Накопленные обязательства с запуска (МОНОТОННО) → «сколько перевести на карту».
         Каждый завершённый цикл оплаты = +1 полная сумма; коробка обнуляется, а обязательство нет,
         поэтому «осталось перевести = накоплено − уже переведено» не уходит в минус после оплаты. */
      const taxCumPerBranch = (() => {
        const start = new Date(`${SYSTEM_START_ISO}T00:00:00Z`);
        let sum = 0, y = start.getUTCFullYear(), m = start.getUTCMonth();
        for (let i = 0; i < 600; i++) {
          const due = Date.UTC(y, m, TAX_DUE_DAY);
          if (due >= today.getTime()) break; // strict: день оплаты даёт fraction=1.0, тут не считаем
          if (due > start.getTime()) sum += isQuarterEndMonth(m) ? taxQuarter : taxNormal;
          if (++m > 11) { m = 0; y++; }
        }
        return sum + taxMonthlyPerBranch * taxCyc.fraction; // + текущий цикл (в день оплаты fraction=1.0)
      })();
      const autoCumAll     = creditAutoAmt     * (duesPassed(SYSTEM_START_ISO, today, CREDIT_AUTO_DUE_DAY, true)     + autoCyc.fraction);
      const personalCumAll = creditPersonalAmt * (duesPassed(SYSTEM_START_ISO, today, CREDIT_PERSONAL_DUE_DAY, true) + personalCyc.fraction);
      const creditCumPerPerson = (autoCumAll + personalCumAll) / 2; // кредиты делятся 50/50

      const cumObligForBranch = (b: BranchContribution): number => {
        const rentMonthly = (rentRateByBranch.get(b.branchId) ?? 0) * 30;
        const cycleDue = RENT_DUE_DAY[b.branchId]; // только у Канта аренда циклится к dueDay (10)
        const rentDueDay = cycleDue ?? 1;
        const rentFraction = cycleDue ? dueCycle(today, rentDueDay, 1).fraction : monthFraction;
        // strict=true для dueCycle-аренды (Кант): иначе день оплаты учтётся дважды
        const rentCum = rentMonthly * (duesPassed(SYSTEM_START_ISO, today, rentDueDay, !!cycleDue) + rentFraction);
        return rentCum + taxCumPerBranch + b.cogs; // cogs не циклится в пределах периода
      };

      const transferredByPerson: Record<string, number> = { A: 0, B: 0 };
      for (const t of transfersR.data ?? []) {
        const p = String((t as any).person);
        if (p === 'A' || p === 'B') transferredByPerson[p] += Number((t as any).amount) || 0;
      }
      const cardPersonOf = (bv: BudgetView): CardPerson => {
        const accrued = Math.round(bv.branches.reduce((s, b) => s + cumObligForBranch(b), 0) + creditCumPerPerson);
        const transferred = Math.round(transferredByPerson[bv.key] ?? 0);
        return { accrued, transferred, toTransfer: Math.max(0, accrued - transferred) };
      };
      const cardState: CardState = {
        A: cardPersonOf(budgetViews.find((b) => b.key === 'A')!),
        B: cardPersonOf(budgetViews.find((b) => b.key === 'B')!),
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

      /* 13. Итоги */
      const branchesSum = budgetViews.reduce((s, b) => s + b.total, 0);
      const creditsSum = creditViews.reduce((s, c) => s + c.amount, 0);
      const revenue = budgetViews.reduce((s, b) => s + b.revenue, 0);
      const payroll = budgetViews.reduce((s, b) => s + b.payroll, 0);
      const grandTotal = branchesSum + creditsSum;

      /* «Свободные деньги» — ЧЕСТНО за период: выручка − обязательства, начисленные за ЭТОТ ЖЕ
         период (поток, без «авансов» циклов) − зарплата. Иначе в начале месяца ложный дефицит. */
      const daysInPeriod = daysBetweenInclusive(periodStart, today);
      const rentDailyAll = Array.from(rentRateByBranch.values()).reduce((s, r) => s + r, 0); // daily_rate = аренда/день
      const periodRent   = rentDailyAll * daysInPeriod;
      const periodTax    = (taxMonthlyPerBranch * BRANCH_IDS.length / 30) * daysInPeriod;
      const periodCredit = ((creditAutoAmt + creditPersonalAmt) / 30) * daysInPeriod;
      const periodCogs   = budgetViews.reduce((s, bv) => s + bv.branches.reduce((ss, b) => ss + b.cogs, 0), 0);
      const expenses     = Math.round(periodRent + periodTax + periodCredit + periodCogs);

      // Справочная разбивка «работа мастера» по бюджетам (Мама / Я)
      const masterMineIds = new Set<number>(BUDGETS[0].branchIds); // Кант + Токмок
      const masterRefRows: MasterRefRow[] = BRANCHES
        .map((b) => ({ label: b.name, amount: Math.round(masterByBranch.get(b.id) ?? 0), mine: masterMineIds.has(b.id) }))
        .filter((r) => r.amount > 0)
        .sort((a, z) => z.amount - a.amount);
      const masterMine = masterRefRows.filter((r) => r.mine).reduce((s, r) => s + r.amount, 0);
      const masterMama = masterRefRows.filter((r) => !r.mine).reduce((s, r) => s + r.amount, 0);
      const masterRefVal: MasterRef = {
        total: masterMine + masterMama,
        mine: masterMine,
        mama: masterMama,
        rows: masterRefRows,
        fromISO: periodStart,
      };

      setBudgets(budgetViews);
      setCredits(creditViews);
      setCategoryBoxes(categoryBoxesArr);
      setMasterRef(masterRefVal);
      setPersonTotals(personTotalsVal);
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

  async function recordTransfer(person: 'A' | 'B', amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const label = person === 'A' ? 'Мои (Кант + Токмок)' : 'Мама';
    if (!confirm(`Записать перевод на карту «${label}»: ${nf.format(Math.round(amount))} сом?`)) return;
    const { error } = await supabase
      .from('budget_card_transfers')
      .insert({ person, amount: Math.round(amount) });
    if (error) { alert(`Не удалось записать перевод: ${error.message}`); return; }
    await load();
  }

  function promptTransfer(person: 'A' | 'B') {
    const v = window.prompt('Сумма перевода на карту (сом)');
    if (v == null) return;
    const n = Number(v.replace(/[\s ,]/g, '')); // убираем пробелы/неразрывные пробелы/запятые-разделители
    if (!Number.isFinite(n) || n <= 0) { alert('Нужно положительное число'); return; }
    void recordTransfer(person, n);
  }

  return (
    <div className="text-slate-50">
      {/* Header */}
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute -inset-1.5 rounded-2xl bg-gradient-to-br from-cyan-400 to-teal-500 opacity-40 blur-md" />
            <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-teal-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
              <Wallet className="h-5 w-5 text-white" />
            </div>
          </div>
          <div>
            <div className="text-[22px] font-bold tracking-tight text-slate-50">Накопления</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/60">{formatDateRu(todayISO)} · сегодня</div>
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
        <PersonHero card={card} totals={totals} nextPay={nextPay} onTransfer={recordTransfer} onCustom={promptTransfer} />
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300/60">
            Коробки · от кого сколько
          </div>
          <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {categoryBoxes.map((box) => <CategoryCard key={box.key} box={box} />)}
          </div>

          <BranchSummary budgets={budgets} />
          {masterRef && masterRef.total > 0 && <MasterRefCard data={masterRef} />}
        </>
      )}

      {totals && <FreeMoneyPanel totals={totals} />}
    </div>
  );
}

/* ============ HERO: сколько скинуть Я / Мама ============ */

function PersonHero({ card, totals, nextPay, onTransfer, onCustom }: {
  card: CardState;
  totals: Totals;
  nextPay: NextPayment | null;
  onTransfer: (person: 'A' | 'B', amount: number) => void;
  onCustom: (person: 'A' | 'B') => void;
}) {
  return (
    <div className="relative mb-8 rounded-3xl overflow-hidden bg-white ring-1 ring-slate-200 shadow-[0_12px_40px_rgba(15,23,42,0.10)]">
      <div className="h-1 bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400" />
      <div className="relative px-6 py-6 md:px-8 md:py-7">
        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
          Перевести на свою карту сегодня
        </div>

        {/* Я | ОБЩИЙ КОТЁЛ | Мама — котёл крупной цифрой по центру */}
        <div className="mt-4 grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
          <TransferCard title="Я · Мои" subtitle="Кант + Токмок" person="A" data={card.A} accent="cyan" onTransfer={onTransfer} onCustom={onCustom} />

          <div className="relative flex flex-col items-center justify-center px-2 py-3 text-center md:px-6">
            <div className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-28 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-cyan-200/50 to-emerald-200/50 blur-2xl" />
            <div className="relative">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">В общем котле должно быть</div>
              <div className="mt-1 text-5xl md:text-6xl font-extrabold tabular-nums leading-none tracking-tight bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-500 bg-clip-text text-transparent drop-shadow-[0_4px_20px_rgba(20,184,166,0.25)]">
                {nf.format(Math.round(totals.grandTotal))}
              </div>
              <div className="mt-1.5 text-[11px] font-medium text-slate-500">сом на карте сейчас</div>
            </div>
          </div>

          <TransferCard title="Мама" subtitle="Сокулук + Беловодск + Кара-Балта" person="B" data={card.B} accent="emerald" onTransfer={onTransfer} onCustom={onCustom} />
        </div>

        {nextPay && (
          <div className="mt-5 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50/70 ring-1 ring-amber-200 px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">⏰ Ближайшая оплата</span>
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-300/50">
                {nextPay.daysLeft === 0 ? 'сегодня' : `через ${nextPay.daysLeft} ${pluralDays(nextPay.daysLeft)}`} · {nextPay.dueLabel}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-stretch justify-center gap-2">
              {nextPay.items.map((it) => (
                <div key={it.label} className="rounded-xl bg-white/70 ring-1 ring-amber-200 px-4 py-2 text-center">
                  <div className="text-[11px] font-medium text-slate-500">{it.label}</div>
                  <div className="text-lg font-bold tabular-nums text-amber-800">{nf.format(Math.round(it.amount))} сом</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PERSON_STYLE: Record<string, { bg: string; ring: string; dot: string; amt: string }> = {
  cyan:    { bg: 'from-cyan-50 to-sky-50/50',     ring: 'ring-cyan-200',    dot: 'bg-cyan-500',    amt: 'text-cyan-700' },
  emerald: { bg: 'from-emerald-50 to-teal-50/50', ring: 'ring-emerald-200', dot: 'bg-emerald-500', amt: 'text-emerald-700' },
};

function TransferCard({ title, subtitle, person, data, accent, onTransfer, onCustom }: {
  title: string;
  subtitle: string;
  person: 'A' | 'B';
  data: CardPerson;
  accent: 'cyan' | 'emerald';
  onTransfer: (person: 'A' | 'B', amount: number) => void;
  onCustom: (person: 'A' | 'B') => void;
}) {
  const s = PERSON_STYLE[accent];
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${s.bg} ring-1 ${s.ring} px-5 py-4`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${s.dot}`} />
          <div className="text-[13px] font-bold text-slate-700">{title}</div>
        </div>
        <div className="text-[10px] text-slate-400">из {nf.format(data.accrued)} накоплено</div>
      </div>
      <div className={`mt-1 flex items-baseline gap-1.5 ${s.amt}`}>
        <span className="text-4xl md:text-5xl font-bold tabular-nums leading-none">{nf.format(data.toTransfer)}</span>
        <span className="text-base font-medium text-slate-400">сом</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{subtitle} · перевести сейчас</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onTransfer(person, data.toTransfer)}
          disabled={data.toTransfer <= 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-40"
        >
          ✓ Перевёл {nf.format(data.toTransfer)}
        </button>
        <button
          type="button"
          onClick={() => onCustom(person)}
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

const CATEGORY_TONE: Record<string, { iconBg: string; iconRing: string; icon: string; amount: string }> = {
  op:     { iconBg: 'bg-slate-100', iconRing: 'ring-slate-200', icon: 'text-slate-600', amount: 'text-slate-900' },
  credit: { iconBg: 'bg-amber-50',  iconRing: 'ring-amber-200', icon: 'text-amber-600', amount: 'text-amber-700' },
};

function CategoryCard({ box }: { box: CategoryBox }) {
  const [open, setOpen] = useState(false);
  const Icon = box.icon;
  const t = CATEGORY_TONE[box.tone];
  const maxRow = Math.max(1, ...box.rows.map((r) => r.amount));

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.10)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_50px_rgba(15,23,42,0.18)]">
      <div className="px-5 pt-5 pb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={`grid h-10 w-10 place-items-center rounded-xl ${t.iconBg} ring-1 ${t.iconRing}`}>
              <Icon className={`h-5 w-5 ${t.icon}`} />
            </span>
            <div className="text-base font-bold text-slate-900">{box.title}</div>
          </div>
          <div className="text-right">
            <div className={`text-3xl md:text-4xl font-bold tabular-nums ${t.amount} leading-none`}>
              {nf.format(Math.round(box.total))}<span className="ml-1 text-sm font-medium text-slate-400">сом</span>
            </div>
            <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">в коробочку</div>
          </div>
        </div>

        {/* Доли Мои / Мама */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-cyan-50/60 ring-1 ring-cyan-100 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-700">Мои</span>
            </div>
            <div className="mt-0.5 text-base font-bold tabular-nums text-cyan-700">{nf.format(Math.round(box.mine))}</div>
          </div>
          <div className="rounded-lg bg-emerald-50/60 ring-1 ring-emerald-100 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Мама</span>
            </div>
            <div className="mt-0.5 text-base font-bold tabular-nums text-emerald-700">{nf.format(Math.round(box.mama))}</div>
          </div>
        </div>

        {box.rows.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex w-full items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 transition"
            >
              <span>{box.tone === 'credit' ? 'Что входит' : 'По филиалам'}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="mt-3 space-y-2">
                {box.rows.map((r) => (
                  <div key={r.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 text-slate-600">
                        {r.mine !== null && <span className={`h-1.5 w-1.5 rounded-full ${r.mine ? 'bg-cyan-500' : 'bg-emerald-500'}`} />}
                        {r.label}
                      </span>
                      <span className="font-bold text-slate-800 tabular-nums">{nf.format(Math.round(r.amount))}</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full ${r.mine === false ? 'bg-emerald-400' : 'bg-cyan-400'}`} style={{ width: `${Math.round((r.amount / maxRow) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300/60">
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
  const dot = accent === 'cyan' ? 'bg-cyan-500' : 'bg-emerald-500';
  const tone = accent === 'cyan' ? 'text-cyan-700' : 'text-emerald-700';

  const rows: { label: string; amount: number; sub?: { label: string; amount: number }[] }[] = [
    { label: 'Аренда', amount: b.rent },
    { label: 'Налог', amount: b.tax },
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
    <div className="rounded-xl bg-white ring-1 ring-slate-200/80 shadow-[0_4px_16px_rgba(15,23,42,0.08)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-slate-50/60 rounded-xl"
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

/* ============ Работа мастера (справочно) ============ */

function MasterRefCard({ data }: { data: MasterRef }) {
  return (
    <div className="mt-8 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_12px_40px_rgba(15,23,42,0.10)]">
      <div className="h-1 bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400" />
      <div className="px-6 py-6 md:px-8 md:py-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
              Работа мастера · справочно
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              150 сом за заказ · уже сидит в строке «Зарплата» · с {formatDateRu(data.fromISO)}
            </div>
          </div>
          <div className="text-3xl md:text-4xl font-bold tabular-nums leading-none tracking-tight text-indigo-700">
            {nf.format(Math.round(data.total))} <span className="text-base font-medium text-slate-400">сом</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MasterRefSide title="Я · Мои" subtitle="Кант + Токмок" amount={data.mine} rows={data.rows.filter((r) => r.mine)} accent="cyan" />
          <MasterRefSide title="Мама" subtitle="Сокулук + Беловодск + Кара-Балта" amount={data.mama} rows={data.rows.filter((r) => !r.mine)} accent="emerald" />
        </div>

        <div className="mt-3 text-[11px] text-slate-400">
          Это не отдельная копилка — деньги мастера уже включены в «Зарплату» ниже. Разнесено по филиалам пропорционально числу заказов каждого.
        </div>
      </div>
    </div>
  );
}

function MasterRefSide({ title, subtitle, amount, rows, accent }: {
  title: string;
  subtitle: string;
  amount: number;
  rows: MasterRefRow[];
  accent: 'cyan' | 'emerald';
}) {
  const s = PERSON_STYLE[accent];
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${s.bg} ring-1 ${s.ring} px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{title}</div>
        <span className="text-[10px] text-slate-400">· {subtitle}</span>
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${s.amt}`}>
        {nf.format(Math.round(amount))} <span className="text-xs font-medium text-slate-400">сом</span>
      </div>
      {rows.length > 0 && (
        <div className="mt-2 space-y-1">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500">{r.label}</span>
              <span className="font-semibold tabular-nums text-slate-700">{nf.format(Math.round(r.amount))} сом</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ Свободные деньги ============ */

function FreeMoneyPanel({ totals }: { totals: Totals }) {
  const positive = totals.free >= 0;
  const stripe = positive ? 'from-emerald-400 via-teal-400 to-green-400' : 'from-rose-400 via-rose-500 to-orange-400';
  const amountColor = positive ? 'text-emerald-700' : 'text-rose-700';

  return (
    <div className="relative mt-8 rounded-3xl overflow-hidden bg-white ring-1 ring-slate-200 shadow-[0_12px_40px_rgba(15,23,42,0.10)]">
      <div className={`h-1 bg-gradient-to-r ${stripe}`} />
      <div className="relative px-6 py-6 md:px-8 md:py-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
              {positive ? 'Свободные деньги' : 'Дефицит'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">с {formatDateRu(totals.fromISO)}</div>
          </div>
          <div className={`text-4xl md:text-5xl font-bold tabular-nums ${amountColor} leading-none tracking-tight`}>
            {nf.format(Math.round(totals.free))} <span className="text-base font-medium text-slate-400">сом</span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-3">
          <FormulaTile dot="bg-emerald-500" label="Выручка" value={`+${nf.format(Math.round(totals.revenue))}`} tone="text-emerald-700" bg="from-emerald-50 to-teal-50/50" ring="ring-emerald-100" />
          <Sign />
          <FormulaTile dot="bg-slate-400" label="Расходы" value={`−${nf.format(Math.round(totals.expenses))}`} tone="text-slate-700" bg="from-slate-50 to-slate-100/50" ring="ring-slate-200" />
          <Sign />
          <FormulaTile dot="bg-rose-400" label="Зарплата" value={`−${nf.format(Math.round(totals.payroll))}`} tone="text-rose-700" bg="from-rose-50 to-orange-50/50" ring="ring-rose-100" />
        </div>

        <div className="mt-3 text-[11px] text-slate-400">
          Выручка = деньги, полученные за период (оплаты). Расходы = аренда + налоги + кредиты + себестоимость за период (без «авансов»). Это не котёл — котёл копится наперёд.
        </div>
      </div>
    </div>
  );
}

function FormulaTile({ dot, label, value, tone, bg, ring }: { dot: string; label: string; value: string; tone: string; bg: string; ring: string }) {
  return (
    <div className={`rounded-xl bg-gradient-to-br ${bg} ring-1 ${ring} px-4 py-3`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <div className="text-[10px] uppercase tracking-wider text-slate-600 font-bold">{label}</div>
      </div>
      <div className={`mt-1 text-base font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function Sign() {
  return <div className="hidden sm:flex items-center justify-center text-lg font-bold text-slate-300">−</div>;
}

/* ============ Скелет ============ */

function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 px-5 py-5 shadow-[0_8px_30px_rgba(15,23,42,0.10)] animate-pulse">
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
