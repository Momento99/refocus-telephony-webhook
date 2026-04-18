'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Building2, MapPin, Warehouse as WarehouseIcon, Globe, RefreshCw, Plus, Trash2,
  CheckCircle2, Phone, Clock, Monitor, ChevronDown, ChevronUp, Settings2, Zap,
  PowerOff, ShieldCheck, AlertTriangle, KeyRound,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';

/* ─── Types ─── */

type Country = { id: string; name: string; currency: string; currency_symbol: string };

type Organization = {
  id: string;
  name: string;
  country_id: string | null;
  created_at: string;
};

type Branch = {
  id: number;
  name: string;
  country_id: string;
  organization_id: string | null;
  warehouse_id: string | null;
  timezone: string;
  phone_code: string;
  work_hours: string;
  phone_mask: string;
  pos_pin: string | null;
};

type WarehouseRow = {
  id: string;
  name: string;
  manager_branch_id: number | null;
  country_id: string | null;
};

type LocationMap = { branch_id: number; location_id: string };

type Terminal = {
  id: number;
  terminal_code: string;
  name: string | null;
  branch_id: number;
  is_active: boolean;
  is_enabled: boolean;
};

function countryFlag(cid: string) {
  const f: Record<string, string> = { kg: '\u{1F1F0}\u{1F1EC}', ru: '\u{1F1F7}\u{1F1FA}', kz: '\u{1F1F0}\u{1F1FF}', uz: '\u{1F1FA}\u{1F1FF}' };
  return f[cid] ?? '\u{1F310}';
}

const TZ_BY_COUNTRY: Record<string, string> = { kg: 'Asia/Bishkek', uz: 'Asia/Tashkent', kz: 'Asia/Almaty', ru: 'Europe/Moscow' };
const PHONE_BY_COUNTRY: Record<string, { code: string; mask: string }> = {
  kg: { code: '996', mask: '+996 000 000 000' },
  uz: { code: '998', mask: '+998 00 000 00 00' },
  kz: { code: '7', mask: '+7 000 000 00 00' },
  ru: { code: '7', mask: '+7 000 000 00 00' },
};

/* ─── Main Page ─── */

