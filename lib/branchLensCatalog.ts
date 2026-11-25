export type BranchLensPrice = {
  lens_id: string;
  lens_name: string;
  price_from: number;
  price_to: number;
};

const lensCodes: Record<string, string[]> = {
  standard: ['WHITE'],
  antiglare: ['AR'],
  screen: ['BB'],
  chameleon: ['CHAME_BLACK', 'CHAME_BROWN', 'CHAME_BLUE', 'CHAME_GREEN', 'CHAME_PURPLE'],
  'chameleon-screen': ['CHAME_SCREEN_BLACK', 'CHAME_SCREEN_BROWN'],
  'ast-antiglare': ['AST_AR'],
  'ast-screen': ['AST_BB'],
  'ast-chameleon': ['AST_CHAME_BLACK', 'AST_CHAME_BROWN'],
  'asph-standard': ['ASPH_STANDARD'],
  'asph-antiglare': ['ASPH_AR'],
  'asph-screen': ['ASPH_BB'],
  'thin-antiglare': ['AR_167'],
  'thin-ast-antiglare': ['AST_AR_167'],
  'thin-174-antiglare': ['AR_174'],
  'thin-174-ast-antiglare': ['AST_AR_174'],
  polycarbonate: ['PC_159_HMC'],
  'myopia-control': ['MYOPIA_CONTROL'],
};

const colorNames: Record<string, string> = {
  BLACK: 'чёрный', BROWN: 'коричневый', BLUE: 'синий', GREEN: 'зелёный', PURPLE: 'фиолетовый',
};

export function branchLensOptions(rows: BranchLensPrice[]) {
  return rows.flatMap(row => (lensCodes[row.lens_id] ?? []).map(code => {
    const color = colorNames[code.split('_').at(-1) ?? ''];
    return {
      ...row,
      code,
      label: color ? row.lens_name + ' · ' + color : row.lens_name,
      astigmatic: code.startsWith('AST_'),
    };
  }));
}

export type BranchLensOption = ReturnType<typeof branchLensOptions>[number];

export type EyeLensDraft = { code: string; sph: string; cyl: string; axis: string };
export const emptyEyeLens: EyeLensDraft = { code: '', sph: '', cyl: '', axis: '' };

function parseValue(value: string) {
  const input = value.trim().replace(',', '.').replace('−', '-');
  return input && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input) ? Number(input) : NaN;
}

export function quoteEyeLens(draft: EyeLensDraft, options: BranchLensOption[]) {
  const option = options.find(item => item.code === draft.code);
  const sph = parseValue(draft.sph);
  if (!option || !Number.isFinite(sph) || sph * 4 % 1 !== 0) return null;
  const cyl = option.astigmatic ? parseValue(draft.cyl) : null;
  const ax = option.astigmatic ? parseValue(draft.axis) : null;
  if (cyl !== null && (!Number.isFinite(cyl) || cyl === 0 || cyl * 4 % 1 !== 0)) return null;
  if (ax !== null && (!Number.isInteger(ax) || ax < 0 || ax > 180)) return null;
  const low = Math.abs(sph) <= 2.75;
  return {
    lens_code: option.code,
    lens_type: option.code + (low ? ' [0–2.75]' : ' [3+]'),
    sph,
    cyl,
    ax,
    price: low ? option.price_from : option.price_to,
  };
}

const receiptNames: Record<string, string> = {
  WHITE: 'Стандартная', AR: 'Антиблик', BB: 'Защита от экранов',
  CHAME: 'Хамелеон', CHAME_SCREEN: 'Хамелеон + защита от экранов',
  AST_AR: 'Антиблик при астигматизме', AST_BB: 'Защита от экранов при астигматизме',
  AST_CHAME: 'Хамелеон при астигматизме',
  ASPH_STANDARD: 'Асферическая стандартная', ASPH_AR: 'Асферическая антиблик',
  ASPH_BB: 'Асферическая защита от экранов', AR_167: 'Утончённая 1,67 · антиблик',
  AST_AR_167: 'Утончённая 1,67 · антиблик при астигматизме',
  AR_174: 'Утончённая 1,74 · антиблик', AST_AR_174: 'Утончённая 1,74 · антиблик при астигматизме',
  PC_159_HMC: 'Поликарбонат', MYOPIA_CONTROL: 'Контроль миопии',
};

export function formatLensDescription(value: string) {
  const [code] = value.split(/\s+/, 1);
  const suffix = code.split('_').at(-1) ?? '';
  const color = colorNames[suffix];
  const base = color ? code.slice(0, -suffix.length - 1) : code;
  const label = receiptNames[base];
  return label ? label + (color ? ' · ' + color : '') + value.slice(code.length) : value;
}
