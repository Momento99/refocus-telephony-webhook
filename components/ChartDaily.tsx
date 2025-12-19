'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

type Pt = { day: string; revenue: number; inflow: number };

export default function ChartDaily({ data }: { data: Pt[] }) {
  if (!data?.length) {
    return (
      <div style={{
        height: 360,
        borderRadius: 12,
        border: '1px solid #203257',
        background: 'linear-gradient(180deg,#121a2c,#0e1526)',
        color: '#9db3d9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        Данных за выбранный период нет
      </div>
    );
  }

  return (
    <div style={{
      height: 360,
      borderRadius: 12,
      border: '1px solid #203257',
      background: 'linear-gradient(180deg,#121a2c,#0e1526)',
      padding: 12
    }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis dataKey="day" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="revenue" name="Выручка" stroke="#4da6ff" dot />
          <Line type="monotone" dataKey="inflow"  name="Поступления" stroke="#00cc99" dot />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
