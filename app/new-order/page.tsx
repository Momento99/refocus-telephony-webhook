// app/new-order/page.tsx
'use client';

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useDeferredValue,
} from 'react';
import { IMaskInput } from 'react-imask';
import toast from 'react-hot-toast';
import getSupabase from '@/lib/supabaseClient';
import {
  Calendar,
  User2,
  Building2,
  Phone as PhoneIcon,
  Glasses,
  Layers,
  CreditCard,
  RotateCcw,
  ChevronRight,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';

/* ───────────────── Утилиты ───────────────── */

// RU → EN для сканера/ручного ввода SKU
const RU_EN_MAP: Record<string, string> = {
  й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p',
  ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l',
  я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm',
  Й: 'Q', Ц: 'W', У: 'E', К: 'R', Е: 'T', Н: 'Y', Г: 'U', Ш: 'I', Щ: 'O', З: 'P',
  Ф: 'A', Ы: 'S', В: 'D', А: 'F', П: 'G', Р: 'H', О: 'J', Л: 'K', Д: 'L',
  Я: 'Z', Ч: 'X', С: 'C', М: 'V', И: 'B', Т: 'N', Ь: 'M',
  ё: 'e', Ё: 'E', х: 'x', ъ: ']', ж: 'J', э: 'E', б: 'B', ю: 'U',
};
const toEnglishLayout = (s: string) => s.split('').map(ch => RU_EN_MAP[ch] ?? ch).join('');
const normalizeSkuInput = (s: string) => toEnglishLayout(s).replace(/\s+/g, '').toUpperCase();
const normalizeScanChar = (ch: string) => {
  const x = toEnglishLayout(ch);
  if (/^[a-z]$/i.test(x)) return x.toUpperCase();
  if (/^\d$/.test(x)) return x;
  return '';
};

// телефон: только цифры
const normalizePhone = (s: string) => (s || '').replace(/\D/g, '');

/** форматирование цифр из БД в маску +996 (000) 000-000 */
function formatPhoneView(raw: string | null | undefined): string {
  const d = (raw || '').replace(/\D/g, '');
  let n = d.startsWith('996') ? d.slice(3) : d;
  n = n.slice(0, 9);
  const p1 = n.slice(0, 3);
  const p2 = n.slice(3, 6);
  const p3 = n.slice(6, 9);
  if (!p1) return '+996 (___) ___-___';
  return `+996 (${p1.padEnd(3, '_')}) ${p2.padEnd(3, '_')}-${p3.padEnd(3, '_')}`;
}

const fmt = new Intl.NumberFormat('ru-RU');

const baseInput =
  'w-full rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/70';

const cardBase =
  'rounded-2xl border border-slate-200 bg-white/90 backdrop-blur shadow-sm';

function useCardClass() {
  return cardBase;
}

function cryptoRandomId() {
  try { return (crypto as any).randomUUID(); }
  catch { return Math.random().toString(36).slice(2); }
}
const toInt = (v: unknown) => Number(v) || 0;

/* валидность возраста (ISO yyyy-mm-dd) */
function isValidBirthDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  if (d > today) return false;
  const age = (today.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return age >= 3 && age <= 120;
}

/* ─────────────────── Типы ─────────────────── */
type Branch = { id: number; name: string };
type Frame = {
  id: string;
  brand: string;
  model: string;
  color: string;
  price: number;
  sku: string;
  barcode: string;
};
type PayMethod = 'cash' | 'card' | 'qr';
type Gender = 'M' | 'F';
type RefundReason =
  | 'quality_issue'
  | 'wrong_recipe'
  | 'did_not_fit'
  | 'customer_unhappy'
  | 'other';

/* ───────────────── Матрица цен линз ───────────────── */
type Range = { min: number; max: number | null; price: number };
type PriceKey =
  | 'WHITE'
  | 'WHITE_167'
  | 'AR_PLUS'
  | 'AR_MINUS'
  | 'AR_PLUS_167'
  | 'AR_MINUS_167'
  | 'BB'
  | 'BB_167'
  | 'CHAME_PLUS'
  | 'CHAME_MINUS'
  | 'BBX'
  | 'AST_WHITE'
  | 'AST_AR'
  | 'AST_AR_174_MINUS'
  | 'AST_BB'
  | 'AST_CHAME_MINUS'
  | 'AST_BBX_MINUS';

const PRICE_MATRIX: Record<PriceKey, Range[]> = {
  WHITE: [
    { min: 0, max: 2.75, price: 300 },
    { min: 3, max: 5.5, price: 350 },
    { min: 6, max: 8.5, price: 500 },
    { min: 9, max: null, price: 750 },
  ],
  WHITE_167: [
    { min: 3, max: 5.5, price: 1100 },
    { min: 6, max: 8.5, price: 1850 },
    { min: 9, max: null, price: 1950 },
  ],
  AR_PLUS: [
    { min: 0, max: 2.75, price: 550 },
    { min: 3, max: 5.5, price: 700 },
    { min: 6, max: 8.5, price: 950 },
    { min: 9, max: null, price: 1350 },
  ],
  AR_MINUS: [
    { min: 0, max: 2.75, price: 550 },
    { min: 3, max: 5.5, price: 700 },
    { min: 6, max: 8.5, price: 950 },
    { min: 9, max: null, price: 1350 },
  ],
  AR_PLUS_167: [
    { min: 3, max: 5.5, price: 1800 },
    { min: 6, max: 8.5, price: 2800 },
    { min: 9, max: null, price: 3500 },
  ],
  AR_MINUS_167: [
    { min: 3, max: 5.5, price: 1800 },
    { min: 6, max: 8.5, price: 2800 },
    { min: 9, max: null, price: 3500 },
  ],
  BB: [
    { min: 0, max: 2.75, price: 750 },
    { min: 3, max: 5.5, price: 850 },
    { min: 6, max: 8.5, price: 1350 },
    { min: 9, max: null, price: 1650 },
  ],
  BB_167: [
    { min: 3, max: 5.5, price: 3300 },
    { min: 6, max: 8.5, price: 4100 },
    { min: 9, max: null, price: 5100 },
  ],
  CHAME_PLUS: [
    { min: 0, max: 2.75, price: 750 },
    { min: 3, max: 5.5, price: 950 },
    { min: 6, max: 8.5, price: 1300 },
    { min: 9, max: null, price: 1700 },
  ],
  CHAME_MINUS: [
    { min: 0, max: 2.75, price: 750 },
    { min: 3, max: 5.5, price: 950 },
    { min: 6, max: 8.5, price: 1300 },
    { min: 9, max: null, price: 1700 },
  ],
  BBX: [
    { min: 0, max: 2.75, price: 1400 },
    { min: 3, max: 5.5, price: 1800 },
    { min: 6, max: 8.5, price: 2350 },
    { min: 9, max: null, price: 3000 },
  ],
  AST_WHITE: [
    { min: 0, max: 1.75, price: 400 },
    { min: 2, max: 3.75, price: 500 },
    { min: 4, max: 5.5, price: 750 },
    { min: 6, max: null, price: 900 },
  ],
  AST_AR: [
    { min: 0, max: 1.75, price: 700 },
    { min: 2, max: 3.75, price: 900 },
    { min: 4, max: 5.5, price: 1250 },
    { min: 6, max: null, price: 1450 },
  ],
  AST_AR_174_MINUS: [
    { min: 2, max: 3.75, price: 2800 },
    { min: 4, max: 5.5, price: 3800 },
    { min: 6, max: null, price: 4600 },
  ],
  AST_BB: [
    { min: 0, max: 1.75, price: 900 },
    { min: 2, max: 3.75, price: 1150 },
    { min: 4, max: 5.5, price: 1400 },
    { min: 6, max: null, price: 1600 },
  ],
  AST_CHAME_MINUS: [
    { min: 0, max: 1.75, price: 1050 },
    { min: 2, max: 3.75, price: 1250 },
    { min: 4, max: 5.5, price: 1600 },
    { min: 6, max: null, price: 1850 },
  ],
  AST_BBX_MINUS: [
    { min: 0, max: 1.75, price: 1800 },
    { min: 2, max: 3.75, price: 1950 },
    { min: 4, max: 5.5, price: 2200 },
  ],
};

type LensOption = { id: string; label: string; astig?: boolean; map: PriceKey };
const LENS_OPTIONS: LensOption[] = [
  { id: 'WHITE', label: 'Белый (+/−)', map: 'WHITE' },
  { id: 'WHITE_167', label: '1.67 Белый (+/−)', map: 'WHITE_167' },
  { id: 'AR_PLUS', label: 'AR (+)', map: 'AR_PLUS' },
  { id: 'AR_MINUS', label: 'AR (−)', map: 'AR_MINUS' },
  { id: 'AR_PLUS_167', label: '1.67 AR (+)', map: 'AR_PLUS_167' },
  { id: 'AR_MINUS_167', label: '1.67 AR (−)', map: 'AR_MINUS_167' },
  { id: 'BB', label: 'BB (+/−)', map: 'BB' },
  { id: 'BB_167', label: '1.67 BB (+/−)', map: 'BB_167' },
  { id: 'CHAME_PLUS', label: 'Хамелеон (+)', map: 'CHAME_PLUS' },
  { id: 'CHAME_MINUS', label: 'Хамелеон (−)', map: 'CHAME_MINUS' },
  { id: 'BBX', label: 'BBX (+/−)', map: 'BBX' },
  { id: 'AST_WHITE', label: 'Аст Белый (+/−)', astig: true, map: 'AST_WHITE' },
  { id: 'AST_AR', label: 'Аст AR (+/−)', astig: true, map: 'AST_AR' },
  {
    id: 'AST_AR_174_MINUS',
    label: 'Аст 1.74 AR (−)',
    astig: true,
    map: 'AST_AR_174_MINUS',
  },
  { id: 'AST_BB', label: 'Аст BB (+/−)', astig: true, map: 'AST_BB' },
  {
    id: 'AST_CHAME_MINUS',
    label: 'Аст Хамелеон (−)',
    astig: true,
    map: 'AST_CHAME_MINUS',
  },
  {
    id: 'AST_BBX_MINUS',
    label: 'Аст BBX (−)',
    astig: true,
    map: 'AST_BBX_MINUS',
  },
];

/* ───────────────── Поля ───────────────── */
const PhoneField = React.memo(function PhoneField({
  value,
  onAccept,
}: { value: string; onAccept: (v: string) => void }) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500">
        <PhoneIcon size={18} />
      </div>
      <IMaskInput
        mask="+996 (000) 000-000"
        value={value}
        onAccept={(val: unknown) => onAccept(String(val))}
        className={`${baseInput} tabular-nums tracking-wide text-[15px] pl-10 pr-2 py-2`}
        placeholder="+996 (___) ***-***"
      />
    </div>
  );
});

