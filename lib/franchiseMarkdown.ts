// Markdown parser for the franchise-hq plan documents.
// Used both client-side (live preview in modal) and server-side (PDF export).
// Supports:
//   - headings (#, ##, ###, ####)
//   - inline: **bold**, *italic*, `code`, ~~strikethrough~~
//   - lists (unordered with -/*/+, ordered with N.)
//   - tables (markdown pipe tables with alignment colons)
//   - blockquotes (>)
//   - horizontal rules (--- or ***)
//   - images: ![alt](url) with optional width via ![alt](url w=NNN)
//   - trainer-only blocks: <!-- TRAINER:START --> ... <!-- TRAINER:END -->

const TRAINER_START_RE = /<!--\s*TRAINER:START\s*-->/gi;
const TRAINER_END_RE = /<!--\s*TRAINER:END\s*-->/gi;
const TRAINER_BLOCK_RE = /<!--\s*TRAINER:START\s*-->[\s\S]*?<!--\s*TRAINER:END\s*-->/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

export interface StripTrainerResult {
  stripped: string;
  hasMarkers: boolean;
  unbalanced: boolean;
}

// Removes everything between TRAINER:START and TRAINER:END markers (inclusive).
// hasMarkers is true if at least one valid pair was found.
// unbalanced is true if start/end counts mismatch — caller can warn the user.
export function stripTrainerSections(md: string): StripTrainerResult {
  const startCount = (md.match(TRAINER_START_RE) || []).length;
  const endCount = (md.match(TRAINER_END_RE) || []).length;
  const hasMarkers = startCount > 0 || endCount > 0;
  const unbalanced = startCount !== endCount;

  let stripped = md.replace(TRAINER_BLOCK_RE, '');
  // Collapse the blank-line gap left by removed blocks: 3+ newlines → 2.
  stripped = stripped.replace(/\n{3,}/g, '\n\n');
  // Collapse adjacent horizontal-rule lines that result from wrapping a block
  // between two `---` separators (e.g. "---\n\n---\n\n## Heading").
  stripped = stripped.replace(/^(?:---|\*\*\*)\s*\n\s*\n(?:---|\*\*\*)\s*$/gm, '---');
  return { stripped, hasMarkers, unbalanced };
}

export function mdEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mdInline(s: string): string {
  return mdEsc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+w=(\d+))?\)/g, (_m, alt, src, w) => {
      const width = w || '320';
      return `<img alt="${alt}" src="${src}" width="${width}" loading="lazy" style="max-width:100%;width:${width}px;border-radius:8px;border:1px solid #e2e8f0;margin:6pt 0;vertical-align:middle">`;
    });
}

