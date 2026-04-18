"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Landmark, FileText, Download, ExternalLink,
  AlertTriangle, CheckCircle2, Clock, ChevronDown,
} from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";

/* ───────── data ───────── */

const KANT = {
  name: "ИП Момбеков Болот Артурович",
  inn: "22006199900268",
  rayon: "008 — Иссыкатинский р-н",
  regime: "Единый налог (малый бизнес)",
  login: "22006199900268632",
  password: "1999*Болот",
  employee: "Токтомушева А.М.",
  monthly161: 4716,
  lastQuarterlyTax: 3335,
};

const MAMA = {
  name: "ИП Кудайкулова Назия Матраимовна",
  inn: "10908197701135",
  rayon: "Сокулукский, Жайылский, Московский р-н",
  regime: "Единый налог (малый бизнес)",
  login: "10908197701135317",
  password: "1977*Назия",
  goskomstat: "32036554",
  branches: [
    { name: "Кара-Балта", rayonCode: "009", employee: "Абдыразакова Г.А.", employeeFull: "Абдыразакова Гулзат Абдырасуловна", employeeInn: "11805199300720", socialCode: "203000133231", coate: "41708209000000", monthly161: 3123, lastQ4tax: 2611 },
    { name: "Беловодск", rayonCode: "010", employee: "Аламанова Д.Б.", employeeFull: "Аламанова Дилбара Байгазыевна", employeeInn: "11805199300720", socialCode: "203000133231", coate: "41708209000000", monthly161: 3123, lastQ4tax: 1105 },
    { name: "Сокулук", rayonCode: "012", employee: "Токтобекова А.Б.", employeeFull: "Токтобекова Аделя Бархатовна", employeeInn: "11805199300720", socialCode: "203000133231", coate: "41708209000000", monthly161: 3123, lastQ4tax: 1381 },
  ],
  monthly161total: 3123 * 3,
  lastQ4total: 2611 + 1105 + 1381,
};

/* ───────── periods ───────── */

function getCurrentPeriods() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const reportMonth = month === 0 ? 11 : month - 1;
  const reportYear = month === 0 ? year - 1 : year;
  const currentQuarter = Math.floor(month / 3);
  const reportQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
  const reportQYear = currentQuarter === 0 ? year - 1 : year;
  const qLabels: Record<number, string> = { 0: "Q1 (янв-мар)", 1: "Q2 (апр-июн)", 2: "Q3 (июл-сен)", 3: "Q4 (окт-дек)" };
  const deadlineDate = new Date(year, month, 20);
  const daysLeft = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    monthly: { month: monthNames[reportMonth], year: reportYear },
    quarterly: { quarter: qLabels[reportQuarter], year: reportQYear },
    daysLeft,
    deadlineDate: `20.${String(month + 1).padStart(2, "0")}.${year}`,
    isQuarterlyDue: [0, 3, 6, 9].includes(month),
  };
}

/* ───────── XML generation ───────── */

