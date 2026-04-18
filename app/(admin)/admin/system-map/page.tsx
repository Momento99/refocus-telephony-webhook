'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, MiniMap,
  useNodesState, useEdgesState,
  type Node, type Edge, Position, Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

/* ═══ COLORS ═══ */
const C: Record<string, { bg: string; border: string; text: string; dim: string }> = {
  crm:       { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd', dim: '#60a5fa' },
  pos:       { bg: '#14432a', border: '#22c55e', text: '#86efac', dim: '#4ade80' },
  kiosk:     { bg: '#422006', border: '#f59e0b', text: '#fcd34d', dim: '#fbbf24' },
  mobile:    { bg: '#4a1942', border: '#ec4899', text: '#f9a8d4', dim: '#f472b6' },
  supabase:  { bg: '#134e4a', border: '#14b8a6', text: '#99f6e4', dim: '#2dd4bf' },
  telephony: { bg: '#3b0764', border: '#a855f7', text: '#d8b4fe', dim: '#c084fc' },
  rpc:       { bg: '#1e1b4b', border: '#6366f1', text: '#a5b4fc', dim: '#818cf8' },
};

/* ═══ CUSTOM NODES ═══ */
const hs = (color: string, sz = 6) => (<>
  <Handle type="target" position={Position.Top} style={{ background: color, width: sz, height: sz, border: 'none' }} />
  <Handle type="source" position={Position.Bottom} style={{ background: color, width: sz, height: sz, border: 'none' }} />
  <Handle type="target" position={Position.Left} id="left" style={{ background: color, width: sz, height: sz, border: 'none' }} />
  <Handle type="source" position={Position.Right} id="right" style={{ background: color, width: sz, height: sz, border: 'none' }} />
</>);

function SystemNode({ data }: { data: any }) {
  const c = C[data.system] || C.crm;
  return (<div style={{ background: c.bg, border: `2px solid ${c.border}`, borderRadius: 18, padding: '14px 22px', minWidth: 180, boxShadow: `0 0 30px ${c.border}25, 0 4px 24px rgba(0,0,0,0.4)` }}>
    {hs(c.border, 8)}
    <div style={{ fontSize: 10, fontWeight: 700, color: c.dim, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{data.type}</div>
    <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', marginTop: 2 }}>{data.label}</div>
    {data.subtitle && <div style={{ fontSize: 10, color: c.text, opacity: 0.6, marginTop: 2 }}>{data.subtitle}</div>}
  </div>);
}
function PageNode({ data }: { data: any }) {
  const c = C[data.system] || C.crm;
  return (<div style={{ background: '#1e293b', border: `1px solid ${c.border}50`, borderRadius: 10, padding: '6px 12px', minWidth: 120, boxShadow: `0 0 8px ${c.border}15` }}>
    {hs(c.border, 5)}
    <div style={{ fontSize: 11, fontWeight: 600, color: c.text }}>{data.label}</div>
    {data.subtitle && <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>{data.subtitle}</div>}
  </div>);
}
function TableNode({ data }: { data: any }) {
  return (<div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px' }}>
    {hs('#475569', 4)}
    <div style={{ fontSize: 9, fontWeight: 600, color: '#94a3b8', fontFamily: 'monospace' }}>{data.label}</div>
  </div>);
}
function RpcNode({ data }: { data: any }) {
  return (<div style={{ background: C.rpc.bg, border: `1px solid ${C.rpc.border}60`, borderRadius: 8, padding: '4px 10px' }}>
    {hs(C.rpc.border, 4)}
    <div style={{ fontSize: 9, fontWeight: 600, color: C.rpc.text, fontFamily: 'monospace' }}>{data.label}</div>
  </div>);
}
const nodeTypes = { system: SystemNode, page: PageNode, table: TableNode, rpc: RpcNode };

/* ═══════════════════════════════════════════════════
   NODES — раскладка от большего к меньшему
   CRM (верх-лево)   Mobile (верх-центр)   POS (верх-право)
                     Supabase (ЦЕНТР)
   Telephony (низ-лево)                   Kiosk (низ-право)
   ═══════════════════════════════════════════════════ */
const N: Node[] = [
  // 6 систем по углам + центр
  { id: 'crm',       type: 'system', position: { x: 0,    y: 0 },    data: { label: 'Refocus CRM', type: 'Web App', subtitle: 'Next.js', system: 'crm' } },
  { id: 'pos',       type: 'system', position: { x: 1400, y: 0 },    data: { label: 'POS (Касса)', type: 'Electron', subtitle: 'Next.js + Electron', system: 'pos' } },
  { id: 'mobile',    type: 'system', position: { x: 650,  y: -300 }, data: { label: 'Mobile App', type: 'React Native', subtitle: 'Expo', system: 'mobile' } },
  { id: 'supabase',  type: 'system', position: { x: 620,  y: 350 },  data: { label: 'Supabase', type: 'PostgreSQL', subtitle: '45+ таблиц · 21+ RPC', system: 'supabase' } },
  { id: 'kiosk',     type: 'system', position: { x: 1400, y: 700 },  data: { label: 'Kiosk', type: 'Electron', subtitle: 'Тач-экран', system: 'kiosk' } },
  { id: 'telephony', type: 'system', position: { x: 0,    y: 700 },  data: { label: 'Zadarma', type: 'VoIP', subtitle: '5 филиалов', system: 'telephony' } },

  // CRM pages — две колонки слева
  { id: 'crm-stats',          type: 'page', position: { x: -280, y: -50 },  data: { label: 'Статистика', subtitle: '/admin/stats', system: 'crm' } },
  { id: 'crm-finance',        type: 'page', position: { x: -280, y: 15 },   data: { label: 'Финансы', subtitle: '/finance/overview', system: 'crm' } },
  { id: 'crm-reconciliation', type: 'page', position: { x: -280, y: 80 },   data: { label: 'Сверка выручки', subtitle: '/finance/reconciliation', system: 'crm' } },
  { id: 'crm-payroll',        type: 'page', position: { x: -280, y: 145 },  data: { label: 'Зарплаты', subtitle: '/settings/payroll', system: 'crm' } },
  { id: 'crm-budget',         type: 'page', position: { x: -280, y: 210 },  data: { label: 'Бюджет', subtitle: '/admin/budget', system: 'crm' } },
  { id: 'crm-customers',      type: 'page', position: { x: -280, y: 275 },  data: { label: 'Клиенты', subtitle: '/customers', system: 'crm' } },
  { id: 'crm-orders',         type: 'page', position: { x: -280, y: 340 },  data: { label: 'Заказы', subtitle: '/orders', system: 'crm' } },
  { id: 'crm-receipt',        type: 'page', position: { x: -280, y: 405 },  data: { label: 'Чек заказа', subtitle: '/receipt', system: 'crm' } },
  { id: 'crm-devices',        type: 'page', position: { x: -20,  y: 130 },  data: { label: 'Устройства', subtitle: '/admin/devices', system: 'crm' } },
  { id: 'crm-procurement',    type: 'page', position: { x: -20,  y: 195 },  data: { label: 'Закупки линз', subtitle: '/admin/lens-procurement', system: 'crm' } },
  { id: 'crm-barcodes',       type: 'page', position: { x: -20,  y: 260 },  data: { label: 'Штрихкоды', subtitle: '/settings/barcodes', system: 'crm' } },
  { id: 'crm-notifications',  type: 'page', position: { x: -20,  y: 325 },  data: { label: 'Уведомления', subtitle: '/admin/notifications', system: 'crm' } },
  { id: 'crm-franchise',      type: 'page', position: { x: -20,  y: 390 },  data: { label: 'Франшиза', subtitle: '/admin/franchise', system: 'crm' } },
  { id: 'crm-qa',             type: 'page', position: { x: -20,  y: 455 },  data: { label: 'Качество', subtitle: '/settings/service-qa', system: 'crm' } },
  { id: 'crm-print',          type: 'page', position: { x: -20,  y: 520 },  data: { label: 'Печать чеков', subtitle: '/print', system: 'crm' } },
  { id: 'crm-ai',             type: 'page', position: { x: -20,  y: 585 },  data: { label: 'AI-сообщения', subtitle: '/admin/ai', system: 'crm' } },
  { id: 'crm-warehouse',      type: 'page', position: { x: -20,  y: 650 },  data: { label: 'Склад', subtitle: '/warehouse', system: 'crm' } },

  // POS pages — две колонки справа
  { id: 'pos-login',           type: 'page', position: { x: 1350, y: 110 },  data: { label: 'Логин', subtitle: '/pos/login', system: 'pos' } },
  { id: 'pos-neworder',        type: 'page', position: { x: 1550, y: 110 },  data: { label: 'Новый заказ', subtitle: '/new-order', system: 'pos' } },
  { id: 'pos-orders',          type: 'page', position: { x: 1350, y: 180 },  data: { label: 'Заказы + оплаты', subtitle: '/orders', system: 'pos' } },
  { id: 'pos-customers',       type: 'page', position: { x: 1550, y: 180 },  data: { label: 'Клиенты', subtitle: '/customers', system: 'pos' } },
  { id: 'pos-myshift',         type: 'page', position: { x: 1350, y: 260 },  data: { label: 'Моя смена', subtitle: '/my-shift', system: 'pos' } },
  { id: 'pos-expenses',        type: 'page', position: { x: 1550, y: 260 },  data: { label: 'Расходы', subtitle: '/expenses', system: 'pos' } },
  { id: 'pos-lens-wh',         type: 'page', position: { x: 1350, y: 340 },  data: { label: 'Склад линз', subtitle: '/pos/lens-warehouse', system: 'pos' } },
  { id: 'pos-consumables',     type: 'page', position: { x: 1550, y: 340 },  data: { label: 'Расходники', subtitle: '/pos/consumables', system: 'pos' } },
  { id: 'pos-customer-screen', type: 'page', position: { x: 1720, y: 110 },  data: { label: 'Экран клиента', subtitle: '/customer-screen', system: 'pos' } },

  // Mobile pages — горизонтально под Mobile
  { id: 'mob-home',     type: 'page', position: { x: 400,  y: -210 }, data: { label: 'Главная', system: 'mobile' } },
  { id: 'mob-orders',   type: 'page', position: { x: 520,  y: -210 }, data: { label: 'Заказы', system: 'mobile' } },
  { id: 'mob-lenses',   type: 'page', position: { x: 640,  y: -210 }, data: { label: 'Линзы', system: 'mobile' } },
  { id: 'mob-bonuses',  type: 'page', position: { x: 760,  y: -210 }, data: { label: 'Бонусы', system: 'mobile' } },
  { id: 'mob-branches', type: 'page', position: { x: 880,  y: -210 }, data: { label: 'Филиалы', system: 'mobile' } },
  { id: 'mob-vision',   type: 'page', position: { x: 520,  y: -145 }, data: { label: 'Зрение', system: 'mobile' } },
  { id: 'mob-profile',  type: 'page', position: { x: 760,  y: -145 }, data: { label: 'Профиль', system: 'mobile' } },

  // Kiosk page
  { id: 'kiosk-catalog', type: 'page', position: { x: 1400, y: 810 }, data: { label: 'Каталог линз', system: 'kiosk' } },

  // Supabase tables — сетка под Supabase
  { id: 'tbl-orders',        type: 'table', position: { x: 380,  y: 490 }, data: { label: 'orders' } },
  { id: 'tbl-order-items',   type: 'table', position: { x: 490,  y: 490 }, data: { label: 'order_items' } },
  { id: 'tbl-customers',     type: 'table', position: { x: 610,  y: 490 }, data: { label: 'customers' } },
  { id: 'tbl-payments',      type: 'table', position: { x: 720,  y: 490 }, data: { label: 'payments' } },
  { id: 'tbl-employees',     type: 'table', position: { x: 840,  y: 490 }, data: { label: 'employees' } },
  { id: 'tbl-attendance',    type: 'table', position: { x: 380,  y: 540 }, data: { label: 'attendance' } },
  { id: 'tbl-terminals',     type: 'table', position: { x: 500,  y: 540 }, data: { label: 'terminals' } },
  { id: 'tbl-branches',      type: 'table', position: { x: 620,  y: 540 }, data: { label: 'branches' } },
  { id: 'tbl-expenses',      type: 'table', position: { x: 730,  y: 540 }, data: { label: 'expenses' } },
  { id: 'tbl-refunds',       type: 'table', position: { x: 840,  y: 540 }, data: { label: 'refunds' } },
  { id: 'tbl-telephony',     type: 'table', position: { x: 380,  y: 590 }, data: { label: 'telephony_calls' } },
  { id: 'tbl-update',        type: 'table', position: { x: 520,  y: 590 }, data: { label: 'update_channels' } },
  { id: 'tbl-payroll-config',type: 'table', position: { x: 670,  y: 590 }, data: { label: 'payroll_config' } },
  { id: 'tbl-payroll-view',  type: 'table', position: { x: 810,  y: 590 }, data: { label: 'v_payroll_daily' } },
  { id: 'tbl-stats-daily',   type: 'table', position: { x: 450,  y: 640 }, data: { label: 'stats_daily' } },
  { id: 'tbl-frames',        type: 'table', position: { x: 580,  y: 640 }, data: { label: 'frames' } },
  { id: 'tbl-lens',          type: 'table', position: { x: 700,  y: 640 }, data: { label: 'lens_catalog' } },
  { id: 'tbl-notifications', type: 'table', position: { x: 830,  y: 640 }, data: { label: 'notifications' } },

  // RPC — далеко слева от CRM (видны при фильтре Статистика)
  { id: 'rpc-revenue',   type: 'rpc', position: { x: -580, y: -50 }, data: { label: 'revenue_inflow_by_day' } },
  { id: 'rpc-branch',    type: 'rpc', position: { x: -580, y: -10 }, data: { label: 'period_by_branch' } },
  { id: 'rpc-payments',  type: 'rpc', position: { x: -580, y: 30 },  data: { label: 'payments_breakdown' } },
  { id: 'rpc-new-ret',   type: 'rpc', position: { x: -580, y: 70 },  data: { label: 'new_vs_returning' } },
  { id: 'rpc-interval',  type: 'rpc', position: { x: -580, y: 110 }, data: { label: 'avg_interval_days' } },
  { id: 'rpc-avgcheck',  type: 'rpc', position: { x: -580, y: 150 }, data: { label: 'avg_median_check' } },
  { id: 'rpc-heatmap',   type: 'rpc', position: { x: -790, y: -50 }, data: { label: 'heatmap_dow_hour' } },
  { id: 'rpc-histogram', type: 'rpc', position: { x: -790, y: -10 }, data: { label: 'check_histogram' } },
  { id: 'rpc-refunds',   type: 'rpc', position: { x: -790, y: 30 },  data: { label: 'refunds_by_day' } },
  { id: 'rpc-age',       type: 'rpc', position: { x: -790, y: 70 },  data: { label: 'age_orders_by_year' } },
  { id: 'rpc-lens',      type: 'rpc', position: { x: -790, y: 110 }, data: { label: 'lens_structure' } },
  { id: 'rpc-netprofit',  type: 'rpc', position: { x: -790, y: 150 }, data: { label: 'net_profit_by_day' } },
  { id: 'rpc-10min',     type: 'rpc', position: { x: -790, y: 190 }, data: { label: 'orders_by_10min' } },
];

/* ═══ EDGES ═══ */
const s = (color: string, dash = false, anim = false): Partial<Edge> => ({
  style: { stroke: color, strokeWidth: 1.2, ...(dash ? { strokeDasharray: '5 3' } : {}) },
  animated: anim, type: 'smoothstep',
});

const E: Edge[] = [
  // System → pages
  ...['crm-stats','crm-finance','crm-reconciliation','crm-payroll','crm-budget','crm-customers','crm-orders','crm-receipt','crm-devices','crm-procurement','crm-barcodes','crm-notifications','crm-franchise','crm-qa','crm-print','crm-ai','crm-warehouse'].map(id => ({ id: `e-${id}`, source: 'crm', target: id, ...s(C.crm.border) })),
  ...['pos-login','pos-neworder','pos-customer-screen','pos-orders','pos-customers','pos-myshift','pos-expenses','pos-lens-wh','pos-consumables'].map(id => ({ id: `e-${id}`, source: 'pos', target: id, ...s(C.pos.border) })),
  ...['mob-home','mob-orders','mob-lenses','mob-bonuses','mob-branches','mob-vision','mob-profile'].map(id => ({ id: `e-${id}`, source: 'mobile', target: id, ...s(C.mobile.border) })),
  { id: 'e-k1', source: 'kiosk', target: 'kiosk-catalog', ...s(C.kiosk.border) },
  // Systems ↔ Supabase
  { id: 'e-crm-sb', source: 'crm', target: 'supabase', ...s(C.supabase.border, false, true) },
  { id: 'e-pos-sb', source: 'pos', target: 'supabase', ...s(C.supabase.border, false, true) },
  { id: 'e-mob-sb', source: 'mobile', target: 'supabase', ...s(C.supabase.border, false, true) },
  { id: 'e-kio-sb', source: 'kiosk', target: 'supabase', ...s(C.supabase.border, false, true) },
  { id: 'e-tel-sb', source: 'telephony', target: 'supabase', ...s(C.telephony.border, false, true) },
  // Supabase → tables
  ...['tbl-orders','tbl-order-items','tbl-customers','tbl-payments','tbl-employees','tbl-attendance','tbl-terminals','tbl-branches','tbl-expenses','tbl-refunds','tbl-telephony','tbl-update','tbl-payroll-config','tbl-payroll-view','tbl-stats-daily','tbl-notifications','tbl-frames','tbl-lens'].map(id => ({ id: `e-sb-${id}`, source: 'supabase', target: id, ...s('#334155', true) })),
  // RPC → Stats
  ...['rpc-revenue','rpc-branch','rpc-payments','rpc-new-ret','rpc-interval','rpc-avgcheck','rpc-heatmap','rpc-histogram','rpc-refunds','rpc-age','rpc-lens','rpc-netprofit','rpc-10min'].map(id => ({ id: `e-s-${id}`, source: id, target: 'crm-stats', ...s(C.rpc.border) })),
  // RPC ← tables
  { id: 'r1', source: 'tbl-orders', target: 'rpc-revenue', ...s(C.rpc.border, true) },
  { id: 'r2', source: 'tbl-payments', target: 'rpc-revenue', ...s(C.rpc.border, true) },
  { id: 'r3', source: 'tbl-orders', target: 'rpc-branch', ...s(C.rpc.border, true) },
  { id: 'r4', source: 'tbl-stats-daily', target: 'rpc-branch', ...s(C.rpc.border, true) },
  { id: 'r5', source: 'tbl-payments', target: 'rpc-payments', ...s(C.rpc.border, true) },
  { id: 'r6', source: 'tbl-orders', target: 'rpc-new-ret', ...s(C.rpc.border, true) },
  { id: 'r7', source: 'tbl-customers', target: 'rpc-new-ret', ...s(C.rpc.border, true) },
  { id: 'r8', source: 'tbl-customers', target: 'rpc-interval', ...s(C.rpc.border, true) },
  { id: 'r9', source: 'tbl-order-items', target: 'rpc-avgcheck', ...s(C.rpc.border, true) },
  { id: 'r10', source: 'tbl-orders', target: 'rpc-heatmap', ...s(C.rpc.border, true) },
  { id: 'r11', source: 'tbl-order-items', target: 'rpc-histogram', ...s(C.rpc.border, true) },
  { id: 'r12', source: 'tbl-refunds', target: 'rpc-refunds', ...s(C.rpc.border, true) },
  { id: 'r13', source: 'tbl-customers', target: 'rpc-age', ...s(C.rpc.border, true) },
  { id: 'r14', source: 'tbl-order-items', target: 'rpc-lens', ...s(C.rpc.border, true) },
  { id: 'r15', source: 'tbl-payments', target: 'rpc-netprofit', ...s(C.rpc.border, true) },
  { id: 'r16', source: 'tbl-expenses', target: 'rpc-netprofit', ...s(C.rpc.border, true) },
  { id: 'r17', source: 'tbl-payroll-view', target: 'rpc-netprofit', ...s(C.rpc.border, true) },
  { id: 'r18', source: 'tbl-orders', target: 'rpc-10min', ...s(C.rpc.border, true) },
  // POS → tables
  { id: 'x1', source: 'pos-neworder', target: 'tbl-orders', ...s('#f97316', true) },
  { id: 'x2', source: 'pos-neworder', target: 'tbl-order-items', ...s('#f97316', true) },
  { id: 'x3', source: 'pos-neworder', target: 'tbl-customers', ...s('#f97316', true) },
  { id: 'x4', source: 'pos-orders', target: 'tbl-payments', ...s('#f97316', true) },
  { id: 'x5', source: 'pos-expenses', target: 'tbl-expenses', ...s('#f97316', true) },
  // Cross-system
  { id: 'c1', source: 'pos-orders', target: 'crm-reconciliation', ...s('#f97316', true) },
  { id: 'c2', source: 'pos-myshift', target: 'crm-payroll', ...s('#f97316', true) },
  { id: 'c3', source: 'crm-devices', target: 'pos', ...s('#ef4444', true) },
  { id: 'c4', source: 'crm-devices', target: 'kiosk', ...s('#ef4444', true) },
  { id: 'c5', source: 'pos-neworder', target: 'mob-orders', ...s('#a855f7', true) },
  { id: 'c6', source: 'crm-procurement', target: 'pos-lens-wh', ...s('#f97316', true) },
  { id: 'c7', source: 'kiosk-catalog', target: 'pos-neworder', ...s('#eab308', true) },
  { id: 'c8', source: 'telephony', target: 'crm-qa', ...s(C.telephony.border, true) },
  { id: 'c9', source: 'pos-neworder', target: 'pos-customer-screen', ...s(C.pos.border) },
  { id: 'c10', source: 'crm-notifications', target: 'mobile', ...s('#ec4899', true) },
  { id: 'c11', source: 'crm-barcodes', target: 'pos-neworder', ...s('#f97316', true) },
  { id: 'c12', source: 'pos-customers', target: 'crm-customers', ...s('#f97316', true) },
  { id: 'c13', source: 'pos-orders', target: 'crm-orders', ...s('#f97316', true) },
  { id: 'c14', source: 'mob-lenses', target: 'kiosk-catalog', ...s('#eab308', true) },
  { id: 'c15', source: 'crm-franchise', target: 'mob-branches', ...s('#ec4899', true) },
  { id: 'c16', source: 'pos-lens-wh', target: 'crm-warehouse', ...s('#f97316', true) },
  { id: 'c17', source: 'pos-expenses', target: 'crm-budget', ...s('#f97316', true) },
  { id: 'c18', source: 'pos-expenses', target: 'crm-finance', ...s('#f97316', true) },
  { id: 'c19', source: 'pos-orders', target: 'crm-stats', ...s('#f97316', true) },
  { id: 'c20', source: 'pos-orders', target: 'mob-bonuses', ...s('#a855f7', true) },
  { id: 'c21', source: 'telephony', target: 'crm-ai', ...s(C.telephony.border, true) },
  { id: 'c22', source: 'crm-devices', target: 'tbl-update', ...s(C.crm.border, true) },
  { id: 'c23', source: 'pos-orders', target: 'crm-receipt', ...s('#f97316', true) },
];

/* ═══ FILTER ═══ */
type V = 'main' | 'all' | 'stats' | 'payroll' | 'finance' | 'devices';
const MAIN = new Set(['crm','pos','mobile','kiosk','supabase','telephony']);
const GROUPS: Record<string, string[]> = {
  stats: ['crm','crm-stats','supabase','pos','pos-neworder','pos-orders','pos-customers','rpc-revenue','rpc-branch','rpc-payments','rpc-new-ret','rpc-interval','rpc-avgcheck','rpc-heatmap','rpc-histogram','rpc-refunds','rpc-age','rpc-lens','rpc-netprofit','rpc-10min','tbl-orders','tbl-customers','tbl-payments','tbl-order-items','tbl-refunds','tbl-stats-daily','tbl-payroll-view','tbl-expenses'],
  payroll: ['crm','crm-payroll','supabase','pos','pos-myshift','tbl-employees','tbl-attendance','tbl-payroll-config','tbl-payroll-view','tbl-orders','tbl-payments'],
  finance: ['crm','crm-finance','crm-reconciliation','supabase','pos','pos-orders','pos-expenses','tbl-orders','tbl-payments','tbl-expenses','tbl-refunds'],
  devices: ['crm','crm-devices','supabase','pos','kiosk','tbl-terminals','tbl-update'],
};
const N2V: Record<string, V> = { 'crm-stats':'stats','crm-payroll':'payroll','crm-finance':'finance','crm-reconciliation':'finance','crm-devices':'devices' };

/* ═══ PAGE ═══ */
export default function SystemMapPage() {
  const [v, setV] = useState<V>('main');

  const f = useMemo(() => {
    if (v === 'all') return { n: N, e: E };
    if (v === 'main') {
      const nn = N.filter(n => MAIN.has(n.id));
      const ids = new Set(nn.map(n => n.id));
      return { n: nn, e: E.filter(e => ids.has(e.source) && ids.has(e.target)) };
    }
    const ids = new Set(GROUPS[v] || []);
    const nn = N.filter(n => ids.has(n.id));
    const nids = new Set(nn.map(n => n.id));
    return { n: nn, e: E.filter(e => nids.has(e.source) && nids.has(e.target)) };
  }, [v]);

  const [nodes, setNodes, onNodesChange] = useNodesState(f.n);
  const [edges, setEdges, onEdgesChange] = useEdgesState(f.e);
  useEffect(() => { setNodes(f.n); setEdges(f.e); }, [f]);

  const btns: { k: V; l: string }[] = [
    { k: 'main', l: 'Главное' }, { k: 'stats', l: 'Статистика' }, { k: 'payroll', l: 'Зарплаты' },
    { k: 'finance', l: 'Финансы' }, { k: 'devices', l: 'Устройства' }, { k: 'all', l: 'Все схемы' },
  ];

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#0f172a', zIndex: 0 }}>
      <ReactFlow
        key={v}
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeClick={useCallback((_: any, n: Node) => { const t = N2V[n.id]; if (t) setV(p => p === t ? 'main' : t); }, [])}
        onPaneClick={() => { if (v !== 'main') setV('main'); }}
        nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.3 }}
        minZoom={0.02} maxZoom={4}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={24} />
        <MiniMap nodeColor={(n) => C[n.data?.system as string]?.border || '#475569'} maskColor="rgba(15,23,42,0.85)" style={{ background: '#1e293b', borderRadius: 10, border: '1px solid #334155' }} position="bottom-right" />
      </ReactFlow>
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: '#1e293be0', backdropFilter: 'blur(12px)', borderRadius: 14, padding: '6px 10px', border: '1px solid #334155', display: 'flex', gap: 4, zIndex: 10, alignItems: 'center' }}>
        {btns.map(b => (
          <button key={b.k} onClick={() => setV(v === b.k ? 'main' : b.k)}
            style={{ fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: v === b.k ? '#3b82f6' : 'transparent', color: v === b.k ? '#fff' : '#94a3b8' }}>{b.l}</button>
        ))}
        <span style={{ width: 1, height: 16, background: '#334155', margin: '0 2px' }} />
        {Object.entries({ crm:'CRM', pos:'Касса', kiosk:'Тач', mobile:'App', supabase:'БД', telephony:'VoIP', rpc:'RPC' }).map(([k,l]) => (
          <span key={k} style={{ display:'flex', alignItems:'center', gap:3, fontSize:10, color:'#64748b' }}>
            <span style={{ width:7, height:7, borderRadius:2, background:C[k]?.border||'#666' }}/>{l}
          </span>
        ))}
      </div>
    </div>
  );
}
