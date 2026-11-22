'use client';

import { useEffect, useState, type FormEvent } from 'react';
import ManagerCompensation from '@/components/ManagerCompensation';
import { formatPayrollAmount } from '@/lib/payrollAmountFormat';

type RoamingStaff = {
  employee_id: number;
  full_name: string;
  role: string;
  login: string | null;
  enabled: boolean;
  allowed_branch_ids: number[];
};

type PromoterCandidate = { id: number; full_name: string; branch_id: number | null };
type RoamingRoster = { rows: RoamingStaff[]; candidates: PromoterCandidate[] };
type EmployeePay = { id: number; hours: number; shiftNet: number };

async function fetchRoster(signal?: AbortSignal): Promise<RoamingRoster> {
  const response = await fetch('/api/payroll/roaming', { signal, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить выездных сотрудников');
  return { rows: data.rows || [], candidates: data.candidates || [] };
}

export default function ManagementTab({ month, employees, branches, onPromoterSaved }: {
  month: string;
  employees: EmployeePay[];
  branches: { id: number; name: string }[];
  onPromoterSaved?: () => void;
}) {
  const [roster, setRoster] = useState<RoamingRoster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await fetchRoster(controller.signal);
        if (!controller.signal.aborted) setRoster(data);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки');
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function savePromoter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !selectedId || fullName.trim().length < 2) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/payroll/roaming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: Number(selectedId), fullName: fullName.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить доступ промоутера');
      setMessage(data.row?.enabled
        ? 'Имя сохранено. Промоутер может открывать смены в филиалах.'
        : 'Имя сохранено. Задайте личные логин и PIN в разделе «Зарплаты» → «Дополнительно: PIN и доступ».');
      setSelectedId('');
      setFullName('');
      onPromoterSaved?.();
      setRoster(await fetchRoster());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить доступ промоутера');
    } finally {
      setSaving(false);
    }
  }

  const branchName = (id: number | null) => branches.find(branch => branch.id === id)?.name;

  return <div className="space-y-7">
    <ManagerCompensation month={month} wholeSom />
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-50">Работа в филиалах за месяц</h2>
      {error && <p role="alert" className="rounded-xl bg-rose-950/50 p-4 text-sm text-rose-200">{error}</p>}
      <form onSubmit={savePromoter} className="space-y-3 rounded-2xl bg-white p-5 text-slate-900 ring-1 ring-sky-100">
        <h3 className="font-semibold">Доступ промоутера к филиалам</h3>
        <p className="text-sm text-slate-600">Выберите карточку сотрудника, чтобы сохранить историю смен и начислений за ним.</p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-1 text-sm font-medium">
            Карточка промоутера
            <select value={selectedId} required disabled={saving || !roster?.candidates.length}
              onChange={event => {
                const id = event.target.value;
                const candidate = roster?.candidates.find(person => String(person.id) === id);
                const name = candidate?.full_name || '';
                setSelectedId(id);
                setFullName(/^промоутер(?:\s|$)/iu.test(name) ? '' : name);
                setMessage(null);
              }}
              className="min-h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50">
              <option value="">Выберите сотрудника</option>
              {roster?.candidates.map(person => {
                const branch = branchName(person.branch_id);
                return <option key={person.id} value={person.id}>{person.full_name}{branch ? ` · ${branch}` : ''}</option>;
              })}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Имя сотрудника
            <input value={fullName} onChange={event => setFullName(event.target.value)} required maxLength={120}
              disabled={saving || !selectedId}
              className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3 text-sm disabled:bg-slate-50" />
          </label>
          <button type="submit" disabled={saving || !selectedId || fullName.trim().length < 2}
            className="min-h-11 rounded-xl bg-cyan-600 px-4 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Сохраняю…' : 'Сохранить доступ'}
          </button>
        </div>
        {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      </form>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {roster?.rows.map(person => {
          const pay = employees.find(employee => employee.id === Number(person.employee_id));
          return <div key={person.employee_id} className="min-w-0 rounded-2xl bg-white p-5 text-slate-900 ring-1 ring-sky-100">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{person.full_name}</div>
                <div className="mt-1 text-xs text-slate-500">{person.role === 'promoter' ? 'Промоутер' : 'Продавец-консультант'}</div>
              </div>
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-800">
                {!person.enabled ? 'Доступ ожидает настройки' : person.role === 'promoter' ? 'Доступ к филиалам' : 'Личный доступ'}
              </span>
            </div>
            <div className="mt-4 break-all text-sm text-slate-600">Логин <span className="font-semibold text-slate-900">{person.login || 'Ожидает настройки'}</span></div>
            <div className="mt-2 text-xs leading-relaxed text-slate-500">{person.allowed_branch_ids.map(id => branchName(Number(id)) || String(id)).join(' · ')}</div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
              <div><div className="text-xs text-slate-500">Часов за месяц</div><div className="mt-1 font-semibold tabular-nums">{Number(pay?.hours || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</div></div>
              <div><div className="text-xs text-slate-500">К выплате за смены</div><div className="mt-1 font-semibold tabular-nums">{formatPayrollAmount(pay?.shiftNet)} сом</div></div>
            </div>
          </div>;
        })}
      </div>
    </section>
  </div>;
}
