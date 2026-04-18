'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  KeyRound, Plus, Trash2, ArrowLeft, Eye, EyeOff,
  Copy, ExternalLink, Users, Shield, CheckCircle2,
} from 'lucide-react';

interface FranchiseUser {
  id: number;
  login: string;
  pin: string;
  branch_id: number;
  branch_name?: string;
  permissions: string[];
  is_active: boolean;
  created_at: string;
}

interface Branch { id: number; name: string; }

export default function FranchisePortalPage() {
  const [users, setUsers] = useState<FranchiseUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPins, setShowPins] = useState<Set<number>>(new Set());

  const [showForm, setShowForm] = useState(false);
  const [newLogin, setNewLogin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newBranch, setNewBranch] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  function sb() { return getBrowserSupabase(); }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const s = getBrowserSupabase();
      const [{ data: usersData }, { data: branchData }] = await Promise.all([
        s.from('franchise_users').select('*').order('created_at', { ascending: false }),
        s.from('branches').select('id, name').order('name'),
      ]);
      const bMap = new Map((branchData || []).map((b: any) => [b.id, b.name]));
      setUsers((usersData || []).map((u: any) => ({ ...u, branch_name: bMap.get(u.branch_id) || `#${u.branch_id}` })));
      setBranches(branchData || []);
      setLoading(false);
    })();
  }, []);

  function togglePin(id: number) {
    setShowPins((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function createUser() {
    if (!newLogin.trim()) { toast.error('Введите логин'); return; }
    if (!newPin || newPin.length < 4) { toast.error('PIN минимум 4 цифры'); return; }
    if (!newBranch) { toast.error('Выберите филиал'); return; }
    setSaving(true);
    const { data, error } = await sb().from('franchise_users').insert({
      login: newLogin.trim().toLowerCase(),
      pin: newPin,
      branch_id: newBranch,
      permissions: ['orders', 'customers', 'payroll', 'attendance', 'warehouse', 'stats', 'finance', 'control'],
      is_active: true,
    }).select().single();
    if (error) {
      toast.error(error.message?.includes('unique') || error.message?.includes('duplicate') ? 'Логин уже занят' : 'Ошибка создания');
      setSaving(false); return;
    }
    const branchName = branches.find((b) => b.id === newBranch)?.name || '';
    setUsers((prev) => [{ ...data, branch_name: branchName } as FranchiseUser, ...prev]);
    setNewLogin(''); setNewPin(''); setNewBranch(0); setShowForm(false); setSaving(false);
    toast.success('Франчайзи создан');
  }

  async function deleteUser(id: number, login: string) {
    if (!confirm(`Удалить франчайзи «${login}»? Он потеряет доступ к порталу.`)) return;
    const { error } = await sb().from('franchise_users').delete().eq('id', id);
    if (error) { toast.error('Ошибка удаления'); return; }
    setUsers((prev) => prev.filter((u) => u.id !== id));
    toast.success('Удалён');
  }

  async function toggleActive(id: number, current: boolean) {
    const { error } = await sb().from('franchise_users').update({ is_active: !current }).eq('id', id);
    if (error) { toast.error('Ошибка'); return; }
    setUsers((prev) => prev.map((u) => u.id === id ? { ...u, is_active: !current } : u));
    toast.success(!current ? 'Доступ включён' : 'Доступ отключён');
  }

  function copyCredentials(u: FranchiseUser) {
    const text = `🔐 Доступ к порталу Refocus\n\n🌐 Ссылка: https://portal.refocus.asia\n👤 Логин: ${u.login}\n🔑 PIN: ${u.pin}\n🏢 Филиал: ${u.branch_name}\n\nВведите логин и PIN на странице входа.`;
    navigator.clipboard.writeText(text);
    toast.success('Данные скопированы — отправьте франчайзи');
  }

  const portalUrl = 'https://portal.refocus.asia';

  const activeCount = users.filter((u) => u.is_active).length;
  const disabledCount = users.length - activeCount;

  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">

      {/* ═══ HEADER ═══ */}
      <div className="px-5 pt-8 pb-6 max-w-5xl mx-auto">
        <div className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_8px_32px_rgba(15,23,42,0.08)] px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#22d3ee] via-cyan-400 to-sky-400 flex items-center justify-center shadow-[0_4px_22px_rgba(34,211,238,0.4)] shrink-0">
              <KeyRound size={24} className="text-[#0f172a]" />
            </div>
            <div>
              <h1 className="text-[24px] font-bold text-slate-900 leading-tight tracking-tight">
                Доступы франчайзи
              </h1>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Логины и PIN для{' '}
                <a href={portalUrl} target="_blank" rel="noopener" className="text-[#22d3ee] hover:text-cyan-600 font-medium">{portalUrl.replace('https://', '')}</a>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/admin/franchise-map"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-all">
              <ArrowLeft size={15} />
              Назад
            </Link>
            <button onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#22d3ee] via-cyan-400 to-sky-400 text-[#0f172a] text-sm font-semibold shadow-md hover:brightness-105 transition-all">
              <Plus size={15} />
              Франчайзи
            </button>
          </div>
        </div>
      </div>

      {/* ═══ STATS ═══ */}
      <div className="px-5 max-w-5xl mx-auto mb-6 grid grid-cols-3 gap-3">
        {[
          { label: 'Всего', value: users.length, bg: 'bg-cyan-50', ring: 'ring-cyan-200', dot: 'bg-cyan-500', text: 'text-cyan-700' },
          { label: 'Активных', value: activeCount, bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700' },
          { label: 'Отключены', value: disabledCount, bg: disabledCount > 0 ? 'bg-rose-50' : 'bg-slate-50', ring: disabledCount > 0 ? 'ring-rose-200' : 'ring-slate-200', dot: disabledCount > 0 ? 'bg-rose-500' : 'bg-slate-300', text: disabledCount > 0 ? 'text-rose-700' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl px-4 py-3 ${s.bg} ring-1 ${s.ring} flex items-center justify-between shadow-sm`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">{s.label}</span>
            </div>
            <div className={`text-[20px] font-bold ${s.text}`}>{loading ? '\u2014' : s.value}</div>
          </div>
        ))}
      </div>

      <div className="px-5 max-w-5xl mx-auto pb-10">

      {/* Create form */}
      {showForm && (
        <div className="mb-6 rounded-3xl ring-1 ring-slate-200 bg-white p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
          <div className="text-base font-bold text-slate-800 mb-4">Новый франчайзи</div>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 block">Логин</label>
              <input type="text" value={newLogin} onChange={(e) => setNewLogin(e.target.value)}
                placeholder="например, bishkek-01"
                className="w-full px-3.5 py-2.5 rounded-xl ring-1 ring-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none focus:ring-2 focus:ring-[#22d3ee] transition-all" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 block">PIN-код</label>
              <input type="text" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="1234" maxLength={8} inputMode="numeric"
                className="w-full px-3.5 py-2.5 rounded-xl ring-1 ring-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none focus:ring-2 focus:ring-[#22d3ee] transition-all" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 block">Филиал</label>
              <select value={newBranch} onChange={(e) => setNewBranch(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-cyan-400 transition-all">
                <option value={0}>Выберите филиал...</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button onClick={createUser} disabled={saving}
                className="flex-1 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#22d3ee] via-cyan-400 to-sky-400 text-[#0f172a] font-bold text-sm shadow-md hover:brightness-105 transition-all disabled:opacity-50">
                {saving ? 'Создание...' : 'Создать'}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-sm font-medium hover:bg-slate-200 transition-colors">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users list */}
      <div className="rounded-2xl ring-1 ring-cyan-100 bg-white shadow-[0_4px_20px_rgba(56,189,248,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-sky-100 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-800">Франчайзи</div>
          <div className="text-[12px] text-slate-400">{users.length} записей</div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-400">Загрузка...</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-slate-400">Франчайзи ещё не добавлены</div>
        ) : (
          <div>
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-6 py-4 border-b border-sky-50 hover:bg-sky-50/30 transition-colors" style={{ opacity: u.is_active ? 1 : 0.55 }}>
                <div className="flex items-center gap-4 flex-1">
                  {/* Avatar */}
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm ${u.is_active ? 'bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400' : 'bg-slate-300'}`}>
                    {u.login[0]?.toUpperCase()}
                  </div>

                  {/* Login + Branch */}
                  <div className="min-w-[140px]">
                    <div className="text-sm font-bold text-slate-800">{u.login}</div>
                    <div className="text-[12px] text-slate-400">{u.branch_name}</div>
                  </div>

                  {/* PIN */}
                  <div className="flex items-center gap-2 min-w-[100px]">
                    <span className="text-sm text-slate-600 tabular-nums font-medium">{showPins.has(u.id) ? u.pin : '••••'}</span>
                    <button onClick={() => togglePin(u.id)} className="text-slate-400 hover:text-slate-600 transition-colors">
                      {showPins.has(u.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>

                  {/* Status */}
                  <button onClick={() => toggleActive(u.id, u.is_active)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
                      u.is_active
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-400 ring-1 ring-slate-200 hover:bg-slate-200'
                    }`}>
                    <CheckCircle2 size={13} />
                    {u.is_active ? 'Активен' : 'Выключен'}
                  </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button onClick={() => copyCredentials(u)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-sky-600 hover:bg-sky-50 transition-colors"
                    title="Скопировать и отправить">
                    <Copy size={14} />
                    Копировать
                  </button>
                  <button onClick={() => deleteUser(u.id, u.login)}
                    className="px-2.5 py-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Удалить">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
