'use client';

import { useEffect, useState } from 'react';
import ManagerCompensation from '@/components/ManagerCompensation';

type RoamingStaff = {
  employee_id: number;
  full_name: string;
  role: string;
  login: string | null;
  enabled: boolean;
  allowed_branch_ids: number[];
};

type EmployeePay = { id: number; hours: number; shiftNet: number };

export default function ManagementTab({ month, employees, branches }: {
  month: string;
  employees: EmployeePay[];
  branches: { id: number; name: string }[];
}) {
  const [staff, setStaff] = useState<RoamingStaff[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/payroll/roaming', { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить выездных сотрудников');
        if (!controller.signal.aborted) setStaff(data.rows || []);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки');
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  return <div className="space-y-7">
    <ManagerCompensation month={month} />
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-50">Работа в филиалах за месяц</h2>
      {error && <p role="alert" className="rounded-xl bg-rose-950/50 p-4 text-sm text-rose-200">{error}</p>}
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {staff.map(person => {
          const pay = employees.find(employee => employee.id === Number(person.employee_id));
          return <div key={person.employee_id} className="min-w-0 rounded-2xl bg-white p-5 text-slate-900 ring-1 ring-sky-100">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{person.full_name}</div>
                <div className="mt-1 text-xs text-slate-500">{person.role === 'promoter' ? 'Выездной промоутер' : 'Продавец-консультант в филиалах'}</div>
              </div>
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-800">{person.enabled ? 'Выездной доступ включён' : 'Подготовка доступа'}</span>
            </div>
            <div className="mt-4 break-all text-sm text-slate-600">Логин <span className="font-semibold text-slate-900">{person.login || 'Ожидает настройки'}</span></div>
            <div className="mt-2 text-xs leading-relaxed text-slate-500">{person.allowed_branch_ids.map(id => branches.find(branch => branch.id === Number(id))?.name || String(id)).join(' · ')}</div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
              <div><div className="text-xs text-slate-500">Часов за месяц</div><div className="mt-1 font-semibold tabular-nums">{Number(pay?.hours || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</div></div>
              <div><div className="text-xs text-slate-500">К выплате за смены</div><div className="mt-1 font-semibold tabular-nums">{Number(pay?.shiftNet || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом</div></div>
            </div>
          </div>;
        })}
      </div>
    </section>
  </div>;
}
