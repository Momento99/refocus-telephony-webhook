// /components/ChartBranches.tsx
'use client';

import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { BRANCH_COLORS, BranchName } from '@/lib/fetchBranchSeries';

type MonthPoint = { day: string; total: number } & Record<BranchName, number | string>;
type YearPoint  = { period: string; total: number } & Record<BranchName, number | string>;

export default function ChartBranches({
  mode,
  data,
  branches,
  height = 360,
}: {
  mode: 'month' | 'year';
  data: MonthPoint[] | YearPoint[];
  branches: BranchName[];
  height?: number;
}) {
  const xKey = mode === 'month' ? 'day' : 'period';

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data as any}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey={xKey}
            tickFormatter={(v: string) => (mode === 'month' ? v.slice(8, 10) : v)}
          />
          <YAxis tickFormatter={(n) => Number(n).toLocaleString('ru-RU')} />
          <Tooltip
            formatter={(v: any) => (typeof v === 'number' ? v.toLocaleString('ru-RU') : v)}
            labelFormatter={(label: string) =>
              mode === 'month'
                ? `${label.slice(8, 10)}.${label.slice(5, 7)}.${label.slice(0, 4)}`
                : label
            }
          />
          <Legend />
          {branches.map((b) => (
            <Line
              key={b}
              type="monotone"
              dataKey={b}
              stroke={BRANCH_COLORS[b]}
              strokeWidth={2.4}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
