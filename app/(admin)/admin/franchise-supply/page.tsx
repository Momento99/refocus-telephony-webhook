'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, Package, CheckCircle2, Clock, Truck, AlertTriangle,
  ChevronDown, ChevronUp, Send, XCircle, Settings2, ShoppingCart,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';

type SupplyOrder = {
  id: number; branch_id: number; status: string; items: any[]; notes: string | null;
  sent_at: string; created_at: string; branch_name?: string; country_id?: string;
};

type SupplyPlan = {
  id?: string; branch_id: number; branch_name: string; country_id: string;
  sales_per_day: number; plan_months: number;
  bags_per_sale: number; cases_per_sale: number; cloths_per_sale: number; premium_pct: number;
};

type PlanResult = {
  branch_id: number; sales_per_day: number; plan_months: number;
  work_days: number; total_sales: number;
  consumables: { bags: { plan: number }; cases: { plan: number }; cloths: { plan: number }; premium_kits: { plan: number } };
  lenses: { lens_type: string; sold_3m: number; plan: number }[];
};

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  sent: { label: 'Новый', color: 'bg-amber-50 text-amber-700 ring-amber-200', icon: Clock },
  confirmed: { label: 'Подтверждён', color: 'bg-sky-50 text-sky-700 ring-sky-200', icon: CheckCircle2 },
  shipped: { label: 'В пути', color: 'bg-violet-50 text-violet-700 ring-violet-200', icon: Truck },
  delivered: { label: 'Доставлен', color: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2 },
  rejected: { label: 'Отклонён', color: 'bg-rose-50 text-rose-700 ring-rose-200', icon: XCircle },
};

const NEXT_STATUS: Record<string, { status: string; label: string; color: string }> = {
  sent: { status: 'confirmed', label: 'Подтвердить', color: 'bg-sky-500 hover:bg-sky-600' },
  confirmed: { status: 'shipped', label: 'Отправить', color: 'bg-violet-500 hover:bg-violet-600' },
  shipped: { status: 'delivered', label: 'Доставлен', color: 'bg-emerald-500 hover:bg-emerald-600' },
};