function generate161XML() {
  const p = getCurrentPeriods();
  const monthNum = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"].indexOf(p.monthly.month);
  const lastDay = new Date(p.monthly.year, monthNum + 1, 0).getDate();
  const sd = `01.${String(monthNum + 1).padStart(2, "0")}.${p.monthly.year}`;
  const ed = `${lastDay}.${String(monthNum + 1).padStart(2, "0")}.${p.monthly.year}`;
  const today = new Date();
  const dr = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<FORM DATEREPORT="${dr}" NOMDOC="0" IDFORM="161_6" VERSFORM="1.01">
  <PART1><FTYPE>0</FTYPE><STARTDATE>${sd}</STARTDATE><ENDDATE>${ed}</ENDDATE></PART1>
  <PART2>
    <FULLNAME>Момбеков Болот Артурович</FULLNAME><TIN>22006199900268</TIN><RAYONCODE>008</RAYONCODE>
    <GOSKOMSTATCODE>33484817</GOSKOMSTATCODE><STI161X121>20951</STI161X121><STI161X120>25589</STI161X120>
    <STI161X117>008200022132</STI161X117><STI161X118>1</STI161X118><STI161X119>СПИНО</STI161X119>
    <STI161X130>41708206600010</STI161X130><STI161X131>47.19.0</STI161X131><STI161X132>ип</STI161X132>
    <STI161X133>20</STI161X133><STI161X134>20</STI161X134>
    <STI161X203>1</STI161X203><STI161X204>22500</STI161X204><STI161X205>0</STI161X205>
    <STI161X206>2900</STI161X206><STI161X207>19600</STI161X207><STI161X208>1960</STI161X208>
    <STI161X209>0</STI161X209><STI161X210>1960</STI161X210><STI161X211>22500</STI161X211>
    <STI161X212>1960</STI161X212><STI161X213>2306.25</STI161X213><STI161X214>450</STI161X214>
    <STI161_6DECLARATIONDETAIL>
      <STI161_1X270>0</STI161_1X270><STI161_1X271>20</STI161_1X271><STI161_1X272>0</STI161_1X272>
      <STI161_1X273>506.25</STI161_1X273><STI161_1X274>0</STI161_1X274><STI161_1X275>650</STI161_1X275>
      <STI161_1X276>2250</STI161_1X276><STI161_1X277>0</STI161_1X277><STI161_1X278>0</STI161_1X278>
      <STI161_1X279>0</STI161_1X279><STI161_1X250>1</STI161_1X250>
      <STI161_1X251>11106200850547</STI161_1X251>
      <STI161_1X252>Токтомушева Аэлина Мирлановна</STI161_1X252>
      <STI161_1X253>001</STI161_1X253><STI161_1X254>KGZ</STI161_1X254><STI161_1X255>1</STI161_1X255>
      <STI161_1X256>${sd}</STI161_1X256><STI161_1X257>${ed}</STI161_1X257>
      <STI161_1X258>15</STI161_1X258><STI161_1X259>001</STI161_1X259>
      <STI161_1X260>22500</STI161_1X260><STI161_1X261>22500</STI161_1X261><STI161_1X262>0</STI161_1X262>
      <STI161_1X263>2900</STI161_1X263><STI161_1X264>19600</STI161_1X264><STI161_1X265>1960</STI161_1X265>
      <STI161_1X266>0</STI161_1X266><STI161_1X267>1960</STI161_1X267>
      <STI161_1X268>2306.25</STI161_1X268><STI161_1X269>450</STI161_1X269>
      <ISPREFERENTIAL>0</ISPREFERENTIAL><STI161_1X280>0</STI161_1X280>
    </STI161_6DECLARATIONDETAIL>
  </PART2>
</FORM>`;

  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${KANT.inn}_008_${sd.replace(/\./g, "-")}-${ed.replace(/\./g, "-")}_STI-161_6.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ───────── format ───────── */

function generateMama161XML(branchIdx: number) {
  const b = MAMA.branches[branchIdx];
  const p = getCurrentPeriods();
  const monthNum = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"].indexOf(p.monthly.month);
  const lastDay = new Date(p.monthly.year, monthNum + 1, 0).getDate();
  const sd = `01.${String(monthNum + 1).padStart(2, "0")}.${p.monthly.year}`;
  const ed = `${lastDay}.${String(monthNum + 1).padStart(2, "0")}.${p.monthly.year}`;
  const today = new Date();
  const dr = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<FORM DATEREPORT="${dr}" NOMDOC="0" IDFORM="161_6" VERSFORM="1.01">
  <PART1><FTYPE>0</FTYPE><STARTDATE>${sd}</STARTDATE><ENDDATE>${ed}</ENDDATE></PART1>
  <PART2>
    <FULLNAME>${MAMA.name.replace("ИП ", "")}</FULLNAME><TIN>${MAMA.inn}</TIN><RAYONCODE>${b.rayonCode}</RAYONCODE>
    <GOSKOMSTATCODE>${MAMA.goskomstat}</GOSKOMSTATCODE><STI161X121>21170</STI161X121><STI161X120>25088</STI161X120>
    <STI161X117>${b.socialCode}</STI161X117><STI161X118>1</STI161X118><STI161X119>СПИНО</STI161X119>
    <STI161X130>${b.coate}</STI161X130><STI161X131>47.19.0</STI161X131><STI161X132>ип</STI161X132>
    <STI161X133>20</STI161X133><STI161X134>20</STI161X134>
    <STI161X203>1</STI161X203><STI161X204>15000</STI161X204><STI161X205>0</STI161X205>
    <STI161X206>2150</STI161X206><STI161X207>12850</STI161X207><STI161X208>1285</STI161X208>
    <STI161X209>0</STI161X209><STI161X210>1285</STI161X210><STI161X211>15000</STI161X211>
    <STI161X212>1285</STI161X212><STI161X213>1537.5</STI161X213><STI161X214>300</STI161X214>
    <STI161_6DECLARATIONDETAIL>
      <STI161_1X270>0</STI161_1X270><STI161_1X271>20</STI161_1X271><STI161_1X272>0</STI161_1X272>
      <STI161_1X273>337.5</STI161_1X273><STI161_1X274>0</STI161_1X274><STI161_1X275>650</STI161_1X275>
      <STI161_1X276>1500</STI161_1X276><STI161_1X277>0</STI161_1X277><STI161_1X278>0</STI161_1X278>
      <STI161_1X279>0</STI161_1X279><STI161_1X250>1</STI161_1X250>
      <STI161_1X251>${b.employeeInn}</STI161_1X251>
      <STI161_1X252>${b.employeeFull}</STI161_1X252>
      <STI161_1X253>001</STI161_1X253><STI161_1X254>KGZ</STI161_1X254><STI161_1X255>1</STI161_1X255>
      <STI161_1X256>${sd}</STI161_1X256><STI161_1X257>${ed}</STI161_1X257>
      <STI161_1X258>10</STI161_1X258><STI161_1X259>001</STI161_1X259>
      <STI161_1X260>15000</STI161_1X260><STI161_1X261>15000</STI161_1X261><STI161_1X262>0</STI161_1X262>
      <STI161_1X263>2150</STI161_1X263><STI161_1X264>12850</STI161_1X264><STI161_1X265>1285</STI161_1X265>
      <STI161_1X266>0</STI161_1X266><STI161_1X267>1285</STI161_1X267>
      <STI161_1X268>1537.5</STI161_1X268><STI161_1X269>300</STI161_1X269>
      <ISPREFERENTIAL>0</ISPREFERENTIAL><STI161_1X280>0</STI161_1X280>
    </STI161_6DECLARATIONDETAIL>
  </PART2>
</FORM>`;

  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${MAMA.inn}_${b.rayonCode}_${sd.replace(/\./g, "-")}-${ed.replace(/\./g, "-")}_STI-161_6_${b.name}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ───────── done tracking ───────── */

function getDoneKey(label: string) {
  const p = getCurrentPeriods();
  return `refocus.tax.done.${label}.${p.monthly.month}.${p.monthly.year}`;
}

function fmtKGS(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n)) + " сом";
}