export function parseMarkdownToHtml(raw: string): string {
  // Strip HTML comments (including TRAINER:* markers) — they are metadata, not content.
  // Without this, mdEsc would render them as literal "<!--..." in the output.
  const cleaned = raw.replace(HTML_COMMENT_RE, '');
  const lines = cleaned.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').split('\n');
  const out: string[] = [];
  let inUL = false;
  let inOL = false;
  const closeUL = () => {
    if (inUL) {
      out.push('</ul>');
      inUL = false;
    }
  };
  const closeOL = () => {
    if (inOL) {
      out.push('</ol>');
      inOL = false;
    }
  };
  const closeLists = () => {
    closeUL();
    closeOL();
  };

  const parseRow = (line: string): string[] => {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  };
  const isSeparatorRow = (line: string): boolean => {
    const t = line.trim();
    if (!t.includes('|')) return false;
    const cells = parseRow(t);
    if (cells.length === 0) return false;
    return cells.every((c) => /^:?-{3,}:?$/.test(c));
  };
  const rowAlignments = (line: string): ('left' | 'center' | 'right')[] =>
    parseRow(line).map((c) => {
      const l = c.startsWith(':');
      const r = c.endsWith(':');
      if (l && r) return 'center';
      if (r) return 'right';
      return 'left';
    });

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (t.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      closeLists();
      const headerCells = parseRow(t);
      const aligns = rowAlignments(lines[i + 1]);
      out.push('<table class="md-table"><thead><tr>');
      headerCells.forEach((c, idx) => {
        const a = aligns[idx] || 'left';
        out.push(`<th style="text-align:${a}">${mdInline(c)}</th>`);
      });
      out.push('</tr></thead><tbody>');
      i += 2;
      while (i < lines.length) {
        const rt = lines[i].trim();
        if (rt === '' || !rt.includes('|')) break;
        const rowCells = parseRow(rt);
        out.push('<tr>');
        rowCells.forEach((c, idx) => {
          const a = aligns[idx] || 'left';
          out.push(`<td style="text-align:${a}">${mdInline(c)}</td>`);
        });
        out.push('</tr>');
        i++;
      }
      out.push('</tbody></table>');
      continue;
    }

    // Order matters: check most specific (longest) heading prefix first.
    if (/^######\s/.test(t)) {
      closeLists();
      out.push(`<h6>${mdInline(t.replace(/^######\s/, ''))}</h6>`);
      i++;
      continue;
    }
    if (/^#####\s/.test(t)) {
      closeLists();
      out.push(`<h5>${mdInline(t.replace(/^#####\s/, ''))}</h5>`);
      i++;
      continue;
    }
    if (/^####\s/.test(t)) {
      closeLists();
      out.push(`<h4>${mdInline(t.replace(/^####\s/, ''))}</h4>`);
      i++;
      continue;
    }
    if (/^###\s/.test(t)) {
      closeLists();
      out.push(`<h3>${mdInline(t.replace(/^###\s/, ''))}</h3>`);
      i++;
      continue;
    }
    if (/^##\s/.test(t)) {
      closeLists();
      out.push(`<h2>${mdInline(t.replace(/^##\s/, ''))}</h2>`);
      i++;
      continue;
    }
    if (/^#\s/.test(t)) {
      closeLists();
      out.push(`<h1>${mdInline(t.replace(/^#\s/, ''))}</h1>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      closeLists();
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^>\s?/.test(t)) {
      closeLists();
      out.push(`<blockquote>${mdInline(t.replace(/^>\s?/, ''))}</blockquote>`);
      i++;
      continue;
    }
    if (/^[-*+]\s/.test(t)) {
      closeOL();
      if (!inUL) {
        out.push('<ul>');
        inUL = true;
      }
      out.push(`<li>${mdInline(t.replace(/^[-*+]\s/, ''))}</li>`);
      i++;
      continue;
    }
    if (/^\d+\.\s/.test(t)) {
      closeUL();
      if (!inOL) {
        out.push('<ol>');
        inOL = true;
      }
      out.push(`<li>${mdInline(t.replace(/^\d+\.\s/, ''))}</li>`);
      i++;
      continue;
    }
    if (t === '') {
      closeLists();
      out.push('<div class="md-sp"></div>');
      i++;
      continue;
    }
    // Standalone image (image-only line) — render as <figure> rather than
    // <p><img></p>. CSS keeps the figure attached to the heading above and
    // prevents Chromium from leaving a big white gap when the image doesn't
    // fit on the current PDF page.
    const imageOnly = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+w=(\d+))?\)$/.exec(t);
    if (imageOnly) {
      closeLists();
      const [, alt, src, w] = imageOnly;
      const width = w || '320';
      out.push(
        `<figure class="md-figure"><img alt="${mdEsc(alt)}" src="${src}" width="${width}" loading="lazy"></figure>`,
      );
      i++;
      continue;
    }
    closeLists();
    out.push(`<p>${mdInline(t)}</p>`);
    i++;
  }
  closeLists();
  return out.join('\n');
}

// ─── PDF HTML wrapper ──────────────────────────────────────────────────────────
// Generates a complete, self-contained HTML page tuned for headless Chromium PDF rendering.
// A4 portrait, 2cm margins, Manrope font, inline-friendly tables, image-aware page breaks.

export function buildPdfHtml(opts: {
  title: string;
  description: string;
  content: string;
  notes?: string;
  itemId?: string;
  brandFontDataUri?: string;
  audienceLabel?: string; // e.g. "Версия для продавца" — shown under title
}): string {
  const { title, description, content, notes, itemId, brandFontDataUri, audienceLabel } = opts;
  const today = new Date().toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const esc = mdEsc;
  const brandFontFace = brandFontDataUri
    ? `@font-face { font-family: 'RefocusBrand'; src: url('${brandFontDataUri}') format('truetype'); font-weight: 400; font-style: normal; font-display: block; }`
    : '';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  ${brandFontFace}
  @page { size: A4; margin: 22mm 18mm 22mm 18mm; }
  /* Скрываем running header на первой странице: обнуляем верхний margin —
     Puppeteer рисует header внутри этого margin, и ему просто негде отрисоваться.
     Свой отступ компенсируем через padding-top у .doc-header. */
  @page :first { margin-top: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Manrope', 'Segoe UI', system-ui, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1e293b;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .doc-header {
    padding-top: 22mm; /* компенсируем обнулённый margin-top на первой странице */
    margin-bottom: 18pt;
  }
  .brand-mark {
    font-family: 'RefocusBrand', 'Manrope', sans-serif;
    font-size: 38pt;
    color: #0F172A;
    line-height: 1;
    letter-spacing: 0.01em;
    margin: 0 0 6pt 0;
  }
  .brand-rule {
    height: 3pt;
    width: 64mm;
    border-radius: 2pt;
    background: linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%);
    margin-bottom: 14pt;
  }
  .brand-context {
    font-size: 7.5pt;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #0369A1;
    margin-bottom: 6pt;
  }
  .doc-title {
    font-size: 19pt;
    font-weight: 800;
    color: #0F172A;
    line-height: 1.2;
    margin: 0 0 6pt 0;
  }
  .doc-desc {
    font-size: 9.5pt;
    color: #475569;
    font-weight: 500;
    margin: 0 0 8pt 0;
    line-height: 1.45;
  }
  .doc-meta {
    font-size: 7.5pt;
    color: #94A3B8;
    letter-spacing: 0.04em;
    padding-top: 8pt;
    border-top: 0.6pt solid #e2e8f0;
  }

  h1 { font-size: 15pt; font-weight: 800; color: #0F172A; margin: 18pt 0 6pt; page-break-after: avoid; break-after: avoid; }
  h2 { font-size: 12.5pt; font-weight: 700; color: #1E3A5F; margin: 14pt 0 4pt; padding-bottom: 3pt; border-bottom: 1px solid #e0f2fe; page-break-after: avoid; break-after: avoid; }
  h3 { font-size: 11pt; font-weight: 700; color: #334155; margin: 12pt 0 3pt; page-break-after: avoid; break-after: avoid; }
  h4 { font-size: 10pt; font-weight: 700; color: #475569; margin: 9pt 0 2pt; page-break-after: avoid; break-after: avoid; }
  h5 { font-size: 9.5pt; font-weight: 700; color: #0369A1; margin: 8pt 0 2pt; text-transform: none; page-break-after: avoid; break-after: avoid; }
  h6 { font-size: 9pt; font-weight: 600; color: #64748B; margin: 6pt 0 2pt; text-transform: uppercase; letter-spacing: 0.04em; page-break-after: avoid; break-after: avoid; }

  p { margin: 0 0 6pt 0; orphans: 3; widows: 3; }
  strong { font-weight: 700; color: #0F172A; }
  em { font-style: italic; }
  s { color: #94A3B8; }

  ul, ol { margin: 4pt 0 8pt 0; padding-left: 18pt; }
  li { margin: 2pt 0; }

  hr { border: none; border-top: 0.6pt solid #cbd5e1; margin: 12pt 0; }

  blockquote {
    margin: 8pt 0;
    padding: 6pt 10pt;
    border-left: 2pt solid #0EA5E9;
    background: #f0f9ff;
    border-radius: 0 4pt 4pt 0;
    color: #0c4a6e;
    font-size: 10pt;
  }
  blockquote p { margin: 0; }

  code {
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    background: #f1f5f9;
    color: #0369A1;
    padding: 1px 4pt;
    border-radius: 3px;
  }

  table.md-table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0 12pt;
    font-size: 9.5pt;
    page-break-inside: auto;
  }
  table.md-table thead { display: table-header-group; }
  table.md-table thead tr { background: #f0f9ff; }
  table.md-table th {
    padding: 6pt 8pt;
    font-weight: 700;
    color: #0c4a6e;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 0.6pt solid #bae6fd;
    text-align: left;
  }
  table.md-table td {
    padding: 5pt 8pt;
    color: #1e293b;
    border: 0.6pt solid #e2e8f0;
    vertical-align: top;
  }
  table.md-table tbody tr:nth-child(even) td { background: #f8fafc; }
  table.md-table tr { page-break-inside: avoid; }

  img {
    max-width: 100%;
    page-break-inside: avoid;
    break-inside: avoid;
    border-radius: 4pt;
  }

  /* Standalone image as a figure — keeps the image stuck to the heading above
     so Chromium doesn't leave a big white gap on the previous page when the
     image is too tall to fit. */
  .md-figure {
    display: block;
    margin: 8pt 0;
    padding: 0;
    text-align: center;
    page-break-inside: avoid;
    break-inside: avoid;
    page-break-before: avoid;
    break-before: avoid;
  }
  .md-figure img {
    max-width: 100%;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    margin: 0;
    vertical-align: middle;
  }

  .md-sp { height: 4pt; }

  .footnote {
    margin-top: 32pt;
    padding-top: 8pt;
    border-top: 0.6pt solid #e2e8f0;
    font-size: 8pt;
    color: #94A3B8;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <div class="doc-header">
    <div class="brand-mark">refocus</div>
    <div class="brand-rule"></div>
    <div class="brand-context">Штаб франшизы${itemId ? ' · ' + esc(itemId) : ''}${audienceLabel ? ' · ' + esc(audienceLabel) : ''}</div>
    <div class="doc-title">${esc(title)}</div>
    <div class="doc-desc">${esc(description)}</div>
    <div class="doc-meta">Сгенерировано: ${today}</div>
  </div>

  ${forcePdfEagerImages(parseMarkdownToHtml(content))}

  ${notes ? `<div class="footnote"><strong style="color:#0369A1;">Заметки штаба:</strong><br>${forcePdfEagerImages(parseMarkdownToHtml(notes))}</div>` : ''}
</body>
</html>`;
}

// Headless Chromium captures the full page without scrolling, so images marked
// loading="lazy" never trigger network requests and stay blank in the PDF.
// For server-rendered PDF we force eager loading on all <img>.
function forcePdfEagerImages(html: string): string {
  return html.replace(/loading="lazy"/g, 'loading="eager"');
}
