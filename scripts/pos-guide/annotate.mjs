// Annotation helpers — inject overlay onto a Playwright page before screenshot.
//
// Usage:
//   import { addAnnotations, clearAnnotations } from './annotate.mjs';
//   await addAnnotations(page, [
//     { selector: 'input[placeholder="gulzat"]', label: '1. Логин сотрудника', placement: 'right' },
//     { selector: 'input[type="password"]', label: '2. PIN филиала (4 цифры)', placement: 'right' },
//     { selector: 'button[type="submit"]', label: '3. Нажать «Войти»', placement: 'right', emphasis: true },
//   ]);
//   await page.screenshot({ ... });
//   await clearAnnotations(page);
//
// Style:
//   - Red rounded outline around the target element
//   - Floating numbered chip + caption to the side
//   - Cyan arrow from chip to element
//   - All overlays sit in a fixed layer with `pointer-events:none` and don't reflow page

const STYLE = `
  .pg-overlay-root { position: fixed; inset: 0; z-index: 999999; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }

  /* Outline around target element */
  .pg-outline { position: fixed; border: 2.5px solid #a855f7; border-radius: 10px; box-shadow: 0 0 0 2px rgba(168,85,247,.18), 0 6px 22px rgba(168,85,247,.35); }
  .pg-outline.pg-emphasis { border-color: #06b6d4; box-shadow: 0 0 0 2px rgba(6,182,212,.18), 0 8px 28px rgba(6,182,212,.45); }

  /* Inline text chip (sparse pages) */
  .pg-label { position: fixed; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: #fff; padding: 5px 9px 5px 7px; border-radius: 10px; font-size: 11.5px; font-weight: 600; line-height: 1.25; box-shadow: 0 4px 14px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.18); display: inline-flex; align-items: center; gap: 6px; max-width: 240px; white-space: normal; }
  .pg-label.pg-emphasis { background: linear-gradient(135deg, #06b6d4 0%, #1e40af 100%); font-size: 12.5px; padding: 6px 10px 6px 8px; }
  .pg-label .pg-num { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; border-radius: 999px; background: rgba(255,255,255,.28); font-size: 11px; font-weight: 700; padding: 0 5px; }

  /* Compact numbered dot (dense pages) */
  .pg-dot { position: fixed; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: #fff; font-weight: 800; font-size: 12.5px; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(124,58,237,.55), 0 0 0 2px #fff; }
  .pg-dot.pg-emphasis { background: linear-gradient(135deg, #06b6d4 0%, #1e40af 100%); box-shadow: 0 3px 10px rgba(6,182,212,.55), 0 0 0 2px #fff; width: 26px; height: 26px; font-size: 13px; }

  /* Legend block (compact mode) */
  .pg-legend { position: fixed; background: #ffffff; border-radius: 16px; padding: 14px 16px; box-shadow: 0 12px 40px rgba(0,0,0,.45), 0 0 0 1px rgba(15,23,42,.06); max-width: 360px; }
  .pg-legend-title { font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 10px; letter-spacing: .02em; text-transform: uppercase; }
  .pg-legend-row { display: flex; align-items: flex-start; gap: 9px; padding: 5px 0; line-height: 1.35; font-size: 12px; color: #0f172a; }
  .pg-legend-num { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: #fff; font-weight: 800; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(124,58,237,.45); margin-top: 1px; }
  .pg-legend-num.pg-emphasis { background: linear-gradient(135deg, #06b6d4 0%, #1e40af 100%); box-shadow: 0 2px 6px rgba(6,182,212,.45); }

  .pg-arrow { position: fixed; pointer-events: none; }
`;