/* ───────── UI components ───────── */

function GlassSection({ children, className = "", tone = "money" }: { children: React.ReactNode; className?: string; tone?: "money" | "danger" | "warning" | "neutral" }) {
  const bg = tone === "danger" ? "from-white via-rose-50 to-amber-50/85" : tone === "warning" ? "from-white via-amber-50 to-orange-50/85" : tone === "neutral" ? "from-white via-slate-50 to-slate-50/85" : "from-white via-slate-50 to-sky-50/85";
  const ring = tone === "danger" ? "ring-rose-200/80" : tone === "warning" ? "ring-amber-200/80" : tone === "neutral" ? "ring-slate-200/80" : "ring-sky-200/80";
  return <div className={`rounded-3xl bg-gradient-to-br ${bg} ring-1 ${ring} backdrop-blur-xl shadow-[0_22px_70px_rgba(15,23,42,0.20)] ${className}`}>{children}</div>;
}

function Btn({ children, primary, onClick, href }: { children: React.ReactNode; primary?: boolean; onClick?: () => void; href?: string }) {
  const cls = primary
    ? "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 shadow-[0_18px_55px_rgba(34,197,235,0.55)] hover:opacity-95"
    : "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium bg-white/85 hover:bg-white text-teal-700 ring-1 ring-teal-200 shadow-[0_14px_40px_rgba(15,23,42,0.12)]";
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{children}</a>;
  return <button onClick={onClick} className={cls}>{children}</button>;
}

