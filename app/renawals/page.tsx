'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import toast, { Toaster } from 'react-hot-toast';

type Row = {
  customer_id: number;
  full_name: string | null;
  phone: string | null;
  next_check_at: string | null;
  next_check_fmt: string | null;
  bucket: 'due'|'soon'|'later';
  last_contact_at: string | null;
};

const fmtDT = (s?: string|null) => s ? new Date(s).toLocaleString('ru-RU', { hour12:false }) : '—';

function Glass({ children, className='' }: any) {
  return <div className={`rounded-2xl border border-white/40 bg-white/70 backdrop-blur-md shadow-[0_12px_40px_rgba(31,38,135,0.14)] ${className}`}>{children}</div>;
}
function Btn({ children, onClick, variant='solid', disabled=false }:{
  children:any; onClick?:()=>void; variant?:'solid'|'outline'; disabled?:boolean;
}) {
  const base = 'px-3 py-2 rounded-xl text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50';
  const solid='bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-500 text-white hover:from-indigo-500 hover:via-violet-400 hover:to-cyan-400';
  const outline='border border-slate-300 bg-white/80 hover:bg-white';
  return <button disabled={disabled} onClick={onClick} className={`${base} ${variant==='solid'?solid:outline}`}>{children}</button>;
}

export default function RenewalsPage() {
  const [rows, setRows]   = useState<Row[]>([]);
  const [loading, setL]   = useState(false);
  const [q, setQ]         = useState('');
  const [bucket, setB]    = useState<'all'|'due'|'soon'|'later'>('all');

  useEffect(()=>{ load(); },[]);
  async function load() {
    setL(true);
    const { data, error } = await supabase.from('renewal_queue').select('*');
    setL(false);
    if (error) return toast.error(error.message);
    setRows((data as any) || []);
  }

  const filtered = useMemo(()=>{
    let a = rows.slice();
    if (bucket !== 'all') a = a.filter(r => r.bucket === bucket);
    const s = q.trim().toLowerCase();
    if (s) a = a.filter(r =>
      (r.full_name||'').toLowerCase().includes(s) ||
      (r.phone||'').toLowerCase().includes(s)
    );
    return a;
  }, [rows, q, bucket]);

  async function markContact(r: Row, outcome: 'attempt'|'reached'|'scheduled'|'declined'|'sold', channel: 'call'|'whatsapp'|'sms'|'email'|'telegram'|'other') {
    const { error } = await supabase.rpc('log_renewal_contact', {
      p_customer_id: r.customer_id,
      p_channel: channel,
      p_outcome: outcome,
      p_note: null,
    });
    if (error) return toast.error(error.message);
    toast.success('Записали контакт');
    load();
  }

  function exportCSV() {
    const lines = [['name','phone','next_check','bucket','last_contact']];
    filtered.forEach(r => lines.push([
      r.full_name || '',
      (r.phone || '').replace(/\s+/g,''),
      r.next_check_fmt || '',
      r.bucket,
      r.last_contact_at ? fmtDT(r.last_contact_at) : ''
    ]));
    const csv = lines.map(l => l.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'renewals.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-[100dvh] relative">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-44 -left-44 w-[560px] h-[560px] rounded-full blur-3xl opacity-40"
             style={{ background: 'radial-gradient(35% 35% at 50% 50%, rgba(56,189,248,0.85) 0%, rgba(56,189,248,0) 70%)' }} />
        <div className="absolute -right-48 top-[20%] w-[520px] h-[520px] rounded-full blur-3xl opacity-35"
             style={{ background: 'radial-gradient(35% 35% at 50% 50%, rgba(99,102,241,0.9) 0%, rgba(99,102,241,0) 70%)' }} />
      </div>

      <Toaster position="top-right"/>
      <div className="mx-auto max-w-7xl p-6 space-y-4">
        <Glass className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg md:text-xl font-semibold bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-500 bg-clip-text text-transparent">Обзвон/Напоминания</div>
            <div className="flex gap-2">
              <Btn variant="outline" onClick={load}>Обновить</Btn>
              <Btn variant="outline" onClick={exportCSV}>Экспорт CSV</Btn>
            </div>
          </div>
        </Glass>

        <Glass className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              value={q} onChange={e=>setQ(e.target.value)}
              placeholder="Поиск: ФИО, телефон"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white/80 outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <select value={bucket} onChange={e=>setB(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white/80 outline-none focus:ring-2 focus:ring-indigo-200">
              <option value="all">Все</option>
              <option value="due">Пора (12+ мес)</option>
              <option value="soon">Скоро (≤30 дней)</option>
              <option value="later">Позже</option>
            </select>
            <div className="text-sm self-center text-slate-600">
              К показу: <b>{filtered.length}</b>
            </div>
          </div>
        </Glass>

        <Glass className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/70 backdrop-blur">
                <tr>
                  <th className="px-4 py-3">Клиент</th>
                  <th className="px-4 py-3">Телефон</th>
                  <th className="px-4 py-3">Контроль</th>
                  <th className="px-4 py-3">Сегмент</th>
                  <th className="px-4 py-3">Последний контакт</th>
                  <th className="px-4 py-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({length:6}).map((_,i)=>(
                  <tr key={i} className="border-t border-white/60">
                    <td className="px-4 py-3" colSpan={6}><div className="h-4 w-full bg-slate-200/60 rounded animate-pulse"/></td>
                  </tr>
                ))}
                {!loading && filtered.map(r=>(
                  <tr key={r.customer_id} className="border-t border-white/60 hover:bg-white/60">
                    <td className="px-4 py-3">{r.full_name || '—'}</td>
                    <td className="px-4 py-3"><a className="text-indigo-600 hover:underline" href={`tel:${r.phone||''}`}>{r.phone || '—'}</a></td>
                    <td className="px-4 py-3">{r.next_check_fmt || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-lg border text-xs bg-white/70
                        ${r.bucket==='due' ? 'border-rose-300 text-rose-700' :
                          r.bucket==='soon' ? 'border-amber-300 text-amber-700' :
                          'border-slate-300 text-slate-700'}`}>
                        {r.bucket==='due'?'пора':r.bucket==='soon'?'скоро':'позже'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{r.last_contact_at ? fmtDT(r.last_contact_at) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Btn variant="outline" onClick={()=>markContact(r,'attempt','call')}>Звонил</Btn>
                        <Btn variant="outline" onClick={()=>markContact(r,'reached','call')}>Дозвонился</Btn>
                        <Btn variant="outline" onClick={()=>markContact(r,'scheduled','call')}>Назначил визит</Btn>
                        <Btn variant="outline" onClick={()=>markContact(r,'declined','call')}>Отказ</Btn>
                        <Btn onClick={()=>markContact(r,'sold','call')}>Продажа</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && !filtered.length && (
                  <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={6}>Пока никого</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Glass>
      </div>
    </div>
  );
}
