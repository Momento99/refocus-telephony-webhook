'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, DollarSign, CheckCircle2, Clock, AlertTriangle,
  FileText, Plus, ChevronDown, ChevronUp, Building2, CalendarDays,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';

type Contract = {
  id: string; organization_id: string; branch_id: number;
  contract_start: string; paushalniy_amount: number; paushalniy_currency: string;
  paushalniy_paid: boolean; paushalniy_paid_at: string | null;
  royalty_year1_pct: number; royalty_year2_pct: number; royalty_year3_pct: number;
  payment_requisites: string | null; status: string;
  branch_name?: string; org_name?: string; country_id?: string; currency_symbol?: string;
};

type Invoice = {
  id: string; branch_id: number; period_start: string; period_end: string;
  type: string; revenue: number; royalty_pct: number; amount: number;
  currency: string; currency_symbol: string; status: string;
  due_date: string | null; paid_at: string | null; paid_comment: string | null;
  branch_name?: string;
};

const COUNTRY_BG: Record<string, string> = { kg: '#ef4444', kz: '#22d3ee', uz: '#10b981', ru: '#8b5cf6' };
const fmtNum = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU') : '—';
const monthName = (s: string) => new Date(s).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

export default function FranchiseFinancePage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showContractModal, setShowContractModal] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);
  const sbRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);
  function sb() { if (!sbRef.current) sbRef.current = getBrowserSupabase(); return sbRef.current; }

  async function loadAll() {
    setLoading(true);
    const [cRes, iRes] = await Promise.all([
      sb().from('franchise_contracts').select('*, branches(name, country_id, franchise_countries(currency_symbol)), organizations(name)').order('contract_start', { ascending: false }),
      sb().from('franchise_invoices').select('*, branches(name)').order('period_start', { ascending: false }),
    ]);
    setContracts((cRes.data ?? []).map((c: any) => ({
      ...c,
      branch_name: c.branches?.name, org_name: c.organizations?.name,
      country_id: c.branches?.country_id, currency_symbol: c.branches?.franchise_countries?.currency_symbol ?? 'с',
    })));
    setInvoices((iRes.data ?? []).map((i: any) => ({ ...i, branch_name: i.branches?.name })));
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  // Сгенерировать роялти за прошлый месяц
  async function generateRoyalties() {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const tid = toast.loading('Генерация начислений...');
    try {
      const { data, error } = await sb().rpc('generate_monthly_royalties', { p_year: prev.getFullYear(), p_month: prev.getMonth() + 1 });
      if (error) throw error;
      const count = (data as any[])?.length ?? 0;
      toast.success(`Создано ${count} начислений`, { id: tid });
      await loadAll();
    } catch (e: any) { toast.error(e?.message ?? 'Ошибка', { id: tid }); }
  }

  // Отметить оплаченным
  async function markPaid(invoiceId: string) {
    setMarkingPaid(invoiceId);
    try {
      await sb().from('franchise_invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', invoiceId);
      toast.success('Отмечено как оплачено');
      await loadAll();
    } catch (e: any) { toast.error(e?.message); }
    finally { setMarkingPaid(null); }
  }

  // Отметить паушальный оплаченным
  async function markPaushalniyPaid(contractId: string) {
    await sb().from('franchise_contracts').update({ paushalniy_paid: true, paushalniy_paid_at: new Date().toISOString() }).eq('id', contractId);
    toast.success('Паушальный взнос отмечен как оплачен');
    await loadAll();
  }

  // Stats
  const totalPending = invoices.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);

  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">

      {/* Header */}
      <div className="px-5 pt-8 pb-6 max-w-5xl mx-auto">
        <div className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_8px_32px_rgba(15,23,42,0.08)] px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-[0_4px_22px_rgba(16,185,129,0.4)] shrink-0" style={{ background: '#10b981' }}>
              <DollarSign size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-[24px] font-bold text-[#0f172a] leading-tight tracking-tight">Финансы франшизы</h1>
              <p className="text-[13px] text-slate-500 mt-0.5">Роялти, паушальный взнос, начисления</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={generateRoyalties} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-semibold shadow-md hover:brightness-105 transition-all">
              <CalendarDays size={15} /> Начислить роялти
            </button>
            <button onClick={() => setShowContractModal(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#22d3ee] to-cyan-500 text-[#0f172a] text-sm font-semibold shadow-md hover:brightness-105 transition-all">
              <Plus size={15} /> Договор
            </button>
            <Link href="/admin/franchise-map" className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-all">
              <ArrowLeft size={15} /> Назад
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-5 max-w-5xl mx-auto mb-6 grid grid-cols-3 gap-4">
        {[
          { label: 'Ожидает оплаты', value: fmtNum(totalPending), bg: 'bg-amber-50', ring: 'ring-amber-200', dot: 'bg-amber-500', text: 'text-amber-700' },
          { label: 'Оплачено', value: fmtNum(totalPaid), bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700' },
          { label: 'Просрочено', value: fmtNum(totalOverdue), bg: totalOverdue > 0 ? 'bg-rose-50' : 'bg-slate-50', ring: totalOverdue > 0 ? 'ring-rose-200' : 'ring-slate-200', dot: totalOverdue > 0 ? 'bg-rose-500' : 'bg-slate-300', text: totalOverdue > 0 ? 'text-rose-700' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl px-5 py-4 ${s.bg} ring-1 ${s.ring} flex items-center justify-between shadow-sm`}>
            <div className="flex items-center gap-2.5"><span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} /><span className="text-[12px] text-slate-500 font-semibold uppercase tracking-wider">{s.label}</span></div>
            <div className={`text-[22px] font-bold ${s.text}`}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {/* Contracts */}
      <div className="px-5 max-w-5xl mx-auto pb-12 space-y-4">
        {loading && <div className="flex justify-center py-20"><div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-emerald-400 animate-spin" /></div>}

        {!loading && contracts.map(c => {
          const isExpanded = expanded.has(c.id);
          const cInvoices = invoices.filter(i => i.branch_id === c.branch_id).slice(0, 12);
          const pendingCount = cInvoices.filter(i => i.status === 'pending').length;
          const yearsSinceStart = Math.floor((Date.now() - new Date(c.contract_start).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
          const currentPct = yearsSinceStart < 1 ? c.royalty_year1_pct : yearsSinceStart < 2 ? c.royalty_year2_pct : c.royalty_year3_pct;

          return (
            <div key={c.id} className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_4px_24px_rgba(15,23,42,0.06)] overflow-hidden">
              {/* Contract header */}
              <div className="px-6 py-5 cursor-pointer hover:bg-slate-50/50 transition-all" onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-[14px] shadow-md" style={{ background: COUNTRY_BG[c.country_id ?? 'kg'] ?? '#94a3b8' }}>
                      {(c.country_id ?? 'kg').toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-[16px] text-[#0f172a]">{c.org_name ?? c.branch_name}</div>
                      <div className="text-[12px] text-slate-400 mt-0.5">
                        Договор с {fmtDate(c.contract_start)} &middot; {yearsSinceStart + 1}-й год &middot; Роялти: {currentPct}%
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {pendingCount > 0 && (
                      <span className="text-[11px] font-bold text-amber-600 bg-amber-50 ring-1 ring-amber-200 rounded-full px-2.5 py-1">{pendingCount} к оплате</span>
                    )}
                    <div className={`text-[11px] font-bold rounded-full px-2.5 py-1 ring-1 ${
                      c.paushalniy_paid ? 'text-emerald-700 bg-emerald-50 ring-emerald-200' : 'text-amber-700 bg-amber-50 ring-amber-200'
                    }`}>
                      Паушальный: {c.paushalniy_paid ? 'Оплачен' : `${fmtNum(c.paushalniy_amount)} ${c.currency_symbol}`}
                    </div>
                    {!c.paushalniy_paid && (
                      <button onClick={(e) => { e.stopPropagation(); markPaushalniyPaid(c.id); }}
                        className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 hover:underline">Отметить</button>
                    )}
                    {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                  </div>
                </div>
              </div>

              {/* Invoices */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-6 py-4 space-y-2">
                  {cInvoices.length === 0 && <div className="text-center py-6 text-[13px] text-slate-400">Нет начислений. Нажмите «Начислить роялти».</div>}

                  {cInvoices.map(inv => (
                    <div key={inv.id} className={`rounded-2xl px-5 py-4 ring-1 flex items-center justify-between ${
                      inv.status === 'paid' ? 'bg-emerald-50/50 ring-emerald-100'
                      : inv.status === 'overdue' ? 'bg-rose-50/50 ring-rose-100'
                      : 'bg-amber-50/30 ring-amber-100'
                    }`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          inv.status === 'paid' ? 'bg-emerald-500' : inv.status === 'overdue' ? 'bg-rose-500' : 'bg-amber-500'
                        }`}>
                          {inv.status === 'paid' ? <CheckCircle2 size={18} className="text-white" /> :
                           inv.status === 'overdue' ? <AlertTriangle size={18} className="text-white" /> :
                           <Clock size={18} className="text-white" />}
                        </div>
                        <div>
                          <div className="font-bold text-[14px] text-slate-800 capitalize">{monthName(inv.period_start)}</div>
                          <div className="text-[12px] text-slate-400 mt-0.5">
                            Выручка: {fmtNum(inv.revenue)} {inv.currency_symbol} &middot; Роялти {inv.royalty_pct}%
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-bold text-[18px] text-slate-800">{fmtNum(inv.amount)} {inv.currency_symbol}</div>
                          <div className="text-[11px] text-slate-400">
                            {inv.status === 'paid' ? `Оплачен ${fmtDate(inv.paid_at)}` :
                             inv.due_date ? `Срок: ${fmtDate(inv.due_date)}` : ''}
                          </div>
                        </div>
                        {inv.status === 'pending' && (
                          <button onClick={() => markPaid(inv.id)} disabled={markingPaid === inv.id}
                            className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 disabled:opacity-50 transition-all">
                            {markingPaid === inv.id ? '...' : 'Оплачено'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {!loading && contracts.length === 0 && (
          <div className="rounded-3xl bg-white ring-1 ring-slate-200 px-6 py-16 text-center">
            <FileText size={40} className="mx-auto mb-3 text-slate-300" />
            <div className="text-sm font-medium text-slate-500">Нет договоров</div>
            <div className="text-xs text-slate-400 mt-1">Нажмите «+ Договор» чтобы создать</div>
          </div>
        )}
      </div>

      {/* Contract Modal */}
      {showContractModal && <ContractModal sb={sb} onClose={() => setShowContractModal(false)} onCreated={() => { setShowContractModal(false); loadAll(); }} />}
    </div>
  );
}

/* ── Contract Modal ── */
function ContractModal({ sb, onClose, onCreated }: { sb: () => any; onClose: () => void; onCreated: () => void }) {
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [paushAmount, setPaushAmount] = useState('300000');
  const [y1, setY1] = useState('3'); const [y2, setY2] = useState('4'); const [y3, setY3] = useState('5');
  const [requisites, setRequisites] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    sb().from('branches').select('id, name, country_id, organization_id').order('id').then(({ data }: any) => setBranches(data ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId || saving) return;
    setSaving(true);
    const branch = branches.find((b: any) => b.id === branchId);
    const { error } = await sb().from('franchise_contracts').insert({
      branch_id: branchId, organization_id: branch?.organization_id ?? null,
      contract_start: startDate, paushalniy_amount: Number(paushAmount) || 0,
      royalty_year1_pct: Number(y1), royalty_year2_pct: Number(y2), royalty_year3_pct: Number(y3),
      payment_requisites: requisites || null,
    });
    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success('Договор создан');
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[#0f172a]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 rounded-3xl bg-white shadow-[0_32px_100px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 overflow-hidden">
        <div className="px-6 py-5" style={{ background: '#10b981' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><FileText size={20} className="text-white" /></div>
            <div><div className="text-[18px] font-bold text-white">Новый договор</div><div className="text-[12px] text-white/70 mt-0.5">Условия франшизы</div></div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Филиал</label>
            <select value={branchId} onChange={e => setBranchId(Number(e.target.value))}
              className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-emerald-400 shadow-sm">
              <option value="">Выбрать...</option>
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Дата начала</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-emerald-400 shadow-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Паушальный взнос</label>
              <input value={paushAmount} onChange={e => setPaushAmount(e.target.value)} inputMode="numeric"
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-emerald-400 shadow-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Роялти по годам (%)</label>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-[10px] text-slate-400 mb-1">1-й год</div><input value={y1} onChange={e => setY1(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2 text-sm text-center ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-emerald-400" /></div>
              <div><div className="text-[10px] text-slate-400 mb-1">2-й год</div><input value={y2} onChange={e => setY2(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2 text-sm text-center ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-emerald-400" /></div>
              <div><div className="text-[10px] text-slate-400 mb-1">3-й год+</div><input value={y3} onChange={e => setY3(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2 text-sm text-center ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-emerald-400" /></div>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Реквизиты для оплаты</label>
            <textarea value={requisites} onChange={e => setRequisites(e.target.value)} rows={2} placeholder="IBAN, БИК, название банка..."
              className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-emerald-400 shadow-sm resize-none" />
          </div>
        </form>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-all">Отмена</button>
          <button onClick={handleSubmit as any} disabled={!branchId || saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold shadow-md hover:bg-emerald-600 disabled:opacity-50 transition-all">
            {saving ? 'Создаю...' : 'Создать договор'}
          </button>
        </div>
      </div>
    </div>
  );
}
