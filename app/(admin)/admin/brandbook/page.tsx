'use client';

import React, { useState } from 'react';
import { BookOpen, FileDown, Loader2, Palette, Type, ImageIcon, Megaphone, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';

const SECTIONS_OVERVIEW = [
  { num: '01-04', icon: Sparkles, title: 'Фундамент бренда', desc: 'Суть Refocus, ценности, личность, архетип «Заботливый эксперт».' },
  { num: '05-08', icon: Megaphone, title: 'Голос и имя',     desc: 'Tone of voice, контексты речи, naming, tagline «Снова в фокусе».' },
  { num: '09-15', icon: BookOpen,  title: 'Логотип',         desc: 'Главный знак, конструкция, версии, цветовые исполнения, защитное поле, запреты, app icon.' },
  { num: '16-18', icon: Palette,   title: 'Цвет',            desc: 'Primary палитра (Cyan/Slate/White), функциональные цвета, брендовый градиент, контрастность.' },
  { num: '19-21', icon: Type,      title: 'Типографика',     desc: 'Manrope (4 веса), RefocusDisplay для логотипа, иерархия размеров, локализация.' },
  { num: '22-24', icon: ImageIcon, title: 'Иконы и фото',    desc: 'Lucide-react стандарт, фото-стиль, эталоны интерьера точки.' },
  { num: '25-30', icon: FileDown,  title: 'Применение',      desc: 'Полиграфия, print specs, цифровые продукты, соцсети, точка продаж, юр. защита.' },
];

export default function BrandbookPage() {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    const t = toast.loading('Генерирую брендбук… (~10–20 сек)');
    try {
      const res = await fetch('/api/brandbook/export-pdf', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка сервера' }));
        throw new Error(err.error || 'Не удалось сгенерировать PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `refocus-brandbook-v1.0-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.dismiss(t);
      toast.success('Брендбук готов');
    } catch (err) {
      toast.dismiss(t);
      const msg = err instanceof Error ? err.message : 'Ошибка';
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="pb-10">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Brand Guidelines</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">Refocus · версия 1.0 · 30 страниц</div>
          </div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(34,211,238,0.35)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50"
        >
          {downloading ? <><Loader2 className="h-4 w-4 animate-spin"/> Генерирую…</> : <><FileDown className="h-4 w-4"/> Скачать PDF</>}
        </button>
      </div>

      {/* Hero card — что внутри */}
      <div className="mb-6 relative overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_12px_40px_rgba(15,23,42,0.18)] px-6 py-7">
        <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-cyan-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-44 w-44 rounded-full bg-emerald-200/30 blur-3xl" />

        <div className="relative">
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-700 mb-2">
            Brand Book v1.0 · апрель 2026
          </div>
          <div className="font-kiona text-slate-900 leading-none mb-3" style={{ fontSize: '52px', letterSpacing: '0.01em' }}>
            refocus
          </div>
          <div
            className="rounded-full mb-5"
            style={{
              height: '4px',
              width: '280px',
              background: 'linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%)',
            }}
          />
          <p className="text-[15px] text-slate-600 max-w-2xl leading-relaxed">
            Полный визуальный и смысловой канон бренда Refocus.
            30 страниц A4 — логотип, цвета, типографика, голос, применение в материалах,
            точках продаж и цифровых продуктах. Для франчайзи, дизайнеров, типографий, маркетологов.
          </p>
        </div>
      </div>

      {/* Sections overview */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SECTIONS_OVERVIEW.map(s => {
          const Icon = s.icon;
          return (
            <div key={s.num} className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.12)]">
              <div className="flex items-center gap-3 mb-2">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-cyan-50">
                  <Icon className="h-[18px] w-[18px] text-cyan-600" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Стр. {s.num}</div>
                  <div className="text-[14px] font-bold text-slate-900 leading-tight">{s.title}</div>
                </div>
              </div>
              <p className="text-[12px] text-slate-600 leading-relaxed">{s.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Brand fundamentals quick-reference */}
      <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-6 shadow-[0_8px_30px_rgba(15,23,42,0.12)]">
        <h3 className="text-[16px] font-bold text-slate-900 mb-1">Краткая шпаргалка по бренду</h3>
        <p className="text-[12px] text-slate-500 mb-5">Базовые факты — пригодятся, чтобы не открывать брендбук каждый раз.</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1">Имя</div>
            <div className="text-[14px] font-semibold text-slate-900">Refocus</div>
            <div className="text-[11px] text-slate-500">Только R заглавная</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1">Слоган</div>
            <div className="text-[14px] font-semibold text-slate-900">Снова в фокусе</div>
            <div className="text-[11px] text-slate-500">Игра с именем</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1">Архетип</div>
            <div className="text-[14px] font-semibold text-slate-900">Заботливый эксперт</div>
            <div className="text-[11px] text-slate-500">Caregiver + Sage</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1">Email бренда</div>
            <div className="text-[14px] font-semibold text-slate-900">refocus.kg@gmail.com</div>
            <div className="text-[11px] text-slate-500">5 рабочих дней на согласование</div>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">Primary цвета</div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg" style={{ background: '#22D3EE' }} title="#22D3EE Cyan" />
              <div className="h-8 w-8 rounded-lg" style={{ background: '#0F172A' }} title="#0F172A Slate" />
              <div className="h-8 w-8 rounded-lg ring-1 ring-slate-200" style={{ background: '#FFFFFF' }} title="#FFFFFF White" />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">Шрифты</div>
            <div className="text-[12px] text-slate-700"><strong>Manrope</strong> — основной</div>
            <div className="text-[12px] text-slate-700"><strong>RefocusDisplay</strong> — логотип</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">4 ценности</div>
            <div className="text-[12px] text-slate-700">Честность · Понятность · Сопровождение · Технологичность</div>
          </div>
        </div>
      </div>
    </div>
  );
}