export async function addAnnotations(page, items, opts = {}) {
  await page.evaluate(({ items, styleStr, opts }) => {
    // root
    let root = document.getElementById('pg-overlay-root');
    if (!root) {
      const style = document.createElement('style');
      style.id = 'pg-overlay-style';
      style.textContent = styleStr;
      document.head.appendChild(style);
      root = document.createElement('div');
      root.id = 'pg-overlay-root';
      root.className = 'pg-overlay-root';
      document.body.appendChild(root);
    }
    root.innerHTML = '';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'pg-arrow');
    svg.setAttribute('width', String(window.innerWidth));
    svg.setAttribute('height', String(window.innerHeight));
    svg.style.left = '0';
    svg.style.top = '0';

    const defs = document.createElementNS(svgNS, 'defs');
    for (const color of ['#ef4444', '#06b6d4']) {
      const id = color === '#ef4444' ? 'pg-arrow-red' : 'pg-arrow-cyan';
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '8');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('orient', 'auto-start-reverse');
      const tri = document.createElementNS(svgNS, 'path');
      tri.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      tri.setAttribute('fill', color);
      marker.appendChild(tri);
      defs.appendChild(marker);
    }
    svg.appendChild(defs);
    root.appendChild(svg);

    function findEl(item) {
      if (item.selector) return document.querySelector(item.selector);
      if (item.text) {
        const tag = item.tag || '*';
        const nodes = document.querySelectorAll(tag);
        for (const n of nodes) {
          const t = (n.textContent || '').trim();
          if (t === item.text) return n;
        }
        // fallback: contains
        for (const n of nodes) {
          const t = (n.textContent || '').trim();
          if (t.includes(item.text) && t.length < item.text.length + 50) return n;
        }
      }
      return null;
    }

    const compactMode = opts.mode === 'compact';

    // ── Pass 1: build records with element rect, draw outlines, measure label sizes
    const records = [];
    items.forEach((item, idx) => {
      const el = findEl(item);
      if (!el) {
        console.warn('annotate: not found', item.selector || item.text);
        return;
      }
      const r = el.getBoundingClientRect();
      const emphasis = !!item.emphasis;
      const color = emphasis ? '#06b6d4' : '#a855f7';
      const arrowMarker = emphasis ? 'pg-arrow-cyan' : 'pg-arrow-red';

      const out = document.createElement('div');
      out.className = 'pg-outline' + (emphasis ? ' pg-emphasis' : '');
      Object.assign(out.style, {
        left: r.left - 4 + 'px',
        top: r.top - 4 + 'px',
        width: r.width + 8 + 'px',
        height: r.height + 8 + 'px',
      });
      root.appendChild(out);

      const lab = document.createElement('div');
      const num = item.num ?? idx + 1;
      if (compactMode) {
        lab.className = 'pg-dot' + (emphasis ? ' pg-emphasis' : '');
        lab.textContent = String(num);
      } else {
        lab.className = 'pg-label' + (emphasis ? ' pg-emphasis' : '');
        lab.innerHTML = `<span class="pg-num">${num}</span><span>${item.label}</span>`;
      }
      lab.style.left = '-9999px';
      lab.style.top = '-9999px';
      root.appendChild(lab);
      const lr = lab.getBoundingClientRect();

      const placement = item.placement || (compactMode ? 'corner' : 'right');
      const gap = compactMode ? 0 : 18;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let lx, ly;
      if (compactMode) {
        // dot sits ON the corner of the element, half-overlapping
        lx = r.right - lr.width / 2;
        ly = r.top - lr.height / 2;
      } else if (placement === 'right')      { lx = r.right + gap;            ly = cy - lr.height / 2; }
      else if (placement === 'left')  { lx = r.left  - lr.width - gap; ly = cy - lr.height / 2; }
      else if (placement === 'top')   { lx = cx - lr.width / 2;        ly = r.top - lr.height - gap; }
      else                            { lx = cx - lr.width / 2;        ly = r.bottom + gap; }

      lx = Math.max(2, Math.min(window.innerWidth  - lr.width  - 2, lx));
      ly = Math.max(2, Math.min(window.innerHeight - lr.height - 2, ly));

      records.push({ item, idx, num, el, lab, r, lr: { width: lr.width, height: lr.height }, lx, ly, placement, color, arrowMarker, emphasis });
    });

    // ── Pass 2: collect "obstacles" — all clickable controls on page, plus
    // annotated element rects. Labels must avoid all of these.
    const obstacles = [];
    document.querySelectorAll('button, a, input, select, textarea, [role="button"]').forEach((el) => {
      const rr = el.getBoundingClientRect();
      if (rr.width < 4 || rr.height < 4) return;
      if (rr.bottom < 0 || rr.top > window.innerHeight) return;
      obstacles.push(rr);
    });

    // ── Pass 3: resolve label collisions iteratively.
    // Push each label perpendicular to arrow until it doesn't overlap
    // any earlier label OR any obstacle.
    function overlap(a, b, pad = 6) {
      return !(a.lx + a.lr.width + pad < b.lx ||
               b.lx + b.lr.width + pad < a.lx ||
               a.ly + a.lr.height + pad < b.ly ||
               b.ly + b.lr.height + pad < a.ly);
    }
    function overlapRect(label, elRect, pad = 6) {
      return !(label.lx + label.lr.width  + pad < elRect.left ||
               elRect.right + pad < label.lx ||
               label.ly + label.lr.height + pad < elRect.top  ||
               elRect.bottom + pad < label.ly);
    }
    const STEP = 8;
    const MAX_ITERS = 120;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      let iter = 0;
      // Track direction state: try down first, then up; right then left
      let direction = 1;
      let originalLy = rec.ly;
      let originalLx = rec.lx;
      while (iter++ < MAX_ITERS) {
        let collided = false;
        // earlier labels
        for (let j = 0; j < i; j++) {
          if (overlap(rec, records[j])) { collided = true; break; }
        }
        // own outline element (don't cover the very thing being annotated)
        if (!collided && overlapRect(rec, rec.r, 4)) collided = true;
        // any other interactive control
        if (!collided) {
          for (const o of obstacles) {
            // skip own element
            if (Math.abs(o.left - rec.r.left) < 1 && Math.abs(o.top - rec.r.top) < 1) continue;
            if (overlapRect(rec, o, 4)) { collided = true; break; }
          }
        }
        if (!collided) break;

        if (rec.placement === 'right' || rec.placement === 'left') {
          rec.ly += STEP * direction;
          if (rec.ly + rec.lr.height + 8 > window.innerHeight && direction > 0) {
            direction = -1; rec.ly = originalLy;
          } else if (rec.ly < 8 && direction < 0) {
            break; // give up — keep last position
          }
        } else {
          rec.lx += STEP * direction;
          if (rec.lx + rec.lr.width + 8 > window.innerWidth && direction > 0) {
            direction = -1; rec.lx = originalLx;
          } else if (rec.lx < 8 && direction < 0) {
            break;
          }
        }
      }
    }

    // ── Pass 3: commit final positions and draw arrows (skip arrows in compact mode)
    records.forEach((rec) => {
      rec.lab.style.left = rec.lx + 'px';
      rec.lab.style.top  = rec.ly + 'px';

      if (compactMode) return; // dot sits on the corner, no arrow needed

      const r = rec.r;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const lcx = rec.lx + rec.lr.width / 2;
      const lcy = rec.ly + rec.lr.height / 2;

      const dx = lcx - cx;
      const dy = lcy - cy;
      let ex, ey;
      if (Math.abs(dx) * r.height > Math.abs(dy) * r.width) {
        ex = dx > 0 ? r.right + 4 : r.left - 4;
        ey = Math.max(r.top + 8, Math.min(r.bottom - 8, lcy));
      } else {
        ex = Math.max(r.left + 8, Math.min(r.right - 8, lcx));
        ey = dy > 0 ? r.bottom + 4 : r.top - 4;
      }
      const ldx = ex - lcx;
      const ldy = ey - lcy;
      let lex, ley;
      if (Math.abs(ldx) * rec.lr.height > Math.abs(ldy) * rec.lr.width) {
        lex = ldx > 0 ? rec.lx + rec.lr.width : rec.lx;
        ley = Math.max(rec.ly + 6, Math.min(rec.ly + rec.lr.height - 6, ey));
      } else {
        lex = Math.max(rec.lx + 6, Math.min(rec.lx + rec.lr.width - 6, ex));
        ley = ldy > 0 ? rec.ly + rec.lr.height : rec.ly;
      }
      const line = document.createElementNS(svgNS, 'path');
      const mx = (lex + ex) / 2;
      const my = (ley + ey) / 2;
      const d = `M ${lex} ${ley} Q ${mx} ${my} ${ex} ${ey}`;
      line.setAttribute('d', d);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', rec.color);
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('marker-end', `url(#${rec.arrowMarker})`);
      svg.appendChild(line);
    });

    // ── Pass 4: render legend block (compact mode only)
    if (compactMode && opts.legendAnchor) {
      const legend = document.createElement('div');
      legend.className = 'pg-legend';
      const title = opts.legendTitle || 'Что заполнить';
      let html = `<div class="pg-legend-title">${title}</div>`;
      records.forEach((rec) => {
        html += `<div class="pg-legend-row"><span class="pg-legend-num${rec.emphasis ? ' pg-emphasis' : ''}">${rec.num}</span><span>${rec.item.label}</span></div>`;
      });
      legend.innerHTML = html;
      legend.style.left = '-9999px';
      legend.style.top = '-9999px';
      root.appendChild(legend);
      const lgr = legend.getBoundingClientRect();

      // Resolve anchor → coords
      let lgx, lgy;
      const a = opts.legendAnchor;
      if (a.x != null && a.y != null) {
        lgx = a.x;
        lgy = a.y;
      } else if (a.text) {
        // anchor by visible text
        let ae = null;
        const tag = a.tag || '*';
        for (const n of document.querySelectorAll(tag)) {
          const t = (n.textContent || '').trim();
          if (t === a.text || (t.includes(a.text) && t.length < a.text.length + 50)) { ae = n; break; }
        }
        if (ae) {
          const ar = ae.getBoundingClientRect();
          if (a.placement === 'below') { lgx = ar.left; lgy = ar.bottom + 12; }
          else if (a.placement === 'right') { lgx = ar.right + 12; lgy = ar.top; }
          else { lgx = ar.left; lgy = ar.top; }
        } else {
          lgx = window.innerWidth - lgr.width - 16;
          lgy = window.innerHeight - lgr.height - 16;
        }
      } else if (a.selector) {
        const ae = document.querySelector(a.selector);
        if (ae) {
          const ar = ae.getBoundingClientRect();
          if (a.placement === 'below') {
            lgx = ar.left;
            lgy = ar.bottom + 12;
          } else if (a.placement === 'right') {
            lgx = ar.right + 12;
            lgy = ar.top;
          } else {
            lgx = ar.left;
            lgy = ar.top;
          }
        } else {
          lgx = window.innerWidth - lgr.width - 16;
          lgy = window.innerHeight - lgr.height - 16;
        }
      } else {
        lgx = window.innerWidth - lgr.width - 16;
        lgy = window.innerHeight - lgr.height - 16;
      }
      lgx = Math.max(8, Math.min(window.innerWidth  - lgr.width  - 8, lgx));
      lgy = Math.max(8, Math.min(window.innerHeight - lgr.height - 8, lgy));
      legend.style.left = lgx + 'px';
      legend.style.top  = lgy + 'px';
    }
  }, { items, styleStr: STYLE, opts });
}

export async function clearAnnotations(page) {
  await page.evaluate(() => {
    document.getElementById('pg-overlay-root')?.remove();
    document.getElementById('pg-overlay-style')?.remove();
  });
}