/** Дата рождения: компактный однострочный контрол dd.mm.yyyy с валидацией возраста. */
const DobField = React.memo(function DobField({
  value,
  onChange,
  required,
}: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const [view, setView] = useState<string>('');

  const toISO = (s: string) => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
    if (!m) return '';
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yy = Number(m[3]);
    if (yy < 1900 || yy > new Date().getFullYear() - 3) return '';
    if (mm < 1 || mm > 12) return '';
    const dim = new Date(yy, mm, 0).getDate();
    if (dd < 1 || dd > dim) return '';
    return `${yy.toString().padStart(4, '0')}-${mm
      .toString()
      .padStart(2, '0')}-${dd.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!value) {
      setView('');
      return;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    setView(m ? `${m[3]}.${m[2]}.${m[1]}` : '');
  }, [value]);

  const invalid = view.length === 10 && !isValidBirthDate(toISO(view));

  return (
    <div>
      <label className="hint flex items-center gap-2">
        <Calendar size={14} className="text-indigo-500" />
        Дата рождения{required ? ' *' : ''}
      </label>
      <div className="relative">
        <IMaskInput
          mask="00.00.0000"
          placeholder="ДД.ММ.ГГГГ"
          value={view}
          inputMode="numeric"
          onAccept={(val: unknown) => {
            const v = String(val);
            setView(v);
            if (v.length === 10) {
              const iso = toISO(v);
              onChange(iso && isValidBirthDate(iso) ? iso : '');
            } else {
              onChange('');
            }
          }}
          className={`${baseInput} tabular-nums tracking-wide text-[15px] pl-3 pr-3 py-2`}
        />
        {invalid && (
          <div className="mt-1 text-xs leading-snug text-rose-600">
            Проверь дату: реальный день, месяц 1–12, возраст 3–120 лет.
          </div>
        )}
      </div>
    </div>
  );
});

/* ───────────── Страница ───────────── */

export default function NewOrderPage(): JSX.Element {
  const card = useCardClass();
  const input = `${baseInput} px-3 py-2`;

  // справочники
  const [branches, setBranches] = useState<Branch[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);

  // форма
  const [branchId, setBranchId] = useState<number | ''>('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [birthDate, setBirthDate] = useState<string>('');

  // автоподстановка клиента
  const [allowSilentLookup, setAllowSilentLookup] = useState(true);
  const lastEditRef = useRef<{ phone: number; lastName: number }>({
    phone: 0,
    lastName: 0,
  });
  const markEdited = (f: 'phone' | 'lastName') => {
    lastEditRef.current[f] = Date.now();
  };
  const [autofillApplied, setAutofillApplied] = useState(false);
  const fetchSeq = useRef(0);

  // оправа
  const [frameSku, setFrameSku] = useState('');
  const [framePrice, setFramePrice] = useState<number>(0);
  const [frameId, setFrameId] = useState<string>('');
  const [frameBarcode, setFrameBarcode] = useState<string>('');

  // линзы
  const [lensId, setLensId] = useState<string>('');
  const [odRangeIdx, setOdRangeIdx] = useState<number | ''>('');
  const [osRangeIdx, setOsRangeIdx] = useState<number | ''>('');

  type PaymentRow = { id: string; method: PayMethod; amount: string };
  const [pays, setPays] = useState<PaymentRow[]>([
    { id: cryptoRandomId(), method: 'cash', amount: '' },
  ]);

  // возврат
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState<string>('0');
  const [refundMethod, setRefundMethod] = useState<PayMethod>('cash');
  const [refundReason, setRefundReason] =
    useState<RefundReason>('customer_unhappy');
  const [refundComment, setRefundComment] = useState<string>('');
  const [refundModal, setRefundModal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [purchaseCount, setPurchaseCount] = useState<number | null>(null);

  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);

  // выпадашки “Диапазон”
  const ranges = useMemo(
    () =>
      lensId
        ? PRICE_MATRIX[LENS_OPTIONS.find((l) => l.id === lensId)!.map]
        : [],
    [lensId],
  );

  const signPrefix = useMemo(() => {
    if (!lensId) return '(+/−)';
    if (lensId.includes('_PLUS') || lensId.endsWith('PLUS')) return '(+)';
    if (
      lensId.includes('_MINUS') ||
      lensId.endsWith('MINUS') ||
      /MINUS$/.test(lensId)
    )
      return '(−)';
    if (lensId.startsWith('AR_PLUS') || lensId === 'CHAME_PLUS') return '(+)';
    if (
      lensId.startsWith('AR_MINUS') ||
      lensId.includes('CHAME_MINUS') ||
      lensId.includes('BBX_MINUS')
    )
      return '(−)';
    return '(+/−)';
  }, [lensId]);

  const rToStr = (r: Range) =>
    r.max === null ? `${r.min}+` : `${r.min}–${r.max}`;
  const priceOD = useMemo(
    () =>
      odRangeIdx === '' ? 0 : ranges[toInt(odRangeIdx)]?.price || 0,
    [odRangeIdx, ranges],
  );
  const priceOS = useMemo(
    () =>
      osRangeIdx === '' ? 0 : ranges[toInt(osRangeIdx)]?.price || 0,
    [osRangeIdx, ranges],
  );

  const lensTotal = useMemo(() => {
    let s = 0;
    if (lensId) {
      if (odRangeIdx !== '') s += priceOD;
      if (osRangeIdx !== '') s += priceOS;
    }
    return s;
  }, [lensId, odRangeIdx, osRangeIdx, priceOD, priceOS]);

  const subtotalRaw = (framePrice || 0) + lensTotal;

  // Лояльность (привязка к телефону)
  const benefits = useMemo(() => {
    const pc = purchaseCount ?? 0;
    const nextIndex = pc + 1;
    const freeFrame = nextIndex % 7 === 0;
    const percent = freeFrame ? 0 : pc >= 5 ? 10 : pc >= 2 ? 5 : 0;
    return {
      type: freeFrame ? 'free-frame' : percent > 0 ? 'percent' : 'none',
      percent,
    } as
      | { type: 'none'; percent: 0 }
      | { type: 'percent'; percent: number }
      | { type: 'free-frame'; percent: 0 };
  }, [purchaseCount]);

  const discountAmount = useMemo(() => {
    if (benefits.type === 'free-frame' && framePrice > 0)
      return Math.min(framePrice || 0, 10_000);
    if (benefits.type === 'percent')
      return Math.round((subtotalRaw * benefits.percent) / 100);
    return 0;
  }, [benefits, subtotalRaw, framePrice]);

  const subtotal = Math.max(0, subtotalRaw - discountAmount);
  const prepaidNum = useMemo(
    () =>
      pays.reduce(
        (s, r) => s + (Number(r.amount || 0) || 0),
        0,
      ),
    [pays],
  );
  const totalDue = Math.max(0, subtotal - prepaidNum);

  /* ─────────── считать покупки по телефону ─────────── */
  useEffect(() => {
    const normalized = normalizePhone(phone);
    if (normalized.length < 7) {
      setPurchaseCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sb = getSupabase();
        const { data: cust } = await sb
          .from('customers')
          .select('id')
          .eq('phone', normalized)
          .maybeSingle();
        if (cancelled) return;
        if (cust?.id) {
          const { count, error } = await sb
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', cust.id);
          if (error) throw error;
          setPurchaseCount(count ?? 0);
        } else {
          setPurchaseCount(0);
        }
      } catch {
        setPurchaseCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phone]);

  /* ───────────── загрузка справочников ───────────── */
  const loadDictionaries = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data: br, error: eB } = await sb
        .from('branches')
        .select('id,name')
        .order('id');
      if (eB) throw eB;
      setBranches(br || []);
      if (br?.length) setBranchId(br[0].id);

      const { data: fl, error: eF } = await sb
        .from('v_frame_labels')
        .select('id,brand,model,color,price,sku,barcode')
        .order('id', { ascending: false })
        .limit(600);
      if (eF) throw eF;
      setFrames(fl || []);
    } catch (err: any) {
      console.warn('load dicts:', err?.message || err);
      toast.error('Не удалось загрузить справочники');
    }
  }, []);

  useEffect(() => {
    loadDictionaries();
  }, [loadDictionaries]);

  const frameQ = useDeferredValue(frameSku);
  const filteredFrames = useMemo(() => {
    const q = frameQ.trim().toLowerCase();
    const arr = q
      ? frames.filter((f) => f.sku.toLowerCase().includes(q))
      : frames;
    return arr.slice(0, 200);
  }, [frameQ, frames]);

  const pickFrameBySku = useCallback(
    async (raw: string) => {
      try {
        const sb = getSupabase();
        const code = normalizeSkuInput(raw);

        setFrameSku(code);
        setFrameBarcode('');
        setFrameId('');
        setFramePrice(0);

        if (!code) return;

        // штрих-код серии RF...
        if (/^RF/i.test(code)) {
          const { data: bc, error: eBc } = await sb
            .from('frame_barcodes')
            .select('frame_id, barcode, price, created_at')
            .eq('barcode', code)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (eBc) throw eBc;
          if (!bc) {
            toast.error('Штрих-код не найден в базе');
            return;
          }

          setFrameBarcode(bc.barcode);
          setFramePrice(Number(bc.price) || 0);

          if (bc.frame_id) {
            const { data: f } = await sb
              .from('frames')
              .select('id, sku')
              .eq('id', bc.frame_id)
              .maybeSingle();
            if (f?.sku) {
              setFrameSku(f.sku);
              setFrameId(f.id as string);
            }
          }

          toast.success('Штрих-код распознан');
          return;
        }

        // FR-артикул
        const codeLower = code.toLowerCase();
        const f = frames.find(
          (x) => x.sku.toLowerCase() === codeLower || x.barcode === code,
        );
        if (f) {
          setFrameSku(f.sku);
          setFramePrice(f.price || 0);
          setFrameBarcode(f.barcode || '');
          toast.success(`Найдено: ${f.sku}`);
        } else {
          toast.error('Оправа не найдена');
        }
      } catch (e: any) {
        console.warn('pickFrameBySku:', e?.message || e);
        toast.error(e?.message || 'Ошибка сканирования');
      }
    },
    [frames],
  );

  // Поиск клиента по телефону или фамилии
  const fetchCustomer = useCallback(
    async (opts: { phone?: string; lastName?: string; silent?: boolean }) => {
      if (autofillApplied && opts.silent) return null;

      const sb = getSupabase();
      const normalizedPhone = normalizePhone(opts.phone || '');
      const byPhone = normalizedPhone.length >= 7;
      const startedAt = Date.now();
      const seq = ++fetchSeq.current;

      try {
        let customer:
          | {
              id: number;
              full_name: string;
              gender: Gender | null;
              birthdate: string | null;
              phone: string | null;
            }
          | null = null;

        if (byPhone) {
          const { data, error } = await sb
            .from('customers')
            .select('id,full_name,gender,birthdate,phone')
            .eq('phone', normalizedPhone)
            .limit(1);
          if (error) throw error;
          customer = data?.[0] ?? null;
        } else if ((opts.lastName || '').trim().length >= 2) {
          const q = (opts.lastName || '').trim();
          const { data, error } = await sb
            .from('customers')
            .select('id,full_name,gender,birthdate,phone')
            .ilike('full_name', `${q}%`)
            .order('id', { ascending: false })
            .limit(1);
          if (error) throw error;
          customer = data?.[0] ?? null;
        }

        if (startedAt < Math.max(lastEditRef.current.phone, lastEditRef.current.lastName)) {
          return null;
        }
        if (seq !== fetchSeq.current) return null;

        if (!customer) {
          if (!opts.silent) toast('Клиент не найден', { icon: '🔎' });
          setPurchaseCount(0);
          return null;
        }

        setLastName(customer.full_name || '');
        if (customer.gender === 'M' || customer.gender === 'F')
          setGender(customer.gender as any);
        if (customer.birthdate) setBirthDate(String(customer.birthdate));

        if (!byPhone && customer.phone) {
          const masked = formatPhoneView(customer.phone);
          setPhone(masked);
          markEdited('phone');
        }

        setAutofillApplied(true);
        setAllowSilentLookup(false);

        const { count, error: eC } = await sb
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', customer.id);
        if (eC) throw eC;
        setPurchaseCount(count ?? 0);

        if (!opts.silent) toast.success('Клиент найден и подставлен');
        return customer;
      } catch (e: any) {
        if (!opts.silent) toast.error(e?.message || 'Ошибка поиска клиента');
        return null;
      }
    },
    [autofillApplied],
  );

  const lookupCustomer = useCallback(async () => {
    setAllowSilentLookup(false);
    setAutofillApplied(false);
    return fetchCustomer({ phone, lastName, silent: false });
  }, [fetchCustomer, phone, lastName]);

  // Автопоиск при вводе телефона/фамилии
  useEffect(() => {
    if (!allowSilentLookup || autofillApplied) return;
    const t = setTimeout(async () => {
      const normalized = normalizePhone(phone);
      if (normalized.length >= 7 || lastName.trim().length >= 2) {
        const c = await fetchCustomer({ phone, lastName, silent: true });
        if (c) {
          // флаги выставляет fetchCustomer
        }
      }
    }, 400);
    return () => clearTimeout(t);
  }, [phone, lastName, fetchCustomer, allowSilentLookup, autofillApplied]);

  // Переход со Шага 1 с валидацией
  const goNextFromClient = useCallback(() => {
    if (!branchId) {
      toast.error('Выберите филиал');
      return;
    }
    if (!lastName.trim()) {
      toast.error('Заполните фамилию клиента');
      return;
    }
    const phoneDigits = normalizePhone(phone);
    if (phoneDigits.length < 9) {
      toast.error('Укажите телефон клиента полностью');
      return;
    }
    if (!gender) {
      toast.error('Укажите пол клиента');
      return;
    }
    if (!birthDate) {
      toast.error('Укажите дату рождения клиента');
      return;
    }
    if (!isValidBirthDate(birthDate)) {
      toast.error('Дата рождения некорректна');
      return;
    }
    setActiveStep(2);
  }, [branchId, lastName, phone, gender, birthDate]);

  const createOrder = useCallback(async () => {
    if (!branchId) {
      toast.error('Выберите филиал');
      return;
    }
    if (!lastName) {
      toast.error('Заполните фамилию клиента');
      return;
    }
    if (!normalizePhone(phone)) {
      toast.error('Укажите телефон клиента');
      return;
    }
    if (!gender) {
      toast.error('Укажите пол клиента');
      return;
    }
    if (!birthDate) {
      toast.error('Укажите дату рождения клиента');
      return;
    }
    if (!isValidBirthDate(birthDate)) {
      toast.error('Дата рождения некорректна');
      return;
    }

    const haveFrame = !!framePrice;
    const haveLensOD = !!(lensId && odRangeIdx !== '');
    const haveLensOS = !!(lensId && osRangeIdx !== '');
    const haveAnyLens = haveLensOD || haveLensOS;
    if (!haveFrame && !haveAnyLens) {
      toast.error('Добавьте оправу или линзы');
      return;
    }

    try {
      setLoading(true);
      const sb = getSupabase();
      const normalizedPhone = normalizePhone(phone);

      const { data: exist, error: eC1 } = await sb
        .from('customers')
        .select('id, gender, birthdate')
        .eq('phone', normalizedPhone)
        .maybeSingle();
      if (eC1) throw eC1;

      let customerId = exist?.id as number | undefined;

      const birthDateIso: string | null =
        birthDate && birthDate.trim() !== '' ? birthDate : null;

      if (!customerId) {
        const { data: nc, error: eC2 } = await sb
          .from('customers')
          .insert([
            {
              full_name: lastName,
              phone: normalizedPhone,
              gender,
              birthdate: birthDateIso,
            },
          ])
          .select('id')
          .single();
        if (eC2) throw eC2;

        customerId = (nc as any).id as number;
        toast.success('Создан новый клиент');
      } else {
        const needUpdate =
          (exist?.gender ?? null) !== gender ||
          ((exist?.birthdate as string | null) ?? null) !== birthDateIso;

        if (needUpdate) {
          const { error: eUpd } = await sb
            .from('customers')
            .update({ gender, birthdate: birthDateIso })
            .eq('id', customerId);
          if (eUpd) throw eUpd;
          toast('Данные клиента обновлены', { icon: '📝' });
        }
      }

      const { data: ord, error: eO } = await sb
        .from('orders')
        .insert([
          {
            branch_id: branchId,
            customer_id: customerId,
            status: 'NEW',
            total: subtotal,
            prepaid: prepaidNum,
            discount_type: benefits.type,
            discount_percent:
              benefits.type === 'percent' ? benefits.percent : 0,
            discount_amount: discountAmount,
            customer_gender: gender,
          },
        ])
        .select('id,order_no')
        .single();
      if (eO) throw eO;
      const orderId = (ord as any).id;

      let frameProductId: number | null = null;
      if (frameSku) {
        const { data: fr } = await sb
          .from('products')
          .select('id,price')
          .eq('sku', frameSku)
          .maybeSingle();
        if (fr?.id) frameProductId = (fr as any).id;
      }

      const items: any[] = [];
      if (haveFrame) {
        items.push({
          order_id: orderId,
          item_type: 'frame',
          product_id: frameProductId,
          frame_id: frameId || null,
          eye: 'NA',
          lens_type: null,
          sph: null,
          cyl: null,
          ax: null,
          pd_snapshot: null,
          qty: 1,
          price: framePrice,
        });
      }
      if (haveLensOD) {
        const r = ranges[toInt(odRangeIdx as number)];
        items.push({
          order_id: orderId,
          item_type: 'lens',
          product_id: null,
          eye: 'OD',
          lens_type: `${lensId} [${rToStr(r)}]`,
          sph: null,
          cyl: null,
          ax: null,
          pd_snapshot: null,
          qty: 1,
          price: priceOD,
        });
      }
      if (haveLensOS) {
        const r = ranges[toInt(osRangeIdx as number)];
        items.push({
          order_id: orderId,
          item_type: 'lens',
          product_id: null,
          eye: 'OS',
          lens_type: `${lensId} [${rToStr(r)}]`,
          sph: null,
          cyl: null,
          ax: null,
          pd_snapshot: null,
          qty: 1,
          price: priceOS,
        });
      }
      if (items.length) {
        const { error: eI } = await sb.from('order_items').insert(items);
        if (eI) throw eI;
      }

      const payments = pays
        .map((p) => ({
          method: p.method,
          amount: Number(p.amount || 0) || 0,
        }))
        .filter((p) => p.amount > 0)
        .map((p) => ({
          ...p,
          db_method:
            p.method === 'cash'
              ? 'cash'
              : p.method === 'card'
              ? 'pos'
              : 'transfer',
        }));

      if (payments.length) {
        const { error: eP } = await sb.from('payments').insert(
          payments.map((p) => ({
            order_id: orderId,
            amount: p.amount,
            method: p.db_method as any,
          })),
        );
        if (eP) throw eP;
      }

      toast.success(
        `Заказ создан: ${(ord as any).order_no}. К оплате: ${fmt.format(
          totalDue,
        )} с`,
      );

      try {
        if ((window as any).RefocusPrinter?.printReceipt) {
          await (window as any).RefocusPrinter.printReceipt({ orderId });
        }
      } catch {
        // принтер необязателен
      }

      resetForm();
      setActiveStep(1);
    } catch (e: any) {
      console.warn('createOrder:', e?.message || e);
      toast.error(e?.message || 'Ошибка при создании заказа');
    } finally {
      setLoading(false);
    }
  }, [
    branchId,
    lastName,
    phone,
    gender,
    birthDate,
    frameSku,
    lensId,
    odRangeIdx,
    osRangeIdx,
    frameId,
    framePrice,
    subtotal,
    prepaidNum,
    benefits.type,
    benefits.percent,
    discountAmount,
    priceOD,
    priceOS,
    totalDue,
    pays,
    ranges,
  ]);

  const resetForm = useCallback(() => {
    setLastName('');
    setPhone('');
    setGender('');
    setBirthDate('');
    setFrameSku('');
    setFramePrice(0);
    setFrameId('');
    setFrameBarcode('');
    setLensId('');
    setOdRangeIdx('');
    setOsRangeIdx('');
    setPays([{ id: cryptoRandomId(), method: 'cash', amount: '' }]);
    setPurchaseCount(null);
    setAllowSilentLookup(true);
    setAutofillApplied(false);
    lastEditRef.current = { phone: 0, lastName: 0 };
  }, []);

  const confirmRefund = useCallback(async () => {
    try {
      const amount = Number(refundAmount || 0) || 0;
      if (amount <= 0) throw new Error('Укажите сумму возврата');
      const sb = getSupabase();
      const normalizedPhone = normalizePhone(phone) || null;
      const dbMethod =
        refundMethod === 'cash'
          ? 'cash'
          : refundMethod === 'card'
          ? 'pos'
          : 'transfer';
      const { error } = await sb.from('refunds').insert([
        {
          phone: normalizedPhone,
          amount,
          method: dbMethod,
          reason_code: refundReason,
          comment: refundComment || null,
        },
      ]);
      if (error) throw error;
      toast.success('Возврат зафиксирован');
      setRefundModal(false);
      setRefundOpen(false);
      setRefundAmount('0');
      setRefundComment('');
      setRefundMethod('cash');
      setRefundReason('customer_unhappy');
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка возврата');
    }
  }, [refundAmount, refundMethod, refundReason, refundComment, phone]);

  // Сканер штрихкода (не мешаем обычному вводу)
  const scanBuf = useRef('');
  const lastTime = useRef<number>(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      )
        return;
      const now = Date.now();
      if (now - lastTime.current > 120) scanBuf.current = '';
      lastTime.current = now;
      if (e.key === 'Enter') {
        const code = scanBuf.current.trim();
        scanBuf.current = '';
        if (code.length >= 4) pickFrameBySku(code);
        return;
      }
      if (e.key.length === 1) {
        const ch = normalizeScanChar(e.key);
        if (ch) scanBuf.current += ch;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pickFrameBySku]);

  // Триггер подстановки оправы при ручном вводе
  useEffect(() => {
    if (!frameSku) return;
    const maybeCode = normalizeSkuInput(frameSku);
    if (!/^RF|^FR/i.test(maybeCode)) return;
    const t = setTimeout(() => pickFrameBySku(maybeCode), 300);
    return () => clearTimeout(t);
  }, [frameSku, pickFrameBySku]);

  // «Обновить» — перезагрузить справочники и очистить форму
  const smartRefresh = useCallback(async () => {
    const needConfirm =
      lastName ||
      phone ||
      birthDate ||
      frameSku ||
      lensId ||
      pays.some((p) => p.amount) ||
      priceOD ||
      priceOS ||
      framePrice;
    if (
      needConfirm &&
      !window.confirm('Обновить данные справочников и очистить форму?')
    )
      return;
    await loadDictionaries();
    resetForm();
    toast.success('Справочники обновлены, форма очищена');
  }, [
    lastName,
    phone,
    birthDate,
    frameSku,
    lensId,
    pays,
    priceOD,
    priceOS,
    framePrice,
    loadDictionaries,
    resetForm,
  ]);

  const StepHeader = ({
    n,
    icon,
    title,
    onClick,
    active,
  }: {
    n: number;
    icon: React.ReactNode;
    title: string;
    onClick: () => void;
    active: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-4 py-2 border-b border-slate-200 flex items-center justify-between
      ${active ? 'bg-gradient-to-r from-indigo-50 via-blue-50 to-white' : 'bg-slate-50 hover:bg-slate-100'}`}
    >
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-600 to-blue-600 text-white grid place-items-center text-[11px] shadow">
          {n}
        </div>
        <span className="font-semibold text-slate-900 flex items-center gap-2 text-sm">
          {icon}
          {title}
        </span>
      </div>
      <span className="text-xs text-slate-500">
        {active ? 'Свернуть' : 'Развернуть'}
      </span>
    </button>
  );

  const SelectShell: React.FC<{ children: React.ReactNode }> = ({
    children,
  }) => (
    <div className="relative">
      {children}
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[radial-gradient(1200px_600px_at_50%_-100px,rgba(99,102,241,0.08),transparent)]">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-5">
        {/* Заголовок страницы */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
              <Layers className="text-indigo-600" size={20} />
              <span>Новый заказ</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Клиент → оправа → линзы → оплата. Без смен и PIN-логина.
            </p>
          </div>
          <button
            type="button"
            onClick={smartRefresh}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            title="Обновить данные и очистить форму"
          >
            <RefreshCw size={16} className="text-indigo-600" />
            Обновить
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* Левая часть: шаги */}
          <div className="space-y-4">
            {/* 1. Клиент и филиал */}
            <section className={card}>
              <StepHeader
                n={1}
                icon={<User2 size={16} className="text-indigo-500" />}
                title="Клиент и филиал"
                onClick={() => setActiveStep(1)}
                active={activeStep === 1}
              />
              {activeStep === 1 && (
                <div className="p-4 grid md:grid-cols-3 gap-3">
                  <div>
                    <label className="hint">
                      <Building2
                        size={13}
                        className="mr-1 inline text-indigo-500"
                      />
                      Филиал
                    </label>
                    <SelectShell>
                      <select
                        className={`${input} appearance-none pr-9`}
                        value={branchId}
                        onChange={(e) =>
                          setBranchId(
                            e.target.value ? Number(e.target.value) : '',
                          )
                        }
                      >
                        <option value="">— выбрать —</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </SelectShell>
                  </div>
                  <div>
                    <label className="hint">Фамилия клиента</label>
                    <input
                      className={input}
                      value={lastName}
                      onChange={(e) => {
                        setLastName(e.target.value);
                        markEdited('lastName');
                      }}
                      placeholder="Иванов"
                    />
                  </div>
                  <div>
                    <label className="hint">Телефон</label>
                    <div className="flex gap-2">
                      <PhoneField
                        value={phone}
                        onAccept={(v) => {
                          setPhone(v);
                          markEdited('phone');
                        }}
                      />
                      <button
                        type="button"
                        onClick={lookupCustomer}
                        className="px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm"
                      >
                        Найти
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="hint">Пол клиента *</label>
                    <div className="flex items-center gap-4">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="gender"
                          value="M"
                          checked={gender === 'M'}
                          onChange={() => setGender('M')}
                          className="h-4 w-4"
                        />
                        <span>Муж</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="gender"
                          value="F"
                          checked={gender === 'F'}
                          onChange={() => setGender('F')}
                          className="h-4 w-4"
                        />
                        <span>Жен</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <DobField value={birthDate} onChange={setBirthDate} required />
                  </div>

                  <div className="md:col-span-3">
                    <button
                      className="rounded-xl bg-gradient-to-r from-[#182a52] via-[#24469a] to-[#4f8ff0] text-white px-4 py-2 text-sm hover:opacity-95"
                      onClick={goNextFromClient}
                    >
                      Далее: Оправа{' '}
                      <ChevronRight className="inline ml-1" size={14} />
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* 2. Оправа */}
            <section className={card}>
              <StepHeader
                n={2}
                icon={<Glasses size={16} className="text-indigo-500" />}
                title="Оправа"
                onClick={() => setActiveStep(2)}
                active={activeStep === 2}
              />
              {activeStep === 2 && (
                <div className="p-4 grid md:grid-cols-3 gap-3 items-end">
                  <div className="md:col-span-2">
                    <label className="hint">Оправа (список)</label>
                    <SelectShell>
                      <select
                        className={`${input} appearance-none pr-9`}
                        value={frameSku}
                        onChange={(e) => pickFrameBySku(e.target.value)}
                      >
                        <option value="">— выбрать из списка —</option>
                        {filteredFrames.map((f) => (
                          <option key={f.sku} value={f.sku}>
                            {`${f.brand} ${f.model} ${f.color} — ${fmt.format(
                              f.price,
                            )} с (${f.sku})`}
                          </option>
                        ))}
                      </select>
                    </SelectShell>
                  </div>
                  <div>
                    <label className="hint">SKU / Штрих-код (сканер)</label>
                    <input
                      className={input}
                      value={frameSku}
                      onChange={(e) =>
                        setFrameSku(normalizeSkuInput(e.target.value))
                      }
                      onBlur={() => pickFrameBySku(frameSku)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          pickFrameBySku(frameSku);
                        }
                      }}
                      placeholder="FR… или RF…"
                    />
                  </div>
                  <div>
                    <label className="hint">Цена оправы</label>
                    <input
                      className={input}
                      readOnly
                      value={framePrice ? fmt.format(framePrice) : ''}
                      placeholder="—"
                    />
                  </div>
                  <div className="md:col-span-3 flex gap-2">
                    <button
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                      onClick={() => setActiveStep(1)}
                    >
                      Назад
                    </button>
                    <button
                      className="rounded-xl bg-gradient-to-r from-[#182a52] via-[#24469a] to-[#4f8ff0] text-white px-4 py-2 text-sm hover:opacity-95"
                      onClick={() => setActiveStep(3)}
                    >
                      Далее: Линзы{' '}
                      <ChevronRight className="inline ml-1" size={14} />
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* 3. Линзы */}
            <section className={card}>
              <StepHeader
                n={3}
                icon={<Layers size={16} className="text-indigo-500" />}
                title="Линзы"
                onClick={() => setActiveStep(3)}
                active={activeStep === 3}
              />
              {activeStep === 3 && (
                <div className="p-4 grid md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-4">
                    <label className="hint">Линейка</label>
                    <SelectShell>
                      <select
                        className={`${input} appearance-none pr-9`}
                        value={lensId}
                        onChange={(e) => {
                          setLensId(e.target.value);
                          setOdRangeIdx('');
                          setOsRangeIdx('');
                        }}
                      >
                        <option value="">— выбрать —</option>
                        <optgroup label="Обычные">
                          {LENS_OPTIONS.filter((o) => !o.astig).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Астигматические">
                          {LENS_OPTIONS.filter((o) => o.astig).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </SelectShell>
                  </div>
                  <div className="md:col-span-4">
                    <label className="hint">Диапазон OD</label>
                    <SelectShell>
                      <select
                        className={`${input} appearance-none pr-9`}
                        value={odRangeIdx}
                        onChange={(e) =>
                          setOdRangeIdx(
                            e.target.value === ''
                              ? ''
                              : Number(e.target.value),
                          )
                        }
                        disabled={!lensId}
                      >
                        <option value="">— выбрать —</option>
                        {ranges.map((r, i) => (
                          <option key={i} value={i}>
                            {`${signPrefix} ${rToStr(r)}`}
                          </option>
                        ))}
                      </select>
                    </SelectShell>
                  </div>
                  <div className="md:col-span-4">
                    <label className="hint">Диапазон OS</label>
                    <SelectShell>
                      <select
                        className={`${input} appearance-none pr-9`}
                        value={osRangeIdx}
                        onChange={(e) =>
                          setOsRangeIdx(
                            e.target.value === ''
                              ? ''
                              : Number(e.target.value),
                          )
                        }
                        disabled={!lensId}
                      >
                        <option value="">— выбрать —</option>
                        {ranges.map((r, i) => (
                          <option key={i} value={i}>
                            {`${signPrefix} ${rToStr(r)}`}
                          </option>
                        ))}
                      </select>
                    </SelectShell>
                  </div>
                  <div className="md:col-span-12 flex gap-2">
                    <button
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                      onClick={() => setActiveStep(2)}
                    >
                      Назад
                    </button>
                    <button
                      className="rounded-xl bg-gradient-to-r from-[#182a52] via-[#24469a] to-[#4f8ff0] text-white px-4 py-2 text-sm hover:opacity-95"
                      onClick={() => setActiveStep(4)}
                    >
                      Далее: Оплата{' '}
                      <ChevronRight className="inline ml-1" size={14} />
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* 4. Оплата */}
            <section className={card}>
              <StepHeader
                n={4}
                icon={<CreditCard size={16} className="text-indigo-500" />}
                title="Оплата"
                onClick={() => setActiveStep(4)}
                active={activeStep === 4}
              />
              {activeStep === 4 && (
                <div className="p-4 space-y-3">
                  {pays.map((row, idx) => (
                    <div
                      key={row.id}
                      className="grid md:grid-cols-3 gap-3 items-end"
                    >
                      <div>
                        <label className="hint">{`Метод #${idx + 1}`}</label>
                        <SelectShell>
                          <select
                            className={`${input} appearance-none pr-9`}
                            value={row.method}
                            onChange={(e) =>
                              setPays((ps) =>
                                ps.map((p) =>
                                  p.id === row.id
                                    ? {
                                        ...p,
                                        method: e.target
                                          .value as PayMethod,
                                      }
                                    : p,
                                ),
                              )
                            }
                          >
                            <option value="cash">Наличные</option>
                            <option value="card">Карта</option>
                            <option value="qr">QR</option>
                          </select>
                        </SelectShell>
                      </div>
                      <div>
                        <label className="hint">Сумма, сом</label>
                        <input
                          className={input}
                          value={row.amount}
                          onChange={(e) =>
                            setPays((ps) =>
                              ps.map((p) =>
                                p.id === row.id
                                  ? { ...p, amount: e.target.value }
                                  : p,
                              ),
                            )
                          }
                          placeholder="0"
                          inputMode="numeric"
                        />
                      </div>
                      <div className="flex gap-2">
                        {pays.length > 1 && (
                          <button
                            className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm"
                            onClick={() =>
                              setPays((ps) =>
                                ps.filter((p) => p.id !== row.id),
                              )
                            }
                          >
                            Удалить
                          </button>
                        )}
                        {idx === pays.length - 1 && (
                          <button
                            className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm"
                            onClick={() =>
                              setPays((ps) => [
                                ...ps,
                                {
                                  id: cryptoRandomId(),
                                  method: 'cash',
                                  amount: '',
                                },
                              ])
                            }
                          >
                            + Добавить платеж
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="md:col-span-3 flex gap-2">
                    <button
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                      onClick={() => setActiveStep(3)}
                    >
                      Назад
                    </button>
                    <button
                      className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm hover:opacity-95"
                      onClick={createOrder}
                      disabled={loading}
                    >
                      {loading ? 'Создаю…' : 'Создать заказ'}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* 5. Возврат / Отмена */}
            <section className={card}>
              <button
                className="w-full px-4 py-2 flex items-center justify-between"
                onClick={() => setRefundOpen((v) => !v)}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-600 to-blue-600 text-white grid place-items-center text-[11px] shadow">
                    5
                  </div>
                  <span className="font-semibold text-slate-900 flex items-center gap-2 text-sm">
                    <RotateCcw size={16} className="text-indigo-500" />{' '}
                    Возврат / Отмена
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {refundOpen ? 'Свернуть' : 'Развернуть'}
                </span>
              </button>
              {refundOpen && (
                <div className="p-4 grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="hint">Сумма возврата, сом</label>
                    <input
                      className={input}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="hint">Метод</label>
                    <SelectShell>
                      <select
                        className={`${input} appearance-none pr-9`}
                        value={refundMethod}
                        onChange={(e) =>
                          setRefundMethod(e.target.value as PayMethod)
                        }
                      >
                        <option value="cash">Наличные</option>
                        <option value="card">Карта</option>
                        <option value="qr">QR</option>
                      </select>
                    </SelectShell>
                  </div>
                  <div>
                    <label className="hint">Причина</label>
                    <SelectShell>
                      <select
                        className={`${input} appearance-none pr-9`}
                        value={refundReason}
                        onChange={(e) =>
                          setRefundReason(e.target.value as RefundReason)
                        }
                      >
                        <option value="customer_unhappy">
                          Не понравилось/передумал
                        </option>
                        <option value="did_not_fit">
                          Не подошла оправа
                        </option>
                        <option value="wrong_recipe">
                          Ошибка рецепта
                        </option>
                        <option value="quality_issue">
                          Дефект/качество
                        </option>
                        <option value="other">Другое</option>
                      </select>
                    </SelectShell>
                  </div>
                  <div>
                    <label className="hint">Комментарий (опц.)</label>
                    <input
                      className={input}
                      value={refundComment}
                      onChange={(e) =>
                        setRefundComment(e.target.value)
                      }
                      placeholder="Текст причины…"
                    />
                  </div>
                  <div className="md:col-span-2 flex gap-2">
                    <button
                      className="rounded-xl bg-red-600 text-white px-4 py-2 text-sm hover:opacity-95"
                      onClick={() => setRefundModal(true)}
                    >
                      Зафиксировать возврат
                    </button>
                    <button
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                      onClick={() => setRefundOpen(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Правая колонка — итог */}
          <aside className="space-y-4">
            <div className={card}>
              <div className="p-4 space-y-3">
                <div className="text-sm font-medium text-slate-700">
                  Предварительный расчёт
                </div>
                <div className="h-px bg-slate-200" />
                <Row
                  label="Оправа"
                  value={
                    framePrice ? fmt.format(framePrice) + ' с' : '—'
                  }
                />
                <Row
                  label="Линза OD"
                  value={
                    lensId && odRangeIdx !== ''
                      ? fmt.format(priceOD) + ' с'
                      : '—'
                  }
                />
                <Row
                  label="Линза OS"
                  value={
                    lensId && osRangeIdx !== ''
                      ? fmt.format(priceOS) + ' с'
                      : '—'
                  }
                />
                <div className="h-px bg-slate-200" />
                {benefits.type === 'free-frame' ? (
                  <>
                    <Row
                      label="Акция: оправа бесплатно (до 10 000)"
                      value={`− ${fmt.format(discountAmount)} с`}
                    />
                    <Row label="Скидка (0%)" value="− 0 с" />
                  </>
                ) : (
                  <Row
                    label={`Скидка (${
                      benefits.type === 'percent'
                        ? benefits.percent
                        : 0
                    }%)`}
                    value={`− ${fmt.format(
                      benefits.type === 'percent'
                        ? discountAmount
                        : 0,
                    )} с`}
                  />
                )}
                <div className="h-px bg-slate-200" />
                <Row label="Итого" value={fmt.format(subtotal) + ' с'} strong />
                <Row
                  label="Аванс"
                  value={`− ${fmt.format(prepaidNum)} с`}
                />
                <div className="h-px bg-slate-200" />
                <Row
                  label="К оплате"
                  value={fmt.format(totalDue) + ' с'}
                  strong
                  big
                />

                <button
                  onClick={createOrder}
                  disabled={loading}
                  className="mt-2 w-full rounded-xl bg-gradient-to-r from-[#182a52] via-[#24469a] to-[#4f8ff0] py-3 text-white font-medium shadow hover:opacity-95 active:opacity-90 disabled:opacity-60 transition"
                >
                  {loading ? 'Создаю…' : 'Создать заказ'}
                </button>

                {frameBarcode && (
                  <div className="text-[11px] text-slate-500">
                    Код: {frameBarcode}
                    {frameId ? ` · frame_id: ${frameId}` : ''}
                  </div>
                )}

                {typeof purchaseCount === 'number' && (
                  <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Покупок по этому номеру: {purchaseCount}.{' '}
                    {benefits.type === 'free-frame'
                      ? 'Следующая оправа бесплатно (до 10 000).'
                      : benefits.type === 'percent'
                      ? `Скидка по лояльности: ${benefits.percent}%.`
                      : 'Скидка по лояльности пока не применяется.'}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Модалка подтверждения возврата */}
      {refundModal && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="p-4 border-b border-slate-200 font-semibold text-slate-900">
              Подтверждение возврата
            </div>
            <div className="p-4 space-y-3 text-slate-700">
              <div>
                Сумма к возврату:{' '}
                <b className="tabular">
                  {fmt.format(Number(refundAmount || 0))} с
                </b>
              </div>
              <div className="text-sm text-slate-600">
                Деньги возвращаются другим способом (касса/перевод). Здесь
                фиксируем факт возврата.
              </div>
              {refundComment && (
                <div className="text-sm">Комментарий: {refundComment}</div>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setRefundModal(false)}
              >
                Отмена
              </button>
              <button
                className="rounded-xl bg-red-600 text-white px-4 py-2 text-sm hover:opacity-95"
                onClick={confirmRefund}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── Маленькие компоненты ───────────── */
function Row({
  label,
  value,
  strong,
  big,
}: {
  label: string;
  value: string;
  strong?: boolean;
  big?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        big ? 'text-lg' : ''
      } ${strong ? 'font-semibold' : ''}`}
    >
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-900 tabular">{value}</span>
    </div>
  );
}
