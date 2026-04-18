'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Monitor, Tablet, ShieldOff, ShieldCheck, RefreshCw,
  Globe, AlertTriangle, CheckCircle2, PowerOff, Zap,
  Plus, X, Upload, Hammer, Rocket, ChevronDown, ChevronUp,
  Package, FolderOpen,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

type Terminal = {
  id: number; name: string; terminal_code: string; branch_id: number;
  is_active: boolean; is_enabled: boolean;
  branch_name: string; country_id: string; country_name: string; currency_symbol: string;
};
type Branch = { id: number; name: string; country_id: string; country_name: string; terminals: Terminal[] };
type Channel = { id: string; country_id: string; version: string; update_url: string; is_active: boolean; force_update_at: string | null; app_type: string };
type Country = { id: string; name: string; currency_symbol: string };
type TermVer = { terminal_code: string; branch_id: number; branch_name: string; country_id: string; app_version: string | null; last_seen: string };
type BuildStatus = { state: 'idle' | 'building' | 'done' | 'error'; version: string; currentVersion: string; log: string; exeReady: boolean; exeName: string | null; exeSize: number | null };
type AllBranch = { id: number; name: string; country_id: string; terminalCount: number };
type AppType = 'pos' | 'kiosk';

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function terminalType(code: string): 'kiosk' | 'pos' { return code.toUpperCase().includes('KIOSK') ? 'kiosk' : 'pos'; }
function countryFlag(cid: string) { return ({ kg: '\u{1F1F0}\u{1F1EC}', ru: '\u{1F1F7}\u{1F1FA}', kz: '\u{1F1F0}\u{1F1FF}', uz: '\u{1F1FA}\u{1F1FF}' } as Record<string, string>)[cid] ?? '\u{1F310}'; }
const COUNTRY_BG: Record<string, string> = { kg: '#ef4444', kz: '#22d3ee', uz: '#10b981', ru: '#8b5cf6' };
const fmtMB = (b: number | null) => b ? `${(b / 1024 / 1024).toFixed(1)} MB` : '';

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export default function DeviceHubPage() {
  /* ── Device state (from old devices page) ── */
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ terminalId: number; enable: boolean } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  /* ── Build & Deploy state (from old updates page) ── */
  const [countries, setCountries] = useState<Country[]>([]);
  const [posChannels, setPosChannels] = useState<Channel[]>([]);
  const [kioskChannels, setKioskChannels] = useState<Channel[]>([]);
  const [termVers, setTermVers] = useState<TermVer[]>([]);
  const [posBuild, setPosBuild] = useState<BuildStatus | null>(null);
  const [kioskBuild, setKioskBuild] = useState<BuildStatus | null>(null);
  const [posDeploying, setPosDeploying] = useState<string | null>(null);
  const [kioskDeploying, setKioskDeploying] = useState<string | null>(null);
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());
  const [forceModal, setForceModal] = useState<{ channelId: string; countryId: string; appType: string } | null>(null);
  const [forceStatus, setForceStatus] = useState<Record<string, { sent: boolean; at: string }>>({});

  const posPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const kioskPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabaseRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);
  function sb() { if (!supabaseRef.current) supabaseRef.current = getBrowserSupabase(); return supabaseRef.current; }

  /* ── Load all data ── */
  async function loadDevices() {
    setLoading(true);
    const { data, error } = await sb()
      .from('terminals')
      .select(`id, name, terminal_code, branch_id, is_active, is_enabled, branches ( name, country_id, franchise_countries ( name, currency_symbol ) )`)
      .order('branch_id').order('id');
    if (error) { toast.error('Не удалось загрузить терминалы'); setLoading(false); return; }
    const rows = (data ?? []) as any[];
    const map: Record<number, Branch> = {};
    for (const row of rows) {
      if (!row.is_active && !row.is_enabled) continue;
      const b = row.branches; const fc = b?.franchise_countries; const bid = row.branch_id as number;
      if (!map[bid]) map[bid] = { id: bid, name: b?.name ?? `Филиал ${bid}`, country_id: b?.country_id ?? 'kg', country_name: fc?.name ?? '', terminals: [] };
      map[bid].terminals.push({ id: row.id, name: row.name, terminal_code: row.terminal_code, branch_id: bid, is_active: row.is_active, is_enabled: row.is_enabled, branch_name: b?.name ?? '', country_id: b?.country_id ?? 'kg', country_name: fc?.name ?? '', currency_symbol: fc?.currency_symbol ?? 'с' });
    }
    setBranches(Object.values(map).sort((a, b) => a.id - b.id));
    setLoading(false);
  }

  async function loadChannelsAndVersions() {
    const [pCh, kCh, co, tv] = await Promise.all([
      sb().from('update_channels').select('*').eq('app_type', 'pos').order('country_id'),
      sb().from('update_channels').select('*').eq('app_type', 'kiosk').order('country_id'),
      sb().from('franchise_countries').select('id, name, currency_symbol').eq('is_active', true).order('id'),
      sb().rpc('get_terminal_versions').then(r => r, () => ({ data: null })),
    ]);
    setPosChannels((pCh.data as Channel[]) || []);
    setKioskChannels((kCh.data as Channel[]) || []);
    setCountries((co.data as Country[]) || []);
    if (tv.data) setTermVers(tv.data as TermVer[]);
  }

  async function loadPosBuild() { try { const r = await fetch('/api/pos-build'); if (r.ok) setPosBuild(await r.json()); } catch {} }
  async function loadKioskBuild() { try { const r = await fetch('/api/kiosk-build'); if (r.ok) setKioskBuild(await r.json()); } catch {} }

  function loadAll() { loadDevices(); loadChannelsAndVersions(); loadPosBuild(); loadKioskBuild(); }
  useEffect(() => { loadAll(); }, []);

  // Build polling
  useEffect(() => {
    if (posBuild?.state === 'building') { posPollRef.current = setInterval(loadPosBuild, 3000); }
    else if (posPollRef.current) { clearInterval(posPollRef.current); posPollRef.current = null; }
    return () => { if (posPollRef.current) clearInterval(posPollRef.current); };
  }, [posBuild?.state]);
  useEffect(() => {
    if (kioskBuild?.state === 'building') { kioskPollRef.current = setInterval(loadKioskBuild, 3000); }
    else if (kioskPollRef.current) { clearInterval(kioskPollRef.current); kioskPollRef.current = null; }
    return () => { if (kioskPollRef.current) clearInterval(kioskPollRef.current); };
  }, [kioskBuild?.state]);

  /* ── Device actions ── */
  async function toggleTerminal(id: number, enable: boolean) {
    setToggling(id); setConfirm(null);
    const { error } = await sb().from('terminals').update({ is_enabled: enable }).eq('id', id);
    if (error) { toast.error('Ошибка'); } else {
      toast.success(enable ? 'Включено' : 'Отключено');
      setBranches(prev => prev.map(b => ({ ...b, terminals: b.terminals.map(t => t.id === id ? { ...t, is_enabled: enable } : t) })));
    }
    setToggling(null);
  }
  async function disableBranch(branchId: number) {
    const ids = branches.find(b => b.id === branchId)?.terminals.map(t => t.id) ?? [];
    if (!ids.length) return;
    await sb().from('terminals').update({ is_enabled: false }).in('id', ids);
    toast.success('Филиал отключён');
    setBranches(prev => prev.map(b => b.id === branchId ? { ...b, terminals: b.terminals.map(t => ({ ...t, is_enabled: false })) } : b));
  }
  async function enableBranch(branchId: number) {
    const ids = branches.find(b => b.id === branchId)?.terminals.map(t => t.id) ?? [];
    if (!ids.length) return;
    await sb().from('terminals').update({ is_enabled: true }).in('id', ids);
    toast.success('Филиал включён');
    setBranches(prev => prev.map(b => b.id === branchId ? { ...b, terminals: b.terminals.map(t => ({ ...t, is_enabled: true })) } : b));
  }

  /* ── Build & Deploy actions ── */
  async function startBuild(type: AppType, bump: 'patch' | 'minor' | 'major') {
    const api = type === 'pos' ? '/api/pos-build' : '/api/kiosk-build';
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bump }) });
    const d = await r.json();
    if (!r.ok) { toast.error(d.error); return; }
    toast.success(`Сборка v${d.version} запущена`);
    type === 'pos' ? loadPosBuild() : loadKioskBuild();
  }

  async function deployTo(type: AppType, countryId: string) {
    const build = type === 'pos' ? posBuild : kioskBuild;
    if (!build?.exeReady) return;
    const setDep = type === 'pos' ? setPosDeploying : setKioskDeploying;
    setDep(countryId);
    const tid = toast.loading(`Загрузка в ${countryId.toUpperCase()}...`);
    try {
      const api = type === 'pos' ? '/api/pos-build/upload' : '/api/kiosk-build/upload';
      const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countryId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const channels = type === 'pos' ? posChannels : kioskChannels;
      const ex = channels.find(c => c.country_id === countryId);
      if (ex) await sb().from('update_channels').update({ version: data.version, update_url: data.updateUrl, is_active: true }).eq('id', ex.id);
      else await sb().from('update_channels').insert({ country_id: countryId, version: data.version, update_url: data.updateUrl, is_active: true, app_type: type });
      toast.success(`v${data.version} загружена`, { id: tid });
      await loadChannelsAndVersions();
    } catch (e: any) { toast.error(e?.message, { id: tid }); }
    finally { setDep(null); }
  }

  async function doForceUpdate(channelId: string, countryId: string) {
    try {
      await sb().from('update_channels').update({ force_update_at: new Date().toISOString() }).eq('id', channelId);
      setForceStatus(prev => ({ ...prev, [channelId]: { sent: true, at: new Date().toISOString() } }));
      setForceModal(null);
      toast.success(`Сигнал отправлен. Устройства ${countryId.toUpperCase()} обновятся в течение 2 минут.`, { duration: 5000 });
      loadChannelsAndVersions();
    } catch (e: any) {
      toast.error(e?.message ?? 'Ошибка отправки');
    }
  }

  /* ── Computed ── */
  const allTerminals = branches.flatMap(b => b.terminals);
  const activeCount = allTerminals.filter(t => t.is_enabled).length;
  const disabledCount = allTerminals.length - activeCount;
  const posBranches = branches.map(b => ({ ...b, terminals: b.terminals.filter(t => terminalType(t.terminal_code) === 'pos') })).filter(b => b.terminals.length > 0);
  const kioskBranches = branches.map(b => ({ ...b, terminals: b.terminals.filter(t => terminalType(t.terminal_code) === 'kiosk') })).filter(b => b.terminals.length > 0);

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">

      {/* ═══ HEADER ═══ */}
      <div className="px-5 pt-8 pb-6 max-w-6xl mx-auto">
        <div className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_8px_32px_rgba(15,23,42,0.08)] px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#22d3ee] via-cyan-400 to-sky-400 flex items-center justify-center shadow-[0_4px_22px_rgba(34,211,238,0.4)] shrink-0">
              <Monitor size={24} className="text-[#0f172a]" />
            </div>
            <div>
              <h1 className="text-[24px] font-bold text-[#0f172a] leading-tight tracking-tight">Центр устройств</h1>
              <p className="text-[13px] text-slate-500 mt-0.5">Терминалы, версии и обновления</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadAll} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-all">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Обновить
            </button>
            <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#22d3ee] via-cyan-400 to-sky-400 text-[#0f172a] text-sm font-semibold shadow-md hover:brightness-105 transition-all">
              <Plus size={15} /> Терминал
            </button>
          </div>
        </div>
      </div>

      {/* ═══ STATS ═══ */}
      <div className="px-5 max-w-6xl mx-auto mb-6 grid grid-cols-3 gap-4">
        {[
          { label: 'Всего устройств', value: allTerminals.length, bg: 'bg-cyan-50', ring: 'ring-cyan-200', dot: 'bg-cyan-500', text: 'text-cyan-700' },
          { label: 'Работают', value: activeCount, bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700' },
          { label: 'Отключены', value: disabledCount, bg: disabledCount > 0 ? 'bg-rose-50' : 'bg-slate-50', ring: disabledCount > 0 ? 'ring-rose-200' : 'ring-slate-200', dot: disabledCount > 0 ? 'bg-rose-500' : 'bg-slate-300', text: disabledCount > 0 ? 'text-rose-700' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl px-5 py-4 ${s.bg} ring-1 ${s.ring} flex items-center justify-between shadow-sm`}>
            <div className="flex items-center gap-2.5"><span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} /><span className="text-[12px] text-slate-500 font-semibold uppercase tracking-wider">{s.label}</span></div>
            <div className={`text-[24px] font-bold ${s.text}`}>{loading ? '\u2014' : s.value}</div>
          </div>
        ))}
      </div>

      <div className="px-5 max-w-6xl mx-auto pb-12 space-y-6">

        {/* ═══ SECTION: BUILD ═══ */}
        <div className="flex items-center gap-3 mb-4 mt-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-md">
            <Hammer size={18} className="text-white" />
          </div>
          <div>
            <div className="text-[16px] font-bold text-white">Сборка и обновления</div>
            <div className="text-[12px] text-slate-400">Собрать инсталлятор и загрузить по странам</div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <BuildCard type="pos" build={posBuild} onBump={(b) => startBuild('pos', b)} color="#22d3ee" />
          <BuildCard type="kiosk" build={kioskBuild} onBump={(b) => startBuild('kiosk', b)} color="#8b5cf6" />
        </div>

        {/* ═══ SECTION: DEPLOY BY COUNTRY ═══ */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#22d3ee] to-cyan-400 flex items-center justify-center shadow-md">
              <Globe size={18} className="text-white" />
            </div>
            <div>
              <div className="text-[16px] font-bold text-white">Деплой по странам</div>
              <div className="text-[12px] text-slate-400">Загрузка версий и экстренные обновления</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 items-start">
            {(countries.length > 0 ? countries : [
              { id: 'kg', name: 'Кыргызстан', currency_symbol: 'с' },
              { id: 'kz', name: 'Казахстан', currency_symbol: '₸' },
              { id: 'uz', name: 'Узбекистан', currency_symbol: 'сўм' },
              { id: 'ru', name: 'Россия', currency_symbol: '₽' },
            ]).map(c => {
              const posCh = posChannels.find(ch => ch.country_id === c.id);
              const kioskCh = kioskChannels.find(ch => ch.country_id === c.id);
              const posTerms = termVers.filter(t => t.country_id === c.id && !t.terminal_code.toUpperCase().includes('KIOSK'));
              const kioskTerms = termVers.filter(t => t.country_id === c.id && t.terminal_code.toUpperCase().includes('KIOSK'));
              const isExpanded = expandedCountries.has(c.id);

              return (
                <div key={c.id} className="rounded-3xl overflow-hidden ring-1 ring-slate-200 shadow-[0_4px_24px_rgba(15,23,42,0.06)] bg-white">
                  <div className="px-6 py-5">
                    {/* Country header */}
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-[18px] shadow-lg shrink-0" style={{ background: COUNTRY_BG[c.id] ?? '#94a3b8' }}>
                        {c.id.toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-[#0f172a] text-[20px]">{c.name}</div>
                        <div className="text-[12px] text-slate-400 mt-0.5">{posTerms.length + kioskTerms.length} устройств</div>
                      </div>
                    </div>

                    {/* POS row */}
                    <DeployRow label="POS" color="#22d3ee" channel={posCh} build={posBuild} deploying={posDeploying === c.id}
                      onDeploy={() => deployTo('pos', c.id)} onForce={() => posCh && setForceModal({ channelId: posCh.id, countryId: c.id, appType: 'pos' })}
                      forceStatus={forceStatus[posCh?.id ?? '']} />

                    {/* Kiosk row */}
                    <DeployRow label="Киоск" color="#8b5cf6" channel={kioskCh} build={kioskBuild} deploying={kioskDeploying === c.id}
                      onDeploy={() => deployTo('kiosk', c.id)} onForce={() => kioskCh && setForceModal({ channelId: kioskCh.id, countryId: c.id, appType: 'kiosk' })}
                      forceStatus={forceStatus[kioskCh?.id ?? '']} />
                  </div> {/* close px-6 py-5 */}

                  {/* Expand terminals */}
                  {(posTerms.length > 0 || kioskTerms.length > 0) && (
                    <button onClick={() => setExpandedCountries(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                      className="w-full flex items-center justify-center gap-1.5 py-2 border-t border-slate-100 text-[11px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all">
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {posTerms.length + kioskTerms.length} терминал(ов)
                    </button>
                  )}

                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
                      {[...posTerms, ...kioskTerms].map(t => {
                        const ch = t.terminal_code.toUpperCase().includes('KIOSK') ? kioskCh : posCh;
                        const upToDate = ch && t.app_version === ch.version;
                        const age = t.last_seen ? Math.round((Date.now() - new Date(t.last_seen).getTime()) / 60000) : null;
                        const ageText = age === null ? 'нет данных' : age < 60 ? `${age} мин` : age < 1440 ? `${Math.round(age / 60)} ч` : `${Math.round(age / 1440)} дн`;
                        return (
                          <div key={t.terminal_code} className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 ring-1 ${!t.app_version ? 'bg-slate-50 ring-slate-100' : upToDate ? 'bg-emerald-50/50 ring-emerald-100' : 'bg-amber-50/50 ring-amber-100'}`}>
                            <div className="flex items-center gap-2.5">
                              <div className={`w-2 h-2 rounded-full ${age !== null && age < 30 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              <div>
                                <div className="text-[12px] font-semibold text-slate-800">{t.terminal_code}</div>
                                <div className="text-[10px] text-slate-400">{t.branch_name}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold font-mono rounded-full px-2 py-0.5 ring-1 ${t.app_version ? upToDate ? 'text-emerald-700 bg-emerald-50 ring-emerald-200' : 'text-amber-700 bg-amber-50 ring-amber-200' : 'text-slate-400 bg-slate-50 ring-slate-200'}`}>
                                {t.app_version ? `v${t.app_version}` : '?'}
                              </span>
                              <span className="text-[10px] text-slate-400">{ageText}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ SECTION: DEVICES (Two columns: POS | Kiosk) ═══ */}
        <div className="flex items-center gap-3 mb-4 mt-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shadow-md">
            <Monitor size={18} className="text-white" />
          </div>
          <div>
            <div className="text-[16px] font-bold text-white">Управление терминалами</div>
            <div className="text-[12px] text-slate-400">Включение и отключение устройств по филиалам</div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <DeviceColumn title="Кассовые аппараты (POS)" color="sky" icon={Monitor}
            branches={posBranches} toggling={toggling} confirm={confirm}
            setConfirm={setConfirm} toggleTerminal={toggleTerminal} loading={loading} />
          <DeviceColumn title="Тач-экраны (Киоск)" color="purple" icon={Tablet}
            branches={kioskBranches} toggling={toggling} confirm={confirm}
            setConfirm={setConfirm} toggleTerminal={toggleTerminal} loading={loading} />
        </div>
      </div>

      {/* ═══ FORCE UPDATE MODAL ═══ */}
      {forceModal && (
        <ForceUpdateModal
          countryId={forceModal.countryId}
          appType={forceModal.appType}
          onConfirm={() => doForceUpdate(forceModal.channelId, forceModal.countryId)}
          onClose={() => setForceModal(null)}
        />
      )}

      {/* ═══ ADD TERMINAL MODAL ═══ */}
      {showAddModal && (
        <AddTerminalModal branches={branches} onClose={() => setShowAddModal(false)} onCreated={() => { setShowAddModal(false); loadDevices(); }} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sub-Components
   ═══════════════════════════════════════════════════════════════ */

/* ── Device Column (POS or Kiosk) ── */
function DeviceColumn({ title, color, icon: Icon, branches, toggling, confirm, setConfirm, toggleTerminal, loading }: {
  title: string; color: 'sky' | 'purple'; icon: any;
  branches: Branch[]; toggling: number | null;
  confirm: { terminalId: number; enable: boolean } | null;
  setConfirm: (v: any) => void;
  toggleTerminal: (id: number, enable: boolean) => void;
  loading: boolean;
}) {
  const accent = color === 'sky' ? { bg: 'bg-sky-50', ring: 'ring-sky-200', text: 'text-sky-700', spin: 'border-t-sky-400' }
    : { bg: 'bg-purple-50', ring: 'ring-purple-200', text: 'text-purple-700', spin: 'border-t-purple-400' };

  return (
    <div>
      {/* Column header */}
      <div className={`rounded-2xl ${accent.bg} ring-1 ${accent.ring} px-5 py-3 mb-4 flex items-center gap-3`}>
        <Icon size={20} className={accent.text} />
        <span className={`text-[15px] font-bold ${accent.text}`}>{title}</span>
        <span className={`text-[13px] font-bold ${accent.text} ml-auto bg-white/60 px-2.5 py-0.5 rounded-full`}>
          {branches.reduce((s, b) => s + b.terminals.length, 0)}
        </span>
      </div>

      {loading && <div className="flex justify-center py-12"><div className={`w-7 h-7 rounded-full border-4 border-slate-200 ${accent.spin} animate-spin`} /></div>}

      <div className="space-y-3">
        {!loading && branches.map(branch => (
          <div key={branch.id} className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
            {/* Branch header */}
            <div className="px-5 py-3.5 flex items-center gap-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
              <span className="text-xl">{countryFlag(branch.country_id)}</span>
              <span className="font-bold text-slate-800 text-[15px]">{branch.name}</span>
              <span className="text-[11px] text-slate-400 ml-auto">{branch.terminals.length} устр.</span>
            </div>

            {/* Terminals */}
            <div className="divide-y divide-slate-50 px-4 py-1">
              {branch.terminals.map(t => {
                const isLoading = toggling === t.id;
                const pending = confirm?.terminalId === t.id;
                return (
                  <div key={t.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-3 h-3 rounded-full shrink-0 ${t.is_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <div className="min-w-0">
                        <div className={`text-[14px] font-semibold truncate ${t.is_enabled ? 'text-slate-800' : 'text-slate-400'}`}>
                          {t.name || t.terminal_code}
                        </div>
                        <div className={`text-[11px] font-mono ${t.is_enabled ? 'text-slate-400' : 'text-slate-300'}`}>
                          {t.terminal_code}
                        </div>
                      </div>
                    </div>
                    {pending ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-rose-600 font-medium">Отключить?</span>
                        <button onClick={() => toggleTerminal(t.id, false)} className="px-3 py-1.5 rounded-lg bg-rose-500 text-white text-[12px] font-bold hover:bg-rose-600 transition-all">Да</button>
                        <button onClick={() => setConfirm(null)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[12px] font-semibold hover:bg-slate-200 transition-all">Нет</button>
                      </div>
                    ) : (
                      <button disabled={isLoading} onClick={() => t.is_enabled ? setConfirm({ terminalId: t.id, enable: false }) : toggleTerminal(t.id, true)}
                        className={`px-4 py-2 rounded-xl text-[12px] font-semibold ring-1 transition-all ${
                          t.is_enabled
                            ? 'text-rose-600 ring-rose-200 hover:bg-rose-50'
                            : 'text-emerald-700 ring-emerald-200 hover:bg-emerald-50'
                        }`}>
                        {isLoading ? <RefreshCw size={12} className="animate-spin" /> : t.is_enabled ? 'Отключить' : 'Включить'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!loading && branches.length === 0 && (
          <div className="text-center py-12 text-[13px] text-slate-400 bg-white/50 rounded-2xl ring-1 ring-slate-200">Нет устройств</div>
        )}
      </div>
    </div>
  );
}

/* ── Build Card ── */
function BuildCard({ type, build, onBump, color }: {
  type: AppType; build: BuildStatus | null;
  onBump: (bump: 'patch' | 'minor' | 'major') => void;
  color: string;
}) {
  const label = type === 'pos' ? 'Кассовый аппарат' : 'Тач-экран (Киоск)';
  const v = build?.currentVersion?.split('.').map(Number) ?? [0, 0, 0];
  const bumps = [
    { type: 'patch' as const, label: 'Патч-фикс', preview: `${v[0]}.${v[1]}.${v[2] + 1}`, desc: 'Исправление багов' },
    { type: 'minor' as const, label: 'Новая фича', preview: `${v[0]}.${v[1] + 1}.0`, desc: 'Новый функционал' },
    { type: 'major' as const, label: 'Мажор', preview: `${v[0] + 1}.0.0`, desc: 'Большое обновление' },
  ];

  return (
    <div className="rounded-3xl overflow-hidden ring-1 ring-slate-200 shadow-[0_4px_24px_rgba(15,23,42,0.06)] bg-white">
      {/* Header */}
      <div className="px-6 py-5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg shrink-0" style={{ background: color }}>
              <Hammer size={20} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-[#0f172a] text-[16px]">{label}</div>
              <div className="text-slate-400 text-[13px] mt-0.5">
                Версия: <span className="font-mono font-bold text-[#0f172a] text-[15px]">{build?.currentVersion ?? '...'}</span>
              </div>
            </div>
          </div>
          {build?.state === 'building' && (
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-amber-50 ring-1 ring-amber-200">
              <div className="w-5 h-5 rounded-full border-2 border-amber-200 border-t-amber-500 animate-spin" />
              <span className="text-amber-700 text-[13px] font-semibold">Сборка v{build.version}</span>
            </div>
          )}
        </div>

        {/* Bump buttons */}
        {build?.state !== 'building' && (
          <div className="grid grid-cols-3 gap-3">
            {bumps.map(b => (
              <button key={b.type} onClick={() => onBump(b.type)}
                className={`rounded-2xl px-4 py-3.5 text-left transition-all ring-1 ${
                  b.type === 'patch'
                    ? 'ring-[#22d3ee]/40 hover:ring-[#22d3ee] hover:-translate-y-0.5 shadow-sm'
                    : 'bg-white ring-slate-200 hover:ring-slate-300 hover:bg-slate-50'
                }`}
                style={b.type === 'patch' ? { background: `${color}15` } : undefined}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-slate-800">{b.label}</span>
                  <span className="text-[12px] font-mono font-bold text-slate-400">{b.preview}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{b.desc}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Build result */}
      {build?.state === 'done' && build.exeReady && (
        <div className="mx-5 my-4 rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-md shrink-0">
            <Package size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-emerald-900">Инсталлятор готов</div>
            <div className="text-[12px] text-emerald-600 mt-0.5 truncate">{build.exeName} ({fmtMB(build.exeSize)})</div>
          </div>
          <button onClick={() => {
              const dir = type === 'pos' ? 'C:\\refocusTerminal\\refocus-pos\\dist_installer' : 'C:\\TouchScreenRefocus\\refocus-lens-kiosk\\release';
              fetch('/api/pos-build/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dir }) });
            }}
            className="w-10 h-10 rounded-xl bg-emerald-100 hover:bg-emerald-200 flex items-center justify-center transition-all shrink-0" title="Открыть папку">
            <FolderOpen size={16} className="text-emerald-700" />
          </button>
        </div>
      )}

      {build?.state === 'error' && (
        <div className="mx-5 my-4 rounded-2xl bg-rose-50 ring-1 ring-rose-200 px-5 py-3.5 text-rose-700 text-[13px] font-medium">
          Сборка завершилась с ошибкой
        </div>
      )}

      {build?.log && <BuildLog log={build.log} />}
    </div>
  );
}

/* ── Deploy Row (POS or Kiosk inside a country card) ── */
function DeployRow({ label, color, channel, build, deploying, onDeploy, onForce, forceStatus }: {
  label: string; color: string; channel: Channel | undefined;
  build: BuildStatus | null; deploying: boolean;
  onDeploy: () => void; onForce: () => void;
  forceStatus?: { sent: boolean; at: string };
}) {
  const isCurrent = channel?.version === build?.currentVersion && build?.exeReady;
  const canDeploy = build?.exeReady && !isCurrent && !deploying;

  // Время с момента отправки экстренного обновления
  const forceMins = forceStatus?.sent ? Math.round((Date.now() - new Date(forceStatus.at).getTime()) / 60000) : null;

  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[14px] font-semibold text-slate-700">{label}</span>
        {channel ? (
          <span className="text-[11px] font-bold font-mono rounded-full px-2.5 py-1 ring-1 ring-slate-200 bg-slate-50 text-slate-600">v{channel.version}</span>
        ) : (
          <span className="text-[12px] text-slate-400">не настроен</span>
        )}
        {forceMins !== null && forceMins < 30 && (
          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ring-1 ${
            forceMins < 3
              ? 'text-red-600 bg-red-50 ring-red-200 animate-pulse'
              : forceMins < 10
              ? 'text-amber-600 bg-amber-50 ring-amber-200'
              : 'text-slate-500 bg-slate-50 ring-slate-200'
          }`}>
            {forceMins < 3 ? 'Обновление в пути...' : `Экстренно ${forceMins} мин назад`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isCurrent && (
          <div className="flex items-center gap-1.5 text-emerald-600">
            <CheckCircle2 size={16} />
            <span className="text-[12px] font-semibold">Актуально</span>
          </div>
        )}
        {deploying && (
          <div className="flex items-center gap-2 text-amber-700">
            <div className="w-5 h-5 rounded-full border-2 border-amber-200 border-t-amber-500 animate-spin" />
            <span className="text-[12px] font-semibold">Загрузка...</span>
          </div>
        )}
        {canDeploy && (
          <button onClick={onDeploy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold ring-1 ring-[#22d3ee]/40 hover:ring-[#22d3ee] hover:bg-cyan-50 transition-all text-slate-700">
            <Upload size={13} /> Загрузить v{build?.currentVersion}
          </button>
        )}
        {channel && (
          <button onClick={onForce} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-red-500 hover:text-red-600 hover:bg-red-50 ring-1 ring-transparent hover:ring-red-200 transition-all" title="Экстренное обновление">
            <Rocket size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Build Log ── */
function BuildLog({ log }: { log: string }) {
  const [open, setOpen] = useState(false);
  const last = log.split('\n').filter(Boolean).pop() ?? '';
  return (
    <div className="border-t border-slate-100 bg-white">
      <button onClick={() => setOpen(!open)} className="w-full px-5 py-2 flex items-center justify-between text-[10px] text-slate-400 hover:bg-slate-50 transition-all bg-white">
        <span className="font-mono truncate max-w-[85%] text-left">{last}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && <pre className="px-5 py-3 text-[10px] font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-slate-100" style={{ color: '#475569', background: '#f8fafc' }}>{log}</pre>}
    </div>
  );
}

/* ── Add Terminal Modal ── */
function AddTerminalModal({ branches, onClose, onCreated }: {
  branches: Branch[]; onClose: () => void; onCreated: () => void;
}) {
  type TType = 'pos' | 'kiosk';
  const [tType, setTType] = useState<TType>('pos');
  const [branchId, setBranchId] = useState<number | ''>('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [allBranches, setAllBranches] = useState<AllBranch[]>([]);
  const [loadingBr, setLoadingBr] = useState(true);

  useEffect(() => {
    const s = getBrowserSupabase();
    s.from('branches').select('id, name, country_id').order('id').then(({ data }) => {
      if (!data) { setLoadingBr(false); return; }
      const tc = new Map<number, number>();
      for (const b of branches) tc.set(b.id, b.terminals.length);
      setAllBranches((data as any[]).map(b => ({ id: b.id, name: b.name ?? `#${b.id}`, country_id: b.country_id ?? 'kg', terminalCount: tc.get(b.id) ?? 0 })));
      setLoadingBr(false);
    });
  }, [branches]);

  function autoCode(bId: number | '', type: TType) {
    const b = allBranches.find(br => br.id === bId);
    if (!b) return;
    const p = b.name.slice(0, 2).toUpperCase();
    setCode(type === 'kiosk' ? `${p}-KIOSK` : `${p}-01`);
    setDisplayName(`${b.name} \u2022 ${type === 'kiosk' ? 'Киоск' : 'Касса 01'}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !branchId || saving) return;
    setSaving(true);
    const { error } = await getBrowserSupabase().from('terminals').insert({ terminal_code: code.trim(), name: displayName.trim() || code.trim(), branch_id: branchId, code: code.trim(), is_active: true, is_enabled: true });
    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success(`${code} создан`);
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[#0f172a]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 rounded-3xl bg-white shadow-[0_32px_100px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 overflow-hidden">
        <div className="px-6 py-5 bg-gradient-to-r from-[#0f172a] via-slate-800 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#22d3ee] to-cyan-400 flex items-center justify-center shadow-lg"><Monitor size={20} className="text-[#0f172a]" /></div>
            <div><div className="text-[18px] font-bold text-white">Новый терминал</div><div className="text-[11px] text-slate-400 mt-0.5">Касса или тач-экран</div></div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {([{ t: 'pos' as TType, l: 'Кассовый аппарат' }, { t: 'kiosk' as TType, l: 'Киоск (тач-экран)' }]).map(o => (
              <button key={o.t} type="button" onClick={() => { setTType(o.t); autoCode(branchId, o.t); }}
                className={`rounded-xl px-4 py-3 text-[13px] font-medium ring-1 transition-all text-left ${tType === o.t ? 'bg-[#22d3ee]/10 ring-[#22d3ee] shadow-sm' : 'bg-white ring-slate-200 hover:ring-slate-300'}`}>
                {o.l}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Филиал</label>
            <select value={branchId} onChange={e => { const v = Number(e.target.value); setBranchId(v); autoCode(v, tType); }} disabled={loadingBr}
              className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] shadow-sm font-medium disabled:opacity-50">
              <option value="">{loadingBr ? 'Загрузка...' : 'Выбери филиал...'}</option>
              {allBranches.map(b => <option key={b.id} value={b.id}>{countryFlag(b.country_id)} {b.name} ({b.terminalCount})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Код</label>
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="TASH-01"
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm font-mono ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] shadow-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Имя</label>
              <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Касса 01"
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] shadow-sm" />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-all">Отмена</button>
          <button onClick={handleSubmit as any} disabled={!code.trim() || !branchId || saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#22d3ee] via-cyan-400 to-sky-400 text-[#0f172a] text-sm font-semibold shadow-md hover:brightness-105 disabled:opacity-50 transition-all">
            {saving ? 'Создаю...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Force Update Modal ── */
function ForceUpdateModal({ countryId, appType, onConfirm, onClose }: {
  countryId: string; appType: string; onConfirm: () => void; onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const isValid = code.trim().toLowerCase() === countryId;
  const label = appType === 'kiosk' ? 'Тач-экраны (Киоск)' : 'Кассовые аппараты (POS)';

  async function handleConfirm() {
    if (!isValid) return;
    setSending(true);
    await onConfirm();
    setSending(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-[#0f172a]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 rounded-3xl bg-white shadow-[0_32px_100px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 overflow-hidden">

        {/* Header — красный */}
        <div className="px-6 py-5 bg-gradient-to-r from-red-500 to-rose-500">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center">
              <Rocket size={22} className="text-white" />
            </div>
            <div>
              <div className="text-[18px] font-bold text-white">Экстренное обновление</div>
              <div className="text-[12px] text-white/70 mt-0.5">{label} &middot; {countryId.toUpperCase()}</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <div className="rounded-2xl bg-red-50 ring-1 ring-red-200 px-4 py-3 mb-4">
            <div className="text-[13px] text-red-800 font-medium">
              Все устройства <strong>{countryId.toUpperCase()}</strong> получат обновление в течение <strong>5 минут</strong>.
              Приложение автоматически перезапустится.
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-bold text-slate-700 mb-2">
              Введите <span className="font-mono text-red-500">{countryId.toUpperCase()}</span> для подтверждения
            </label>
            <input value={code} onChange={e => setCode(e.target.value.toLowerCase())} autoFocus
              placeholder={countryId}
              className="w-full rounded-xl bg-white px-4 py-3 text-[16px] font-mono tracking-wider text-center text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-red-400 shadow-sm uppercase" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-all">
            Отмена
          </button>
          <button onClick={handleConfirm} disabled={!isValid || sending}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-white text-sm font-semibold shadow-md hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            {sending ? (
              <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Отправляю...</>
            ) : (
              <><Rocket size={15} /> Отправить</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
