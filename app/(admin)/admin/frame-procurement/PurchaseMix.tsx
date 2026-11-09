'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChartPie, Check, ChevronDown, Info, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { buildFramePurchasePlan, isValidPurchaseTarget, type PurchaseSectionKey } from '@/lib/framePurchasePlan';
import { defaultPurchaseMix, isModelExcludedFromPurchase, setPurchaseSectionEnabled,
  setPurchaseSectionQuantity, type PurchaseMixSettings } from '@/lib/framePurchaseMix';
import { modelQuantity, type ManualModel } from '@/lib/frameManualProcurement';
import styles from './purchase-mix.module.css';

const number = (value: number) => value.toLocaleString('ru-RU');
const percent = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export default function PurchaseMix({ target, models, settings, disabled, readonly, onChange }: {
  target: number; models: readonly ManualModel[]; settings?: PurchaseMixSettings; disabled: boolean; readonly: boolean;
  onChange: (settings?: PurchaseMixSettings) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState<PurchaseSectionKey | null>(null);
  const [pendingExclude, setPendingExclude] = useState<PurchaseSectionKey | null>(null);
  const sliderBasis = useRef<{ key: PurchaseSectionKey; mix: PurchaseMixSettings } | null>(null);
  const contentId = useId();
  const mix = useMemo(() => settings || defaultPurchaseMix(), [settings]);
  const plan = useMemo(() => isValidPurchaseTarget(target) ? buildFramePurchasePlan(target, models, mix) : null, [target, models, mix]);
  const highlighted = plan?.sections.find(row => row.key === active);
  const enabledCount = plan?.sections.filter(row => row.enabled).length || 0;
  const custom = !!settings && JSON.stringify(settings) !== JSON.stringify(defaultPurchaseMix());
  const pendingSettings = pendingExclude && enabledCount > 1 ? setPurchaseSectionEnabled(mix, pendingExclude, false) : null;
  const pendingQty = pendingSettings ? models.filter(model => isModelExcludedFromPurchase(model, pendingSettings)).reduce((sum, model) => sum + modelQuantity(model), 0) : 0;
  function exclude(key: PurchaseSectionKey) {
    const next = setPurchaseSectionEnabled(mix, key, false);
    if (models.some(model => modelQuantity(model) > 0 && isModelExcludedFromPurchase(model, next))) setPendingExclude(key);
    else { onChange(next); setActive(null); }
  }
  let offset = 0;

  return <section className={styles.panel} aria-label="План закупки по видам оправ">
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.headingIcon}><ChartPie size={19} /></span>
        <div><h2>План по видам</h2><p>{custom ? 'Ваши пропорции заказа' : 'Рекомендация по продажам пяти филиалов'}</p></div>
      </div>
      <div className={styles.headerActions}>
        {plan && <span className={styles.completion}>По плану <strong>{number(plan.fulfilled)} / {number(plan.target)}</strong></span>}
        <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId}
          aria-label={expanded ? 'Свернуть план по видам' : 'Развернуть план по видам'} onClick={() => setExpanded(!expanded)}>
          <ChevronDown size={19} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
        </button>
      </div>
    </header>
    {expanded && <div id={contentId}>
      {!plan ? <p className={styles.invalid} role="status">Укажи цель от 1 до 100 000 штук — рассчитаем план по видам.</p> : <>
        {!readonly && <div className={styles.controls}>
          <div><button type="button" className={editing ? styles.editingButton : undefined} disabled={disabled}
            aria-pressed={editing} onClick={() => setEditing(!editing)}><SlidersHorizontal size={14} /> {editing ? 'Готово' : 'Настроить'}</button>
            {custom && <button type="button" disabled={disabled} onClick={() => { onChange(); setPendingExclude(null); }}><RotateCcw size={13} /> По продажам</button>}</div>
          <span>{editing ? 'Меняй количество — остальные доли пересчитаются.' : '× убирает вид и распределяет его долю.'}</span>
        </div>}
        {pendingSettings && !readonly && <div className={styles.confirm} role="alert">
          <span>Убрать «{plan.sections.find(row => row.key === pendingExclude)?.label}»? Из заказа уйдут {number(pendingQty)} выбранных оправ. Фото и разметка сохранятся.</span>
          <div><button type="button" disabled={disabled} onClick={() => { onChange(pendingSettings); setPendingExclude(null); setActive(null); }}>Убрать вид и количество</button>
            <button type="button" disabled={disabled} onClick={() => setPendingExclude(null)}>Оставить</button></div>
        </div>}
        <div className={styles.body}>
          <div className={styles.chartColumn}>
            <div className={styles.chart}>
              <svg viewBox="0 0 240 240" role="img" aria-label={`Распределение цели ${number(plan.target)} оправ по видам. Количества и проценты указаны в таблице.`}>
                <circle cx="120" cy="120" r="96" fill="none" stroke="#edf1f7" strokeWidth="26" />
                {plan.sections.map(row => {
                  const start = offset; offset += row.percent;
                  if (!row.planned) return null;
                  const gap = Math.min(.8, row.percent * .16);
                  return <circle key={row.key} cx="120" cy="120" r="96" fill="none" pathLength="100"
                    stroke={row.color} strokeWidth={active === row.key ? 31 : 26}
                    strokeDasharray={`${row.percent - gap} ${100 - row.percent + gap}`}
                    strokeDashoffset={-start - gap / 2} transform="rotate(-90 120 120)"
                    className={styles.segment} opacity={active && active !== row.key ? .28 : 1}
                    onMouseEnter={() => setActive(row.key)} onMouseLeave={() => setActive(null)}>
                    <title>{`${row.label}: ${number(row.planned)} шт. · ${percent(row.percent)}%`}</title>
                  </circle>;
                })}
              </svg>
              <div className={styles.chartCenter} aria-hidden="true">
                <span>{highlighted ? `${percent(highlighted.percent)}% от цели` : 'ЦЕЛЬ ЗАКАЗА'}</span>
                <strong>{number(highlighted?.planned ?? plan.target)}</strong><small>оправ</small>
              </div>
            </div>
            <p className={styles.chartCaption}>{highlighted?.label || 'Состав будущей закупки'}</p>
            <div className={styles.totals}>
              <div><span>Выбрано</span><strong>{number(plan.selectedTotal)}</strong></div>
              <div><span>Ещё по видам</span><strong>{number(plan.remaining)}</strong></div>
            </div>
            {plan.excess > 0 && <p className={styles.excessNote}>Сверх плана отдельных видов: {number(plan.excess)} шт.</p>}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Вид и доля</th><th scope="col">План</th><th scope="col">Выбрано</th><th scope="col">Осталось</th>{!readonly && <th scope="col"><span className={styles.srOnly}>Выключить вид</span></th>}</tr></thead>
              <tbody>{plan.sections.filter(row => row.enabled).map(row => <tr key={row.key} data-section={row.key}
                className={active === row.key ? styles.activeRow : undefined}
                style={{ '--mix-color': row.color, '--mix-percent': `${row.percent}%` } as CSSProperties} onMouseEnter={() => setActive(row.key)} onMouseLeave={() => setActive(null)}>
                <th scope="row"><button type="button" className={styles.rowLabel}
                  onFocus={() => setActive(row.key)} onBlur={() => setActive(null)} onClick={() => setActive(active === row.key ? null : row.key)}
                  aria-label={`${row.label}. Доля ${percent(row.percent)} процентов. План ${row.planned}, выбрано ${row.selected}, осталось ${row.remaining}${row.excess ? `, сверх плана ${row.excess}` : ''}.`}>
                  <i className={styles.dot} /><span className={styles.labelContent}><span>{row.label} <small>{percent(row.percent)}%</small></span>
                    <span className={styles.rowTrack} aria-hidden="true"><i style={{ width: `${row.planned ? Math.min(100, row.selected / row.planned * 100) : row.selected ? 100 : 0}%` }} /></span>
                  </span>
                </button>{editing && !readonly && <input className={styles.slider} type="range" min={0} max={target} step={1} value={row.planned}
                  disabled={disabled || enabledCount === 1} aria-label={`Доля: ${row.label}`} aria-valuetext={`${row.planned} шт., ${percent(row.percent)}%`}
                  onPointerDown={() => { sliderBasis.current = { key: row.key, mix }; }}
                  onFocus={() => { setActive(row.key); sliderBasis.current = { key: row.key, mix }; }}
                  onBlur={() => { setActive(null); sliderBasis.current = null; }}
                  onChange={e => onChange(setPurchaseSectionQuantity(sliderBasis.current?.key === row.key ? sliderBasis.current.mix : mix, target, row.key, Number(e.target.value)))} />}</th>
                <td className={styles.planned}>{editing && !readonly ? <QuantityInput value={row.planned} max={target} label={`План: ${row.label}`}
                  disabled={disabled || enabledCount === 1} onChange={qty => onChange(setPurchaseSectionQuantity(mix, target, row.key, qty))} /> : number(row.planned)}</td>
                <td className={styles.selected} title={row.unisex ? `В том числе унисекс: ${row.unisex} шт.` : undefined}>{number(row.selected)}</td>
                <td>{row.excess > 0 ? <span className={styles.over} title={`Сверх плана: ${row.excess} шт.`}>+{number(row.excess)}</span>
                  : row.remaining > 0 ? <span className={styles.remaining}>{number(row.remaining)}</span>
                  : <span className={styles.done} aria-label="План выполнен"><Check size={14} /> 0</span>}</td>
                {!readonly && <td className={styles.removeCell}><button type="button" className={styles.remove} disabled={disabled || enabledCount === 1}
                  aria-label={`Выключить: ${row.label}`} title={enabledCount === 1 ? 'Оставьте хотя бы один вид' : 'Убрать вид и распределить его долю'} onClick={() => exclude(row.key)}><X size={14} /></button></td>}
              </tr>)}</tbody>
              <tfoot><tr><th scope="row">Всего <span>100%</span></th><td>{number(plan.target)}</td>
                <td>{number(plan.selectedTotal - plan.unassigned)}</td><td>{number(plan.remaining)}</td>{!readonly && <td />}</tr></tfoot>
            </table>
            {mix.excluded.length > 0 && <div className={styles.excluded}><span>Выключены</span><div>{plan.sections.filter(row => !row.enabled).map(row =>
              <button type="button" key={row.key} disabled={disabled || readonly} aria-label={`Вернуть: ${row.label}`}
                onClick={() => { onChange(setPurchaseSectionEnabled(mix, row.key, true)); setPendingExclude(null); }}><Plus size={13} /> {row.label}</button>)}</div></div>}
          </div>
        </div>
        {(plan.unisex > 0 || plan.unassigned > 0) && <div className={styles.notes}>
          {plan.unisex > 0 && <p>Унисекс: {number(plan.unisex)} шт. учтены в свободных местах плана своего вида.</p>}
          {plan.unassigned > 0 && <p className={styles.unassigned}>{number(plan.unassigned)} шт. ещё без подходящего типа или пола — уточни их в карточках.</p>}
        </div>}
      </>}
      <footer className={styles.footer}><span>13 июл — 10 окт 2026 · 926 оправ</span>
        <details><summary><Info size={13} /> Как считается</summary>
          <p>Основа — продажи с небольшим запасом детских. Склад и поставки в пути не вычтены. При изменении количества одного вида остальные делят остаток пропорционально. При смене цели ваши доли сохраняются. Сумма всегда равна цели.</p>
          <p>Крестик выключает вид. Вернуть его можно кнопкой внизу. «По продажам» возвращает исходные доли. Настройки сохраняются вместе с заказом кнопкой «Сохранить».</p>
          <p>«По плану» учитывает заполнение каждого вида. Избыток одного вида не закрывает нехватку другого. Унисекс распределяется по недостающим мужским и женским местам внутри своего вида; карточки при этом не меняются.</p>
        </details>
      </footer>
    </div>}
  </section>;
}

function QuantityInput({ value, max, label, disabled, onChange }: {
  value: number; max: number; label: string; disabled: boolean; onChange: (quantity: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const valid = text !== '' && Number.isInteger(Number(text)) && Number(text) >= 0 && Number(text) <= max;
  return <input className={styles.quantityInput} type="number" inputMode="numeric" min={0} max={max} step={1}
    aria-label={label} aria-invalid={!valid} title={`От 0 до ${max} шт.`} value={text} disabled={disabled}
    onChange={e => { setText(e.target.value); const qty = Number(e.target.value);
      if (e.target.value !== '' && Number.isInteger(qty) && qty >= 0 && qty <= max) onChange(qty); }}
    onBlur={() => setText(String(value))} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />;
}