const COUNTRY_BG: Record<string, string> = { kg: '#ef4444', kz: '#22d3ee', uz: '#10b981', ru: '#8b5cf6' };
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function FranchiseSupplyPage() {
  const [tab, setTab] = useState<'orders' | 'plans'>('orders');
  const [orders, setOrders] = useState<SupplyOrder[]>([]);
  const [plans, setPlans] = useState<SupplyPlan[]>([]);
  const [planResults, setPlanResults] = useState<Record<number, PlanResult>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [expandedPlan, setExpandedPlan] = useState<Set<number>>(new Set());
  const sbRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);
  function sb() { if (!sbRef.current) sbRef.current = getBrowserSupabase(); return sbRef.current; }

  async function loadOrders() {
    const { data } = await sb().from('franchise_supply_orders').select('*, branches(name, country_id)').order('created_at', { ascending: false });
    setOrders((data ?? []).map((o: any) => ({ ...o, branch_name: o.branches?.name, country_id: o.branches?.country_id })));
  }

  async function loadPlans() {
    const [plansRes, branchesRes] = await Promise.all([
      sb().from('franchise_supply_plans').select('*'),
      sb().from('branches').select('id, name, country_id, organization_id').not('organization_id', 'is', null).order('id'),
    ]);
    const planMap = new Map((plansRes.data ?? []).map((p: any) => [p.branch_id, p]));
    const allPlans = (branchesRes.data ?? []).map((b: any) => ({
      ...(planMap.get(b.id) ?? {}),
      branch_id: b.id, branch_name: b.name, country_id: b.country_id,
      sales_per_day: planMap.get(b.id)?.sales_per_day ?? 5,
      plan_months: planMap.get(b.id)?.plan_months ?? 2,
      bags_per_sale: planMap.get(b.id)?.bags_per_sale ?? 1,
      cases_per_sale: planMap.get(b.id)?.cases_per_sale ?? 1,
      cloths_per_sale: planMap.get(b.id)?.cloths_per_sale ?? 1,
      premium_pct: planMap.get(b.id)?.premium_pct ?? 10,
    }));
    setPlans(allPlans);
  }

  async function loadPlanResult(branchId: number) {
    const { data } = await sb().rpc('calculate_supply_plan', { p_branch_id: branchId });
    if (data) setPlanResults(prev => ({ ...prev, [branchId]: data as PlanResult }));
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadOrders(), loadPlans()]);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function updateStatus(orderId: number, newStatus: string) {
    await sb().from('franchise_supply_orders').update({ status: newStatus }).eq('id', orderId);
    toast.success(`Статус обновлён: ${STATUS_MAP[newStatus]?.label}`);
    loadOrders();
  }

  async function savePlan(plan: SupplyPlan) {
    const { error } = await sb().from('franchise_supply_plans').upsert({
      branch_id: plan.branch_id,
      sales_per_day: plan.sales_per_day, plan_months: plan.plan_months,
      bags_per_sale: plan.bags_per_sale, cases_per_sale: plan.cases_per_sale,
      cloths_per_sale: plan.cloths_per_sale, premium_pct: plan.premium_pct,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id' });
    if (error) toast.error(error.message);
    else { toast.success('План сохранён'); loadPlanResult(plan.branch_id); }
  }

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter);
  const newCount = orders.filter(o => o.status === 'sent').length;

  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">
      {/* Header */}
      <div className="px-5 pt-8 pb-6 max-w-5xl mx-auto">
        <div className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_8px_32px_rgba(15,23,42,0.08)] px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-[0_4px_22px_rgba(245,158,11,0.4)] shrink-0" style={{ background: '#f59e0b' }}>
              <Package size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-[24px] font-bold text-[#0f172a] leading-tight tracking-tight">Снабжение франшизы</h1>
              <p className="text-[13px] text-slate-500 mt-0.5">Заказы от франчайзи и планы снабжения</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Tab switcher */}
            <div className="flex rounded-xl ring-1 ring-slate-200 overflow-hidden">
              <button onClick={() => setTab('orders')} className={`px-4 py-2.5 text-[12px] font-semibold transition-all flex items-center gap-1.5 ${tab === 'orders' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                <ShoppingCart size={14} /> Заказы {newCount > 0 && <span className="bg-white/20 text-white text-[10px] font-bold rounded-full px-1.5">{newCount}</span>}
              </button>
              <button onClick={() => setTab('plans')} className={`px-4 py-2.5 text-[12px] font-semibold transition-all flex items-center gap-1.5 ${tab === 'plans' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                <Settings2 size={14} /> Планы
              </button>
            </div>
            <button onClick={loadAll} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-all">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <Link href="/admin/franchise-map" className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-all">
              <ArrowLeft size={15} />
            </Link>
          </div>
        </div>
      </div>

      <div className="px-5 max-w-5xl mx-auto pb-12 space-y-4">
        {loading && <div className="flex justify-center py-20"><div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-amber-400 animate-spin" /></div>}

        {/* ═══ TAB: ORDERS ═══ */}
        {!loading && tab === 'orders' && (
          <>
            {/* Filters */}
            <div className="flex gap-2">
              {[{ k: 'all', l: `Все (${orders.length})` }, { k: 'sent', l: `Новые (${orders.filter(o => o.status === 'sent').length})` },
                { k: 'confirmed', l: 'Подтверждён' }, { k: 'shipped', l: 'В пути' }, { k: 'delivered', l: 'Доставлен' }].map(f => (
                <button key={f.k} onClick={() => setFilter(f.k)}
                  className={`px-4 py-2 rounded-xl text-[12px] font-semibold transition-all ${filter === f.k ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
                  {f.l}
                </button>
              ))}
            </div>

            {filtered.length === 0 && <div className="rounded-3xl bg-white ring-1 ring-slate-200 px-6 py-16 text-center text-[13px] text-slate-400">Нет заказов</div>}

            {filtered.map(order => {
              const st = STATUS_MAP[order.status] ?? STATUS_MAP.sent;
              const next = NEXT_STATUS[order.status];
              const isExp = expanded.has(order.id);
              const StIcon = st.icon;

              return (
                <div key={order.id} className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_4px_24px_rgba(15,23,42,0.06)] overflow-hidden">
                  <div className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-all"
                    onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(order.id) ? n.delete(order.id) : n.add(order.id); return n; })}>
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-[13px] shadow-md" style={{ background: COUNTRY_BG[order.country_id ?? 'kg'] }}>
                        {(order.country_id ?? 'kg').toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[15px] text-slate-800">{order.branch_name}</span>
                          <span className="text-[11px] text-slate-400">#{order.id}</span>
                        </div>
                        <div className="text-[12px] text-slate-400 mt-0.5">{fmtDate(order.sent_at || order.created_at)} &middot; {order.items?.length ?? 0} позиций</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-3 py-1 ring-1 ${st.color}`}>
                        <StIcon size={12} /> {st.label}
                      </span>
                      {next && (
                        <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, next.status); }}
                          className={`px-4 py-2 rounded-xl text-white text-[12px] font-semibold shadow-md transition-all ${next.color}`}>
                          {next.label}
                        </button>
                      )}
                      {order.status === 'sent' && (
                        <button onClick={(e) => { e.stopPropagation(); if (confirm('Отклонить заказ?')) updateStatus(order.id, 'rejected'); }}
                          className="p-2 rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                          <XCircle size={16} />
                        </button>
                      )}
                      {isExp ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </div>

                  {isExp && (
                    <div className="border-t border-slate-100 px-6 py-4 space-y-4">
                      <OrderItemsMatrix items={order.items ?? []} />
                      {order.notes && (
                        <div className="mt-2 pt-2 border-t border-slate-100 text-[12px] text-slate-500">
                          <span className="font-semibold text-slate-600">Примечание:</span> {order.notes}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* ═══ TAB: PLANS ═══ */}
        {!loading && tab === 'plans' && (
          <div className="space-y-4">
            {plans.map(plan => {
              const isExp = expandedPlan.has(plan.branch_id);
              const result = planResults[plan.branch_id];

              return (
                <div key={plan.branch_id} className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_4px_24px_rgba(15,23,42,0.06)] overflow-hidden">
                  <div className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-all"
                    onClick={() => { setExpandedPlan(prev => { const n = new Set(prev); n.has(plan.branch_id) ? n.delete(plan.branch_id) : n.add(plan.branch_id); return n; }); if (!result) loadPlanResult(plan.branch_id); }}>
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-[13px] shadow-md" style={{ background: COUNTRY_BG[plan.country_id] }}>
                        {plan.country_id.toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-[15px] text-slate-800">{plan.branch_name}</div>
                        <div className="text-[12px] text-slate-400 mt-0.5">{plan.sales_per_day} продаж/день &middot; запас на {plan.plan_months} мес.</div>
                      </div>
                    </div>
                    {isExp ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>

                  {isExp && (
                    <div className="border-t border-slate-100 px-6 py-4 space-y-4">
                      {/* Параметры */}
                      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
                        {[
                          { label: 'Продаж/день', value: plan.sales_per_day, key: 'sales_per_day' },
                          { label: 'Месяцев', value: plan.plan_months, key: 'plan_months' },
                          { label: 'Пакеты/прод.', value: plan.bags_per_sale, key: 'bags_per_sale' },
                          { label: 'Футляры/прод.', value: plan.cases_per_sale, key: 'cases_per_sale' },
                          { label: 'Платочки/прод.', value: plan.cloths_per_sale, key: 'cloths_per_sale' },
                          { label: 'Премиум %', value: plan.premium_pct, key: 'premium_pct' },
                        ].map(f => (
                          <div key={f.key}>
                            <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">{f.label}</div>
                            <input value={f.value} onChange={e => setPlans(prev => prev.map(p => p.branch_id === plan.branch_id ? { ...p, [f.key]: Number(e.target.value) || 0 } : p))}
                              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-center ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-amber-400 font-bold" />
                          </div>
                        ))}
                      </div>
                      <button onClick={() => savePlan(plan)} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-600 transition-all">
                        Сохранить план
                      </button>

                      {/* Результат */}
                      {result && (
                        <div className="space-y-3">
                          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Расчёт: {result.work_days} рабочих дней, {result.total_sales} продаж</div>

                          <div className="grid grid-cols-4 gap-2">
                            {[
                              { label: 'Пакеты', plan: result.consumables.bags.plan },
                              { label: 'Футляры', plan: result.consumables.cases.plan },
                              { label: 'Платочки', plan: result.consumables.cloths.plan },
                              { label: 'Премиум', plan: result.consumables.premium_kits.plan },
                            ].map(c => (
                              <div key={c.label} className="rounded-xl bg-amber-50 ring-1 ring-amber-100 px-3 py-2.5 text-center">
                                <div className="text-[18px] font-bold text-amber-700">{c.plan}</div>
                                <div className="text-[10px] text-amber-500 font-semibold mt-0.5">{c.label}</div>
                              </div>
                            ))}
                          </div>

                          {result.lenses.length > 0 && (
                            <div>
                              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Линзы — план по диоптриям</div>
                              <PlanLensMatrix lenses={result.lenses} lensSph={(result as any).lens_sph ?? []} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ Lens Matrix Component ═══ */

function OrderItemsMatrix({ items }: { items: any[] }) {
  // Парсим items: разделяем линзы (с SPH) и расходники
  const lensItems: { type: string; sph: number; qty: number }[] = [];
  const otherItems: { name: string; qty: number; note?: string }[] = [];

  for (const item of items) {
    const sphMatch = item.name?.match(/SPH\s*([+-]?\d+\.?\d*)/i);
    if (sphMatch) {
      // Извлекаем тип линзы (всё до SPH)
      const typePart = item.name.replace(/\s*SPH\s*[+-]?\d+\.?\d*/i, '').trim();
      lensItems.push({ type: typePart, sph: Number(sphMatch[1]), qty: item.qty });
    } else {
      otherItems.push(item);
    }
  }

  if (lensItems.length === 0) {
    // Нет линз — просто список
    return (
      <div className="space-y-1">
        {items.map((item: any, i: number) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
            <span className="text-[13px] text-slate-700">{item.name}</span>
            <span className="text-[14px] font-bold text-slate-800">&times;{item.qty}</span>
          </div>
        ))}
      </div>
    );
  }

  // Группируем: type → sph → qty
  const types = [...new Set(lensItems.map(l => l.type))];
  const allSphs = [...new Set(lensItems.map(l => l.sph))].sort((a, b) => a - b);
  const lookup = new Map<string, number>();
  for (const l of lensItems) {
    const key = `${l.type}|${l.sph}`;
    lookup.set(key, (lookup.get(key) ?? 0) + l.qty);
  }

  return (
    <div className="space-y-4">
      {/* Матрица линз */}
      <div>
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Линзы</div>
        <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-2.5 text-left font-bold text-slate-600 sticky left-0 bg-slate-50 z-10 min-w-[160px] border-r border-slate-200">Тип линзы</th>
                {allSphs.map(s => (
                  <th key={s} className="px-1.5 py-2.5 text-center font-mono font-bold text-slate-500 min-w-[36px] whitespace-nowrap">
                    {s > 0 ? `+${s}` : String(s)}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-bold text-slate-700 bg-amber-50 border-l border-slate-200">Всего</th>
              </tr>
            </thead>
            <tbody>
              {types.map(t => {
                const rowTotal = allSphs.reduce((s, sph) => s + (lookup.get(`${t}|${sph}`) ?? 0), 0);
                return (
                  <tr key={t} className="border-t border-slate-100 hover:bg-amber-50/20 transition-colors">
                    <td className="px-3 py-2 font-semibold text-[12px] text-slate-700 sticky left-0 bg-white z-10 border-r border-slate-100">{t}</td>
                    {allSphs.map(sph => {
                      const v = lookup.get(`${t}|${sph}`);
                      return (
                        <td key={sph} className="px-1.5 py-2 text-center font-mono">
                          {v ? <span className="inline-block min-w-[20px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[11px]">{v}</span> : <span className="text-slate-200">&middot;</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center font-bold text-amber-700 bg-amber-50/50 border-l border-slate-100">{rowTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Расходники */}
      {otherItems.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Расходники</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {otherItems.map((item, i) => (
              <div key={i} className="rounded-xl bg-slate-50 ring-1 ring-slate-100 px-4 py-3 flex items-center justify-between">
                <span className="text-[12px] font-medium text-slate-700">{item.name}</span>
                <span className="text-[16px] font-bold text-slate-800">{item.qty}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Plan Lens Matrix (from RPC data) ═══ */

function PlanLensMatrix({ lenses, lensSph }: { lenses: any[]; lensSph: any[] }) {
  if (!lensSph || lensSph.length === 0) {
    // Без SPH — просто карточки
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {lenses.map((l: any, i: number) => (
          <div key={i} className="rounded-xl bg-sky-50 ring-1 ring-sky-100 px-4 py-2.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-slate-700">{l.lens_type}</span>
            <span className="text-[16px] font-bold text-sky-700">{l.plan}</span>
          </div>
        ))}
      </div>
    );
  }

  const types = [...new Set(lensSph.map((d: any) => d.lens_type))];
  const sphs = [...new Set(lensSph.map((d: any) => Number(d.sph)))].sort((a, b) => a - b);
  const lookup = new Map(lensSph.map((d: any) => [`${d.lens_type}|${d.sph}`, d.plan]));

  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-slate-50">
            <th className="px-3 py-2.5 text-left font-bold text-slate-600 sticky left-0 bg-slate-50 z-10 min-w-[120px] border-r border-slate-200">Тип</th>
            {sphs.map(s => (
              <th key={s} className="px-1.5 py-2.5 text-center font-mono font-bold text-slate-500 min-w-[36px] whitespace-nowrap">
                {s > 0 ? `+${s}` : String(s)}
              </th>
            ))}
            <th className="px-3 py-2.5 text-center font-bold text-slate-700 bg-sky-50 border-l border-slate-200">Итого</th>
          </tr>
        </thead>
        <tbody>
          {types.map(t => {
            const rowTotal = sphs.reduce((s, sph) => s + (lookup.get(`${t}|${sph}`) ?? 0), 0);
            return (
              <tr key={t} className="border-t border-slate-100 hover:bg-sky-50/20 transition-colors">
                <td className="px-3 py-2 font-semibold text-[12px] text-slate-700 sticky left-0 bg-white z-10 border-r border-slate-100">{t}</td>
                {sphs.map(sph => {
                  const v = lookup.get(`${t}|${sph}`);
                  return (
                    <td key={sph} className="px-1.5 py-2 text-center font-mono">
                      {v ? <span className="inline-block min-w-[20px] px-1 py-0.5 rounded bg-sky-100 text-sky-800 font-bold text-[11px]">{v}</span> : <span className="text-slate-200">&middot;</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center font-bold text-sky-700 bg-sky-50/50 border-l border-slate-100">{rowTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
