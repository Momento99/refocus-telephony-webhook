'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { fetchDailyStats } from '@/lib/fetchDailyStats';
import { groupByDay } from '@/lib/groupByDay';

const ChartDaily = dynamic(() => import('@/components/ChartDaily'), { ssr: false });

type Row = {
  day: string;
  branch_name: string;
  revenue: number;
  inflow: number;
};

export default function TestStatsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // фильтры
  const [fromISO, setFromISO] = useState('2025-06-16');
  const [toISO, setToISO] = useState('2025-09-13');
  const [branches, setBranches] = useState<string[]>([]);

  const branchOptions = ['Кант', 'Кара-Балта', 'Беловодск', 'Сокулук (мастерская)'];

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDailyStats(fromISO, toISO, branches);
      setRows(data);
      console.log('rows', data);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const series = useMemo(() => groupByDay(rows), [rows]);

  const totals = useMemo(() => {
    const t = series.reduce(
      (acc, x) => {
        acc.revenue += x.revenue;
        acc.inflow += x.inflow;
        return acc;
      },
      { revenue: 0, inflow: 0 }
    );
    const debt = Math.max(0, t.revenue - t.inflow);
    return { ...t, debt, orders: rows.length };
  }, [series, rows]);

  return (
    <div style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Тест статистики</h1>

      {/* Фильтры */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>С даты</div>
          <input
            type="date"
            value={fromISO}
            onChange={e => setFromISO(e.target.value)}
            style={{ padding: 8, borderRadius: 8, border: '1px solid #203257', background: '#0b1020', color: '#eaf2ff' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>По дату</div>
          <input
            type="date"
            value={toISO}
            onChange={e => setToISO(e.target.value)}
            style={{ padding: 8, borderRadius: 8, border: '1px solid #203257', background: '#0b1020', color: '#eaf2ff' }}
          />
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Филиалы</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 700 }}>
            {branchOptions.map(b => (
              <label key={b} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#eaf2ff' }}>
                <input
                  type="checkbox"
                  checked={branches.includes(b)}
                  onChange={e => {
                    if (e.target.checked) setBranches(prev => [...prev, b]);
                    else setBranches(prev => prev.filter(x => x !== b));
                  }}
                />
                {b}
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #2a4880',
            background: 'linear-gradient(180deg,#1b2a4a,#14213b)',
            color: '#eaf2ff',
            cursor: 'pointer',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? 'Загружаю…' : 'Показать'}
        </button>
      </div>

      {/* Карточки */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
        <Card title="Выручка">{totals.revenue.toLocaleString('ru-RU')} сом</Card>
        <Card title="Поступления">{totals.inflow.toLocaleString('ru-RU')} сом</Card>
        <Card title="Долг">{totals.debt.toLocaleString('ru-RU')} сом</Card>
        <Card title="Заказы (сыр.)">{totals.orders}</Card>
      </div>

      {/* График */}
      <h2 style={{ fontSize: 18, margin: '12px 0' }}>Динамика по дням</h2>
      <ChartDaily data={series} />
    </div>
  );
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #121a2c, #0e1526)',
        border: '1px solid #203257',
        borderRadius: 12,
        padding: 12,
        color: '#eaf2ff',
      }}
    >
      <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6 }}>{props.title}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{props.children}</div>
    </div>
  );
}