export default function FranchiseSetupPage() {
  const supabaseRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);
  function sb() {
    if (!supabaseRef.current) supabaseRef.current = getBrowserSupabase();
    return supabaseRef.current;
  }

  const [loading, setLoading] = useState(true);
  const [countries, setCountries] = useState<Country[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [locationMaps, setLocationMaps] = useState<LocationMap[]>([]);
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [cRes, oRes, bRes, wRes, tRes, lRes] = await Promise.all([
        sb().from('franchise_countries').select('id, name, currency, currency_symbol').eq('is_active', true).order('id'),
        sb().from('organizations').select('*').order('name'),
        sb().from('branches').select('id, name, country_id, organization_id, warehouse_id, timezone, phone_code, work_hours, phone_mask, pos_pin').order('id'),
        sb().from('warehouses').select('*').order('name'),
        sb().from('terminals').select('id, terminal_code, name, branch_id, is_active, is_enabled').order('terminal_code'),
        sb().from('branch_location_map').select('branch_id, location_id'),
      ]);
      if (cRes.error) throw cRes.error;
      setCountries(cRes.data as Country[]);
      setOrgs((oRes.data as Organization[]) || []);
      setBranches((bRes.data as Branch[]) || []);
      setWarehouses((wRes.data as WarehouseRow[]) || []);
      setTerminals((tRes.data as Terminal[]) || []);
      setLocationMaps((lRes.data as LocationMap[]) || []);
    } catch (e: any) {
      toast.error(e?.message ?? 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  /* ── Actions ── */

  async function createOrg() {
    const name = prompt('Название организации (франчайзи):');
    if (!name?.trim()) return;
    const countryId = prompt('Код страны (kg, uz, kz, ru):', 'kg');
    if (!countryId) return;

    const { error } = await sb().from('organizations').insert({ name: name.trim(), country_id: countryId });
    if (error) { toast.error(error.message); return; }
    toast.success('Организация создана');
    await loadAll();
  }

  /* ── Модалки ── */
  const [branchModal, setBranchModal] = useState<{ orgId: string; countryId: string } | null>(null);
  const [warehouseModal, setWarehouseModal] = useState<{ orgId: string; countryId: string } | null>(null);

  async function doCreateBranch(form: { name: string; city: string; workHours: string; countryId: string; orgId: string }) {
    const tz = TZ_BY_COUNTRY[form.countryId] ?? 'Asia/Bishkek';
    const phone = PHONE_BY_COUNTRY[form.countryId] ?? PHONE_BY_COUNTRY.kg;
    const { error } = await sb().from('branches').insert({
      name: form.name, city: form.city || null, country_id: form.countryId, organization_id: form.orgId,
      timezone: tz, phone_code: phone.code, phone_mask: phone.mask, work_hours: form.workHours || '09:00-18:00',
    });
    if (error) { toast.error(error.message); throw error; }
    toast.success('Филиал создан');
    setBranchModal(null);
    await loadAll();
  }

  async function updateBranch(branchId: number, field: string, value: any) {
    const { error } = await sb().from('branches').update({ [field]: value }).eq('id', branchId);
    if (error) { toast.error(error.message); return; }
    toast.success('Сохранено', { id: `br-${branchId}-${field}`, duration: 1500 });
    await loadAll();
  }

  async function doCreateWarehouse(form: { name: string; managerBranchId: number | null; linkAll: boolean; countryId: string; orgId: string }) {
    const { data, error } = await sb().from('warehouses').insert({
      name: form.name, manager_branch_id: form.managerBranchId, country_id: form.countryId,
    }).select('id').single();
    if (error) { toast.error(error.message); throw error; }
    if (data?.id && form.linkAll) {
      const orgBranches = branches.filter(b => b.organization_id === form.orgId);
      if (orgBranches.length > 0) {
        await sb().from('branches').update({ warehouse_id: data.id }).in('id', orgBranches.map(b => b.id));
      }
    }
    toast.success('Склад создан');
    setWarehouseModal(null);
    await loadAll();
  }

  async function deleteOrg(orgId: string) {
    if (!confirm('Удалить организацию? Филиалы потеряют привязку.')) return;
    await sb().from('branches').update({ organization_id: null }).eq('organization_id', orgId);
    const { error } = await sb().from('organizations').delete().eq('id', orgId);
    if (error) { toast.error(error.message); return; }
    toast.success('Организация удалена');
    await loadAll();
  }

  /* ── Computed ── */
  const activeTerminals = terminals.filter(t => t.is_active && t.is_enabled).length;
  const unassigned = branches.filter(b => !b.organization_id);

  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">

      {/* ═══ HEADER ═══ */}
      <div className="px-5 pt-8 pb-6 max-w-5xl mx-auto">
        <div className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_8px_32px_rgba(15,23,42,0.08)] px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#22d3ee] via-cyan-400 to-sky-400 flex items-center justify-center shadow-[0_4px_22px_rgba(34,211,238,0.4)] shrink-0">
              <Settings2 size={24} className="text-[#0f172a]" />
            </div>
            <div>
              <h1 className="text-[24px] font-bold text-slate-900 leading-tight tracking-tight">
                Настройка франшизы
              </h1>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Организации, филиалы, склады, терминалы &middot; всё для запуска франчайзи
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={loadAll}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-all">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Обновить
            </button>
            <button onClick={createOrg}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#22d3ee] via-cyan-400 to-sky-400 text-[#0f172a] text-sm font-semibold shadow-md hover:brightness-105 transition-all">
              <Plus size={15} />
              Организация
            </button>
          </div>
        </div>
      </div>

      {/* ═══ STATS ═══ */}
      <div className="px-5 max-w-5xl mx-auto mb-6 grid grid-cols-4 gap-3">
        {[
          { label: 'Организации', value: orgs.length, bg: 'bg-cyan-50', ring: 'ring-cyan-200', dot: 'bg-cyan-500', text: 'text-cyan-700' },
          { label: 'Филиалы', value: branches.length, bg: 'bg-sky-50', ring: 'ring-sky-200', dot: 'bg-sky-500', text: 'text-sky-700' },
          { label: 'Склады', value: warehouses.length, bg: 'bg-amber-50', ring: 'ring-amber-200', dot: 'bg-amber-500', text: 'text-amber-700' },
          { label: 'Терминалы', value: `${activeTerminals}/${terminals.length}`, bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl px-4 py-3 ${s.bg} ring-1 ${s.ring} flex items-center justify-between shadow-sm`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">{s.label}</span>
            </div>
            <div className={`text-[20px] font-bold ${s.text}`}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {/* ═══ LOADING ═══ */}
      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#22d3ee] animate-spin" />
        </div>
      )}

      {/* ═══ ORG LIST ═══ */}
      <div className="px-5 max-w-5xl mx-auto pb-12 space-y-4">

        {!loading && orgs.map(org => {
          const orgBranches = branches.filter(b => b.organization_id === org.id);
          const orgWarehouses = warehouses.filter(w => w.country_id === org.country_id);
          const expanded = expandedOrg === org.id;
          const country = countries.find(c => c.id === org.country_id);

          return (
            <div key={org.id} className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_4px_24px_rgba(15,23,42,0.06)] overflow-hidden">

              {/* ── Org Header ── */}
              <div
                className="px-5 py-4 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 cursor-pointer"
                onClick={() => setExpandedOrg(expanded ? null : org.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white ring-1 ring-slate-200 flex items-center justify-center text-xl shadow-sm shrink-0">
                    {countryFlag(org.country_id ?? '')}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800 text-[15px]">{org.name}</span>
                      <span className="text-[10px] font-bold text-cyan-600 bg-cyan-50 ring-1 ring-cyan-200 rounded-full px-2 py-0.5">
                        {orgBranches.length} филиал(ов)
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                      <Globe size={10} />
                      {country?.name ?? org.country_id} &middot; {country?.currency_symbol ?? ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={(e) => { e.stopPropagation(); setBranchModal({ orgId: org.id, countryId: org.country_id ?? 'kg' }); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-semibold ring-1 ring-sky-200 transition-all">
                    <Plus size={11} /> Филиал
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setWarehouseModal({ orgId: org.id, countryId: org.country_id ?? 'kg' }); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-semibold ring-1 ring-amber-200 transition-all">
                    <Plus size={11} /> Склад
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); deleteOrg(org.id); }}
                    className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-all">
                    <Trash2 size={15} />
                  </button>
                  {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </div>
              </div>

              {/* ── Expanded Content ── */}
              {expanded && (
                <div className="px-5 py-4 space-y-4">

                  {orgBranches.length === 0 && (
                    <div className="text-sm text-slate-400 text-center py-8">
                      Нет филиалов. Нажмите <span className="font-semibold text-sky-600">+ Филиал</span> чтобы создать.
                    </div>
                  )}

                  {orgBranches.map(br => {
                    const brTerminals = terminals.filter(t => t.branch_id === br.id);
                    const brWarehouse = warehouses.find(w => w.id === br.warehouse_id);
                    const locMap = locationMaps.find(l => l.branch_id === br.id);
                    const isManager = brWarehouse && warehouses.find(w => w.manager_branch_id === br.id);

                    return (
                      <div key={br.id} className="rounded-2xl bg-slate-50/80 ring-1 ring-slate-200 overflow-hidden">

                        {/* Branch header */}
                        <div className="px-4 py-3 flex items-center justify-between bg-gradient-to-r from-slate-50/50 to-white border-b border-slate-100/60">
                          <div className="flex items-center gap-2.5">
                            <MapPin size={15} className="text-sky-500 shrink-0" />
                            <span className="font-bold text-slate-800 text-[14px]">{br.name}</span>
                            <span className="text-[10px] text-slate-400">ID {br.id}</span>
                            {isManager && (
                              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 ring-1 ring-amber-200 rounded-full px-2 py-0.5 flex items-center gap-0.5">
                                <WarehouseIcon size={9} /> Менеджер склада
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            {brWarehouse && <span className="text-amber-600">{brWarehouse.name}</span>}
                            {locMap && <span className="text-emerald-600 font-mono">{locMap.location_id.slice(0, 8)}</span>}
                          </div>
                        </div>

                        {/* Branch config grid */}
                        <div className="px-4 py-3 grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                          <FieldEdit label="Таймзона" icon={<Globe size={11} />}
                            value={br.timezone} onSave={(v) => updateBranch(br.id, 'timezone', v)} />
                          <FieldEdit label="Код телефона" icon={<Phone size={11} />}
                            value={br.phone_code} onSave={(v) => updateBranch(br.id, 'phone_code', v)} />
                          <FieldEdit label="Часы работы" icon={<Clock size={11} />}
                            value={br.work_hours} onSave={(v) => updateBranch(br.id, 'work_hours', v)} />
                          <FieldEdit label="Маска телефона"
                            value={br.phone_mask} onSave={(v) => updateBranch(br.id, 'phone_mask', v)} />
                          <FieldEdit label="PIN филиала" icon={<KeyRound size={11} />}
                            value={br.pos_pin ?? ''} onSave={(v) => updateBranch(br.id, 'pos_pin', v)} />
                          <FieldSelect label="Склад" value={br.warehouse_id ?? ''}
                            options={[{ value: '', label: '\u2014 нет \u2014' }, ...orgWarehouses.map(w => ({ value: w.id, label: w.name }))]}
                            onSave={(v) => updateBranch(br.id, 'warehouse_id', v || null)} />
                        </div>

                        {/* Terminals */}
                        {brTerminals.length > 0 && (
                          <div className="px-4 py-2.5 border-t border-slate-100/60">
                            <div className="flex flex-wrap gap-1.5">
                              {brTerminals.map(t => (
                                <div key={t.id}
                                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium ring-1 ${
                                    t.is_active && t.is_enabled
                                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                      : 'bg-rose-50 text-rose-600 ring-rose-200'
                                  }`}>
                                  <Monitor size={10} />
                                  {t.terminal_code}
                                  {t.is_active && t.is_enabled
                                    ? <CheckCircle2 size={10} />
                                    : <PowerOff size={10} />}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Warehouses summary */}
                  {orgWarehouses.length > 0 && (
                    <div className="pt-2">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <WarehouseIcon size={12} /> Склады организации
                      </div>
                      <div className="space-y-2">
                        {orgWarehouses.map(w => {
                          const manager = branches.find(b => b.id === w.manager_branch_id);
                          const linked = branches.filter(b => b.warehouse_id === w.id);
                          return (
                            <div key={w.id} className="rounded-xl bg-amber-50/60 ring-1 ring-amber-200/80 px-4 py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <WarehouseIcon size={14} className="text-amber-600" />
                                <span className="font-semibold text-slate-800 text-[13px]">{w.name}</span>
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Менеджер: <span className="font-semibold text-amber-700">{manager?.name ?? '\u2014'}</span>
                                {' \u00b7 '}{linked.length} филиал(ов)
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ═══ UNASSIGNED BRANCHES ═══ */}
        {!loading && unassigned.length > 0 && (
          <div className="rounded-3xl bg-white ring-1 ring-rose-200 shadow-[0_4px_24px_rgba(15,23,42,0.06)] overflow-hidden">
            <div className="px-5 py-4 border-b border-rose-100 bg-gradient-to-r from-rose-50/50 to-white">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-rose-500" />
                <span className="font-bold text-rose-700 text-[15px]">Филиалы без организации ({unassigned.length})</span>
              </div>
            </div>
            <div className="divide-y divide-rose-50 px-4 py-2">
              {unassigned.map(br => (
                <div key={br.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <MapPin size={13} className="text-slate-400" />
                    <span className="text-sm text-slate-800 font-medium">{br.name}</span>
                    <span className="text-[10px] text-slate-400">ID {br.id}</span>
                  </div>
                  <select
                    className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-medium ring-1 ring-slate-200 text-slate-600 outline-none focus:ring-2 focus:ring-cyan-400"
                    value=""
                    onChange={(e) => { if (e.target.value) updateBranch(br.id, 'organization_id', e.target.value); }}
                  >
                    <option value="">Привязать к...</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && orgs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Building2 size={40} className="mb-3 opacity-40" />
            <div className="text-sm font-medium">Нет организаций</div>
            <div className="text-xs mt-1">Нажмите <span className="font-semibold text-[#22d3ee]">+ Организация</span> чтобы создать первую</div>
          </div>
        )}

      {/* ── Модалки ── */}
      {branchModal && (
        <BranchModal
          orgId={branchModal.orgId}
          countryId={branchModal.countryId}
          countryName={countries.find(c => c.id === branchModal.countryId)?.name ?? branchModal.countryId}
          onClose={() => setBranchModal(null)}
          onSubmit={doCreateBranch}
        />
      )}
      {warehouseModal && (
        <WarehouseModal
          orgId={warehouseModal.orgId}
          countryId={warehouseModal.countryId}
          orgBranches={branches.filter(b => b.organization_id === warehouseModal.orgId)}
          onClose={() => setWarehouseModal(null)}
          onSubmit={doCreateWarehouse}
        />
      )}

      </div>
    </div>
  );
}

/* ─── Modal: Новый филиал ─── */

function BranchModal({ orgId, countryId, countryName, onClose, onSubmit }: {
  orgId: string; countryId: string; countryName: string;
  onClose: () => void;
  onSubmit: (f: { name: string; city: string; workHours: string; countryId: string; orgId: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [workHours, setWorkHours] = useState('09:00-18:00');
  const [saving, setSaving] = useState(false);

  const tz = TZ_BY_COUNTRY[countryId] ?? 'Asia/Bishkek';
  const ph = PHONE_BY_COUNTRY[countryId] ?? PHONE_BY_COUNTRY.kg;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try { await onSubmit({ name: name.trim(), city: city.trim(), workHours, countryId, orgId }); }
    catch {} finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[#0f172a]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 rounded-3xl bg-white shadow-[0_32px_100px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-sky-500 via-cyan-500 to-[#22d3ee]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <MapPin size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-[18px] font-bold text-white">Новый филиал</h2>
              <p className="text-[11px] text-white/70 mt-0.5">{countryFlag(countryId)} {countryName} &middot; Филиал будет привязан к организации</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Название филиала <span className="text-rose-400">*</span>
            </label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              placeholder="Ташкент-Центр"
              className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
            <p className="mt-1 text-[11px] text-slate-400">Уникальное имя точки, видимое в заказах и отчётах</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Город</label>
              <input value={city} onChange={e => setCity(e.target.value)} placeholder="Ташкент"
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Часы работы</label>
              <input value={workHours} onChange={e => setWorkHours(e.target.value)} placeholder="09:00-18:00"
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
            </div>
          </div>

          {/* Автоматические настройки */}
          <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Настроится автоматически по стране</div>
            <div className="grid grid-cols-3 gap-3 text-[12px]">
              <div><div className="text-slate-400">Таймзона</div><div className="font-medium text-slate-800">{tz}</div></div>
              <div><div className="text-slate-400">Телефон</div><div className="font-medium text-slate-800">+{ph.code}</div></div>
              <div><div className="text-slate-400">Маска</div><div className="font-medium text-slate-800">{ph.mask}</div></div>
            </div>
          </div>
        </form>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-all">Отмена</button>
          <button onClick={handleSubmit as any} disabled={!name.trim() || saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-[#22d3ee] text-white text-sm font-semibold shadow-md hover:brightness-105 disabled:opacity-50 transition-all">
            {saving ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Создаю...</>
                    : <><MapPin size={15} /> Создать филиал</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Modal: Новый склад ─── */

function WarehouseModal({ orgId, countryId, orgBranches, onClose, onSubmit }: {
  orgId: string; countryId: string; orgBranches: Branch[];
  onClose: () => void;
  onSubmit: (f: { name: string; managerBranchId: number | null; linkAll: boolean; countryId: string; orgId: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [managerBranchId, setManagerBranchId] = useState<number | null>(orgBranches[0]?.id ?? null);
  const [linkAll, setLinkAll] = useState(true);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try { await onSubmit({ name: name.trim(), managerBranchId, linkAll, countryId, orgId }); }
    catch {} finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[#0f172a]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 rounded-3xl bg-white shadow-[0_32px_100px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-400">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <WarehouseIcon size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-[18px] font-bold text-white">Новый склад линз</h2>
              <p className="text-[11px] text-white/70 mt-0.5">Склад привязывается к филиалам организации. Один филиал назначается менеджером.</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Название склада <span className="text-rose-400">*</span>
            </label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              placeholder="Склад Ташкент"
              className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-slate-400 shadow-sm" />
            <p className="mt-1 text-[11px] text-slate-400">Внутреннее имя склада для учёта остатков линз</p>
          </div>

          {orgBranches.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Менеджер склада</label>
              <p className="text-[11px] text-slate-400 mb-2">Этот филиал сможет редактировать остатки. Остальные — только просмотр.</p>
              <div className="space-y-1.5">
                {orgBranches.map(b => (
                  <button key={b.id} type="button" onClick={() => setManagerBranchId(b.id)}
                    className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm ring-1 transition-all ${
                      managerBranchId === b.id
                        ? 'bg-amber-50 ring-amber-300 text-amber-900 font-semibold shadow-sm'
                        : 'bg-white ring-slate-200 text-slate-700 hover:ring-slate-300'
                    }`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      managerBranchId === b.id ? 'bg-amber-500' : 'bg-slate-200'
                    }`}>
                      {managerBranchId === b.id && <CheckCircle2 size={12} className="text-white" />}
                    </div>
                    <span>{b.name}</span>
                    {managerBranchId === b.id && <span className="ml-auto text-[10px] text-amber-600 font-bold uppercase">Менеджер</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {orgBranches.length > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
              <button type="button" onClick={() => setLinkAll(!linkAll)}
                className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all ${
                  linkAll ? 'bg-[#22d3ee]' : 'bg-white ring-1 ring-slate-300'
                }`}>
                {linkAll && <CheckCircle2 size={12} className="text-white" />}
              </button>
              <div>
                <div className="text-sm font-medium text-slate-800">Привязать все филиалы к этому складу</div>
                <div className="text-[11px] text-slate-400">Все {orgBranches.length} филиал(ов) получат доступ к просмотру остатков</div>
              </div>
            </div>
          )}

          {orgBranches.length === 0 && (
            <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-[12px] text-amber-700">
              Сначала создайте хотя бы один филиал. Менеджер склада назначается из филиалов организации.
            </div>
          )}
        </form>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-all">Отмена</button>
          <button onClick={handleSubmit as any} disabled={!name.trim() || saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-400 text-white text-sm font-semibold shadow-md hover:brightness-105 disabled:opacity-50 transition-all">
            {saving ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Создаю...</>
                    : <><WarehouseIcon size={15} /> Создать склад</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Field Components ─── */

function FieldEdit({ label, value, onSave, icon }: {
  label: string; value: string; onSave: (v: string) => void; icon?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function save() {
    if (draft !== value) onSave(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <div>
        <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5 flex items-center gap-1">{icon} {label}</div>
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          className="w-full rounded-lg bg-white px-2.5 py-1.5 text-sm ring-2 ring-cyan-400 outline-none shadow-sm" />
      </div>
    );
  }

  return (
    <div className="cursor-pointer hover:bg-white rounded-lg px-2.5 py-1.5 -mx-1 transition-all group"
      onClick={() => { setDraft(value); setEditing(true); }}>
      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-0.5 flex items-center gap-1 group-hover:text-[#22d3ee] transition-colors">{icon} {label}</div>
      <div className="text-sm text-slate-800 font-medium">{value || '\u2014'}</div>
    </div>
  );
}

function FieldSelect({ label, value, options, onSave }: {
  label: string; value: string; options: { value: string; label: string }[]; onSave: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-0.5">{label}</div>
      <select value={value} onChange={e => onSave(e.target.value)}
        className="w-full rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-cyan-400 font-medium text-slate-800">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