/* ───────── MAIN PAGE ───────── */

export default function TaxesPage() {
  const periods = useMemo(() => getCurrentPeriods(), []);
  const urgentDeadlines = periods.daysLeft <= 7 && periods.daysLeft > 0;
  const overdueDeadlines = periods.daysLeft <= 0;

  // Done tracking (localStorage)
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const keys = ["kant161", "kant091", "mama161_0", "mama161_1", "mama161_2", "mama091"];
    const d: Record<string, boolean> = {};
    keys.forEach(k => { d[k] = localStorage.getItem(getDoneKey(k)) === "1"; });
    setDone(d);
  }, []);
  function toggleDone(key: string) {
    const newVal = !done[key];
    localStorage.setItem(getDoneKey(key), newVal ? "1" : "0");
    setDone(prev => ({ ...prev, [key]: newVal }));
  }

  // Quarterly revenue for Kant
  const [quarterRevenue, setQuarterRevenue] = useState<number | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const q = periods.quarterly;
        const qNum = q.quarter.startsWith("Q1") ? 0 : q.quarter.startsWith("Q2") ? 1 : q.quarter.startsWith("Q3") ? 2 : 3;
        const startMonth = qNum * 3;
        const from = `${q.year}-${String(startMonth + 1).padStart(2, "0")}-01`;
        const toDate = new Date(q.year, startMonth + 3, 0);
        const to = `${q.year}-${String(startMonth + 3).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;
        const { data, error } = await sb.from("orders").select("paid_amount").eq("branch_id", 4).gte("created_at", from).lte("created_at", to + "T23:59:59").eq("status", "DELIVERED").neq("is_deleted", true);
        if (!error && data) setQuarterRevenue(data.reduce((s: number, r: any) => s + (Number(r.paid_amount) || 0), 0));
      } catch {} finally { setRevenueLoading(false); }
    })();
  }, [periods.quarterly]);

  return (
    <div className="space-y-5">

      {/* ═══ HEADER ═══ */}
      <GlassSection className="px-5 py-5 sm:px-6" tone="money">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 blur-xl opacity-35" />
            <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_18px_55px_rgba(34,197,235,0.70)]">
              <Landmark className="h-5 w-5" />
            </div>
          </div>
          <div>
            <h1 className="text-[22px] md:text-[30px] font-semibold text-slate-900">Налоги</h1>
            <p className="mt-0.5 text-xs text-slate-500">Дедлайн: <span className={urgentDeadlines || overdueDeadlines ? "text-amber-600 font-semibold" : "font-medium text-slate-700"}>{periods.deadlineDate}</span> {overdueDeadlines ? "(просрочено!)" : `(через ${periods.daysLeft} дн.)`}</p>
          </div>
        </div>
      </GlassSection>

      {/* ═══ WHAT TO DO ═══ */}
      <GlassSection className="px-5 py-5 sm:px-6" tone={overdueDeadlines ? "danger" : urgentDeadlines ? "warning" : "money"}>
        <div className="flex items-center gap-3 mb-4">
          {overdueDeadlines || urgentDeadlines
            ? <AlertTriangle className={`h-5 w-5 shrink-0 ${overdueDeadlines ? "text-red-500" : "text-amber-500"}`} />
            : <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          }
          <p className={`text-sm font-semibold ${overdueDeadlines ? "text-red-700" : urgentDeadlines ? "text-amber-700" : "text-emerald-700"}`}>
            {overdueDeadlines ? "Срок подачи истёк!" : urgentDeadlines ? `Осталось ${periods.daysLeft} дн. — до ${periods.deadlineDate}` : "Все отчёты поданы"}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* 161 */}
          <div className="rounded-xl bg-white/70 ring-1 ring-sky-200/50 p-4">
            <p className="text-sm font-semibold text-slate-900 mb-1">161 — зарплатный отчёт</p>
            <div className="text-[12px] text-slate-600 space-y-1">
              <p>В него входят: <span className="font-medium">подоходный налог</span> + <span className="font-medium">страховые взносы</span></p>
              <p>Подаётся <span className="font-medium">каждый месяц до 20-го числа</span></p>
              <p>Срок: <span className="font-medium text-slate-900">{periods.deadlineDate}</span></p>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200/40 flex justify-between text-[12px]">
              <span className="text-slate-500">Кант</span>
              <span className="font-semibold text-slate-900">{fmtKGS(KANT.monthly161)}</span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-slate-500">Мама × 3 филиала</span>
              <span className="font-semibold text-slate-900">{fmtKGS(3123 * 3)}</span>
            </div>
          </div>

          {/* 091 */}
          {periods.isQuarterlyDue && (
            <div className="rounded-xl bg-white/70 ring-1 ring-sky-200/50 p-4">
              <p className="text-sm font-semibold text-slate-900 mb-1">091 — единый налог</p>
              <div className="text-[12px] text-slate-600 space-y-1">
                <p>Налог от <span className="font-medium">выручки × 0.5%</span> (розничная торговля до 30 млн)</p>
                <p>Подаётся <span className="font-medium">раз в квартал до 20-го числа</span></p>
                <p>Срок: <span className="font-medium text-slate-900">{periods.deadlineDate}</span></p>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-200/40 flex justify-between text-[12px]">
                <span className="text-slate-500">Кант ({revenueLoading ? "..." : quarterRevenue !== null ? fmtKGS(quarterRevenue) : "—"})</span>
                <span className="font-semibold text-slate-900">{revenueLoading ? "..." : quarterRevenue !== null ? fmtKGS(Math.round(quarterRevenue * 0.005)) : "—"}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-slate-500">Мама × 3 филиала</span>
                <span className="font-semibold text-slate-900">{fmtKGS(1489 + 959 + 863)}</span>
              </div>
            </div>
          )}
        </div>
      </GlassSection>

      {/* ═══ TWO COLUMNS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* LEFT — KANT */}
        <GlassSection className="px-5 py-5 sm:px-6" tone="money">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-600 mb-4">ИП Момбеков · Кант</p>

          {/* Кант 161 */}
          <div className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3 mb-2">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-slate-900">Кант · 161 за {periods.monthly.month}</p>
                <p className="text-[11px] text-slate-400">{KANT.employee}</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{fmtKGS(KANT.monthly161)}</p>
                <button onClick={() => toggleDone("kant161")} className={`h-6 w-6 rounded-full flex items-center justify-center transition ${done.kant161 ? "bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300" : "bg-slate-100 text-slate-400 ring-1 ring-slate-200 hover:bg-slate-200"}`}>
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Btn primary onClick={() => { generate161XML(); window.open("https://cabinet.salyk.kg/report/sti161declaration/redirecttosti161helperfront", "_blank"); }}><Download className="h-4 w-4" /> XML Кант + Салык</Btn>
            </div>
          </div>

          {/* Кант 091 */}
          {periods.isQuarterlyDue && (
            <div className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3 mb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-slate-900">Кант · 091 единый за Q1</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{revenueLoading ? "..." : quarterRevenue !== null ? fmtKGS(Math.round(quarterRevenue * 0.005)) : "—"}</p>
                  <button onClick={() => toggleDone("kant091")} className={`h-6 w-6 rounded-full flex items-center justify-center transition ${done.kant091 ? "bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300" : "bg-slate-100 text-slate-400 ring-1 ring-slate-200 hover:bg-slate-200"}`}>
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-[12px] font-medium text-cyan-700 mb-2">выручка: {revenueLoading ? "..." : quarterRevenue !== null ? fmtKGS(quarterRevenue) : "—"} · район: 008 Иссыкатинский</p>
              <Btn href="https://cabinet.salyk.kg/report/sti091declaration/createform9"><ExternalLink className="h-4 w-4" /> 091 Салык</Btn>
            </div>
          )}

          {/* Итого + Оплата */}
          <div className="flex items-center justify-between mt-3 mb-3">
            <p className="text-sm font-semibold text-slate-700">Итого Кант</p>
            <p className="text-[20px] font-semibold text-slate-900">
              {revenueLoading ? "..." : fmtKGS(KANT.monthly161 + (quarterRevenue !== null ? Math.round(quarterRevenue * 0.005) : 0))}
            </p>
          </div>
          {/* Оплата */}
          <div className="mt-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Оплата</p>

            <div className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-slate-900">Подоходный налог</p>
                <p className="text-sm font-semibold text-slate-900">{fmtKGS(1960)}</p>
              </div>
              <div className="text-[11px] text-slate-500 space-y-0.5 mb-2">
                <p>Код УГНС: 008 Иссыкатинский · Мэрия г. Кант</p>
                <p>Вид налога: <span className="font-medium text-slate-700">1000 — Подох. налог по декл.</span></p>
                <p>Код бюдж. классиф.: <span className="font-medium text-slate-700">Подох. налог по единой налог. декларации</span></p>
              </div>
              <Btn href="https://cabinet.salyk.kg/payment/pay/create"><ExternalLink className="h-4 w-4" /> Оплатить 1 960 сом</Btn>
            </div>

            <div className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-slate-900">Страховые взносы</p>
                <p className="text-sm font-semibold text-slate-900">{fmtKGS(2756)}</p>
              </div>
              <div className="text-[11px] text-slate-500 space-y-0.5 mb-2">
                <p>Код УГНС: 008 Иссыкатинский · Мэрия г. Кант</p>
                <p>Код бюдж. классиф.: <span className="font-medium text-slate-700">12111110 — Пенс. фонд, ФОМС, оздоровление</span></p>
                <p>Работодатель: {fmtKGS(2306)} + Работник: {fmtKGS(450)}</p>
              </div>
              <Btn href="https://cabinet.salyk.kg/payment/insurancepremium/create"><ExternalLink className="h-4 w-4" /> Оплатить 2 756 сом</Btn>
            </div>

            {periods.isQuarterlyDue && (
              <div className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-slate-900">Единый налог</p>
                  <p className="text-sm font-semibold text-slate-900">{revenueLoading ? "..." : quarterRevenue !== null ? fmtKGS(Math.round(quarterRevenue * 0.005)) : "—"}</p>
                </div>
                <div className="text-[11px] text-slate-500 space-y-0.5 mb-2">
                  <p>Код УГНС: 008 Иссыкатинский · Мэрия г. Кант</p>
                  <p>Вид налога: <span className="font-medium text-slate-700">1130 — Единый налог</span></p>
                </div>
                <Btn href="https://cabinet.salyk.kg/payment/pay/create"><ExternalLink className="h-4 w-4" /> Оплатить {revenueLoading ? "..." : quarterRevenue !== null ? fmtKGS(Math.round(quarterRevenue * 0.005)) : ""}</Btn>
              </div>
            )}
          </div>
        </GlassSection>

        {/* RIGHT — MAMA */}
        <GlassSection className="px-5 py-5 sm:px-6" tone="money">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-600 mb-4">ИП Кудайкулова · 3 филиала</p>

          {/* Кара-Балта */}
          <div className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3 mb-2">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-sm font-medium text-slate-900">Кара-Балта · 161 за {periods.monthly.month}</p>
                <p className="text-[11px] text-slate-400">{MAMA.branches[0].employee}</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{fmtKGS(3123)}</p>
                <button onClick={() => toggleDone("mama161_0")} className={`h-6 w-6 rounded-full flex items-center justify-center transition ${done.mama161_0 ? "bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300" : "bg-slate-100 text-slate-400 ring-1 ring-slate-200 hover:bg-slate-200"}`}>
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Btn primary onClick={() => generateMama161XML(0)}><Download className="h-4 w-4" /> XML Кара-Балта</Btn>
              {periods.isQuarterlyDue && <Btn href="https://cabinet.salyk.kg/report/sti091declaration/createform9"><ExternalLink className="h-4 w-4" /> 091 Кара-Балта</Btn>}
            </div>
            {periods.isQuarterlyDue && <p className="text-[12px] font-medium text-cyan-700 mt-2">091: выручка {fmtKGS(297720)} · район: 009 Жайылский · налог: {fmtKGS(1489)}</p>}
          </div>

          {/* Беловодск */}
          <div className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3 mb-2">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-sm font-medium text-slate-900">Беловодск · 161 за {periods.monthly.month}</p>
                <p className="text-[11px] text-slate-400">{MAMA.branches[1].employee}</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{fmtKGS(3123)}</p>
                <button onClick={() => toggleDone("mama161_1")} className={`h-6 w-6 rounded-full flex items-center justify-center transition ${done.mama161_1 ? "bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300" : "bg-slate-100 text-slate-400 ring-1 ring-slate-200 hover:bg-slate-200"}`}>
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Btn primary onClick={() => generateMama161XML(1)}><Download className="h-4 w-4" /> XML Беловодск</Btn>
              {periods.isQuarterlyDue && <Btn href="https://cabinet.salyk.kg/report/sti091declaration/createform9"><ExternalLink className="h-4 w-4" /> 091 Беловодск</Btn>}
            </div>
            {periods.isQuarterlyDue && <p className="text-[12px] font-medium text-cyan-700 mt-2">091: выручка ~{fmtKGS(172584)} · район: 010 Московский · налог: {fmtKGS(863)}</p>}
          </div>

          {/* Сокулук */}
          <div className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3 mb-2">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-sm font-medium text-slate-900">Сокулук · 161 за {periods.monthly.month}</p>
                <p className="text-[11px] text-slate-400">{MAMA.branches[2].employee}</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{fmtKGS(3123)}</p>
                <button onClick={() => toggleDone("mama161_2")} className={`h-6 w-6 rounded-full flex items-center justify-center transition ${done.mama161_2 ? "bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300" : "bg-slate-100 text-slate-400 ring-1 ring-slate-200 hover:bg-slate-200"}`}>
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Btn primary onClick={() => generateMama161XML(2)}><Download className="h-4 w-4" /> XML Сокулук</Btn>
              {periods.isQuarterlyDue && <Btn href="https://cabinet.salyk.kg/report/sti091declaration/createform9"><ExternalLink className="h-4 w-4" /> 091 Сокулук</Btn>}
            </div>
            {periods.isQuarterlyDue && <p className="text-[12px] font-medium text-cyan-700 mt-2">091: выручка {fmtKGS(191760)} · район: 012 Сокулукский · налог: {fmtKGS(959)}</p>}
          </div>

          {/* Итого + Оплата */}
          <div className="flex items-center justify-between mt-3 mb-3">
            <p className="text-sm font-semibold text-slate-700">Итого мама</p>
            <p className="text-[20px] font-semibold text-slate-900">{fmtKGS(3123 * 3 + 1489 + 959 + 863)}</p>
          </div>
          {/* Оплата */}
          {/* Оплата по филиалам */}
          <div className="mt-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Оплата — 3 раза по каждому филиалу</p>

            {[
              { name: "Кара-Балта", rayon: "009 Жайылский", tax091: 1489 },
              { name: "Беловодск", rayon: "010 Московский", tax091: 863 },
              { name: "Сокулук", rayon: "012 Сокулукский", tax091: 959 },
            ].map((f, i) => (
              <div key={i} className="rounded-xl bg-white/60 ring-1 ring-sky-200/40 p-3">
                <p className="text-[12px] font-semibold text-cyan-700 mb-2">{f.name} · {f.rayon}</p>
                <div className="space-y-1.5 text-[11px] mb-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Подоходный (1000 — Подох. налог по декл.)</span>
                    <span className="font-semibold text-slate-900">{fmtKGS(1285)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Страховые (12111110 — Пенс. фонд, ФОМС)</span>
                    <span className="font-semibold text-slate-900">{fmtKGS(1838)}</span>
                  </div>
                  {periods.isQuarterlyDue && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Единый (1130 — Единый налог)</span>
                      <span className="font-semibold text-slate-900">{fmtKGS(f.tax091)}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Btn href="https://cabinet.salyk.kg/payment/pay/create"><ExternalLink className="h-4 w-4" /> Налоги</Btn>
                  <Btn href="https://cabinet.salyk.kg/payment/insurancepremium/create"><ExternalLink className="h-4 w-4" /> Страховые</Btn>
                </div>
              </div>
            ))}
          </div>
        </GlassSection>

      </div>

      {/* ═══ TAX PROFILES ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GlassSection className="px-5 py-5 sm:px-6" tone="neutral">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Налоговый профиль · Кант</p>
          <div className="space-y-2">
            {[
              { l: "ФИО", v: KANT.name },
              { l: "ИНН", v: KANT.inn },
              { l: "Район", v: KANT.rayon },
              { l: "Режим", v: KANT.regime },
            ].map((r, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-slate-500">{r.l}</span>
                <span className="font-medium text-slate-900">{r.v}</span>
              </div>
            ))}
            <div className="h-px bg-slate-200/40 my-1" />
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Сотрудник (страховые взносы)</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Кант</span>
              <span className="font-medium text-slate-900">Токтомушева Аэлина Мирлановна</span>
            </div>
            <div className="h-px bg-slate-200/40 my-1" />
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Вход в cabinet.salyk.kg</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Логин</span>
              <span className="font-mono font-medium text-slate-900">{KANT.login}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Пароль</span>
              <span className="font-mono font-medium text-slate-900">{KANT.password}</span>
            </div>
          </div>
        </GlassSection>

        <GlassSection className="px-5 py-5 sm:px-6" tone="neutral">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Налоговый профиль · Мама</p>
          <div className="space-y-2">
            {[
              { l: "ФИО", v: MAMA.name },
              { l: "ИНН", v: MAMA.inn },
              { l: "Районы", v: MAMA.rayon },
              { l: "Режим", v: MAMA.regime },
            ].map((r, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-slate-500">{r.l}</span>
                <span className="font-medium text-slate-900">{r.v}</span>
              </div>
            ))}
            <div className="h-px bg-slate-200/40 my-1" />
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Сотрудники (страховые взносы)</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Кара-Балта</span>
              <span className="font-medium text-slate-900">Абдыразакова Гулзат Абдырасуловна</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Беловодск</span>
              <span className="font-medium text-slate-900">Аламанова Дилбара Байгазыевна</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Сокулук</span>
              <span className="font-medium text-slate-900">Токтобекова Аделя Бархатовна</span>
            </div>
            <div className="h-px bg-slate-200/40 my-1" />
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Вход в cabinet.salyk.kg</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Логин</span>
              <span className="font-mono font-medium text-slate-900">{MAMA.login}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Пароль</span>
              <span className="font-mono font-medium text-slate-900">{MAMA.password}</span>
            </div>
          </div>
        </GlassSection>
      </div>

    </div>
  );
}
