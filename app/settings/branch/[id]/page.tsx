'use client';

import { use } from 'react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import getSupabase from '@/lib/supabaseClient';

type WorkHours = Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', string | null>;
type Payments = { cash: boolean; qr_mbank: boolean; card: boolean };

type BranchSettingsRow = {
  branch_id: number;
  branch_name: string | null;
  address: string | null;
  work_hours: Partial<WorkHours> | null;
  whatsapp_status_phone: string | null;
  seller_phones: string[] | null;
  payments: Payments | null;
  restrict_visibility: boolean;
  updated_at: string;
};

const DAY_KEYS = ['mon','tue','wed','thu','fri','sat','sun'] as const;
const DAY_RU: Record<(typeof DAY_KEYS)[number], string> = {
  mon: 'ПН', tue: 'ВТ', wed: 'СР', thu: 'ЧТ', fri: 'ПТ', sat: 'СБ', sun: 'ВС'
};

function sb() {
  const c = getSupabase();
  if (!c) throw new Error('Supabase client missing');
  return c;
}

const phoneOk = (s: string) => /^\+?[0-9]{6,15}$/.test(s.trim());
const timeRangeOk = (s: string) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(s.trim());

export default function BranchSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const branchId = Number(id);

  const [row, setRow] = useState<BranchSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Локальные поля
  const [address, setAddress] = useState('');
  const [whatsApp, setWhatsApp] = useState('');
  const [phones, setPhones] = useState<string[]>([]);
  const [payCash, setPayCash] = useState(true);
  const [payQR, setPayQR] = useState(true);
  const [payCard, setPayCard] = useState(true);
  const [workHours, setWorkHours] = useState<Partial<WorkHours>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await sb()
          .from('branches_with_settings')
          .select('*')
          .eq('branch_id', branchId)
          .single();
        if (error) throw error;
        if (!cancelled) {
          const r = data as BranchSettingsRow;
          setRow(r);
          setAddress(r.address ?? '');
          setWhatsApp(r.whatsapp_status_phone ?? '');
          setPhones(r.seller_phones ?? []);
          setPayCash(Boolean(r.payments?.cash));
          setPayQR(Boolean(r.payments?.qr_mbank));
          setPayCard(Boolean(r.payments?.card));
          const wh: Partial<WorkHours> = { ...(r.work_hours || {}) } as any;
          DAY_KEYS.forEach(k => { if (!(k in (wh || {}))) (wh as any)[k] = null; });
          setWorkHours(wh);
        }
      } catch (e: any) {
        console.error(e);
        toast.error(e.message || 'Не удалось загрузить настройки');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [branchId]);

  const scheduleErrors = useMemo(() => {
    const errs: Record<string,string> = {};
    DAY_KEYS.forEach(k => {
      const v = (workHours as any)?.[k];
      if (v && !timeRangeOk(v)) errs[k] = 'Формат HH:MM-HH:MM';
    });
    return errs;
  }, [workHours]);

  async function onSave() {
    if (whatsApp && !phoneOk(whatsApp)) {
      toast.error('Неверный формат WhatsApp номера'); return;
    }
    const bad = phones.find(p => p && !phoneOk(p));
    if (bad) { toast.error(`Неверный номер продавца: ${bad}`); return; }
    if (Object.keys(scheduleErrors).length) {
      toast.error('Исправь формат графика (HH:MM-HH:MM) или оставь день пустым'); return;
    }

    const normalizedWH: Record<string, string | null> = {};
    DAY_KEYS.forEach(k => {
      const v = (workHours as any)?.[k];
      normalizedWH[k] = v && v.trim().length ? v.trim() : null;
    });

    const payload = {
      address: address || null,
      whatsapp_status_phone: whatsApp || null,
      seller_phones: phones.filter(Boolean),
      payments: { cash: payCash, qr_mbank: payQR, card: payCard } as Payments,
      work_hours: normalizedWH
    };

    setSaving(true);
    const t = toast.loading('Сохраняю…');
    try {
      const { data, error } = await sb().rpc('update_branch_settings', {
        p_branch_id: branchId,
        p_payload: payload as any
      });
      if (error) throw error;
      const updated = data as BranchSettingsRow;
      setRow(prev => ({ ...(prev as any), ...updated }));
      toast.success('Сохранено');
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Ошибка при сохранении');
    } finally {
      toast.dismiss(t);
      setSaving(false);
    }
  }

  function addPhone() { setPhones(p => [...p, '']); }
  function updatePhone(i: number, val: string) { const cp = phones.slice(); cp[i] = val; setPhones(cp); }
  function removePhone(i: number) { const cp = phones.slice(); cp.splice(i,1); setPhones(cp); }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-6 w-56 bg-neutral-200 rounded mb-6" />
        <div className="grid gap-4 max-w-3xl">
          <div className="h-24 bg-white rounded-2xl shadow-sm border border-neutral-200" />
          <div className="h-24 bg-white rounded-2xl shadow-sm border border-neutral-200" />
          <div className="h-40 bg-white rounded-2xl shadow-sm border border-neutral-200" />
        </div>
      </div>
    );
  }

  if (!row) return <div className="p-8">Филиал не найден или нет доступа</div>;

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          Настройки филиала: {row.branch_name} <span className="text-neutral-400 text-base">(ID {row.branch_id})</span>
        </h1>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 rounded-2xl bg-black text-white shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
      </div>

      {/* Карточки */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
        {/* Адрес */}
        <Card title="Адрес">
          <input
            value={address}
            onChange={e => setAddress(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Адрес для чеков и уведомлений"
          />
        </Card>

        {/* WhatsApp */}
        <Card title="WhatsApp (для статусов)">
          <input
            value={whatsApp}
            onChange={e => setWhatsApp(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="+9967..."
          />
          <p className="text-xs text-neutral-500 mt-1">Только цифры и +, 6–15 символов</p>
        </Card>

        {/* Телефоны продавцов */}
        <Card title="Телефоны продавцов">
          <div className="space-y-2">
            {phones.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={p}
                  onChange={e => updatePhone(i, e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="+9967..."
                />
                <button
                  onClick={() => removePhone(i)}
                  className="px-3 py-2 border border-neutral-300 rounded-xl hover:bg-neutral-50"
                >
                  −
                </button>
              </div>
            ))}
            <button
              onClick={addPhone}
              className="px-3 py-2 border border-neutral-300 rounded-xl hover:bg-neutral-50"
            >
              + Добавить номер
            </button>
          </div>
        </Card>

        {/* Способы оплаты */}
        <Card title="Способы оплаты">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={payCash} onChange={e => setPayCash(e.target.checked)} />
              Нал
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={payQR} onChange={e => setPayQR(e.target.checked)} />
              QR mBank
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={payCard} onChange={e => setPayCard(e.target.checked)} />
              Карта
            </label>
          </div>
        </Card>

        {/* График работы */}
        <Card title="График работы" className="lg:col-span-2">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {DAY_KEYS.map((d) => (
                  <tr key={d} className="border-b last:border-b-0 border-neutral-200">
                    <td className="py-2 pr-4 w-24 text-neutral-500">{DAY_RU[d]}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={(workHours as any)?.[d] ?? ''}
                          onChange={e => {
                            const val = e.target.value;
                            setWorkHours(prev => ({ ...(prev || {}), [d]: val.trim() || null }));
                          }}
                          className="w-40 px-2 py-2 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/10"
                          placeholder="10:00-17:00 или пусто"
                        />
                        {!!scheduleErrors[d] && (
                          <span className="text-xs text-red-600">{scheduleErrors[d]}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setWorkHours(prev => ({ ...(prev || {}), [d]: null }))}
                          className="text-xs px-2 py-1 border border-neutral-300 rounded-lg hover:bg-neutral-50"
                        >
                          Выходной
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-neutral-500 mt-2">Формат: HH:MM-HH:MM. Пусто → выходной.</p>
          </div>
        </Card>
      </div>

      {/* Техпанель для отладки, можно скрыть */}
      <details className="max-w-5xl">
        <summary className="cursor-pointer text-sm text-neutral-500">Тех. данные</summary>
        <pre className="text-xs bg-white p-3 rounded-2xl border border-neutral-200 mt-2 overflow-auto">
{JSON.stringify({ address, whatsApp, phones, payments:{cash:payCash,qr_mbank:payQR,card:payCard}, work_hours: workHours }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white rounded-2xl shadow-sm border border-neutral-200 p-4 md:p-5 ${className}`}>
      <div className="mb-3 font-medium">{title}</div>
      {children}
    </section>
  );
}
