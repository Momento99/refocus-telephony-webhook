import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const POS_DIR = 'C:\\refocusTerminal\\refocus-pos';
const PKG_PATH = path.join(POS_DIR, 'package.json');
const DIST_DIR = path.join(POS_DIR, 'dist_installer');
const STATUS_FILE = path.join(POS_DIR, '.build-status.json');

type BuildStatus = {
  state: 'idle' | 'building' | 'done' | 'error';
  version: string;
  log: string;
  exePath: string | null;
  exeSize: number | null;
  startedAt: string | null;
  finishedAt: string | null;
};

function readStatus(): BuildStatus {
  try {
    if (fs.existsSync(STATUS_FILE)) return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
  } catch {}
  return { state: 'idle', version: '', log: '', exePath: null, exeSize: null, startedAt: null, finishedAt: null };
}

const MAX_INSTALLERS = 3;

function cleanOldInstallers() {
  if (!fs.existsSync(DIST_DIR)) return;
  const exes = fs.readdirSync(DIST_DIR)
    .filter(f => f.endsWith('.exe') && !f.includes('blockmap'))
    .map(f => ({ name: f, time: fs.statSync(path.join(DIST_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  // Удаляем всё кроме последних N
  for (const old of exes.slice(MAX_INSTALLERS)) {
    try {
      fs.unlinkSync(path.join(DIST_DIR, old.name));
      // Удаляем blockmap если есть
      const bm = path.join(DIST_DIR, old.name + '.blockmap');
      if (fs.existsSync(bm)) fs.unlinkSync(bm);
    } catch {}
  }
}

function writeStatus(s: Partial<BuildStatus>) {
  const current = readStatus();
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...current, ...s }, null, 2));
}

function getCurrentVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  return pkg.version;
}

function bumpVersion(type: 'patch' | 'minor' | 'major'): string {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  const newVersion = type === 'major' ? `${major + 1}.0.0`
    : type === 'minor' ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
  pkg.version = newVersion;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  return newVersion;
}

function findExe(version: string): { path: string; size: number } | null {
  if (!fs.existsSync(DIST_DIR)) return null;
  const files = fs.readdirSync(DIST_DIR);
  // Ищем .exe с нужной версией или просто последний .exe
  const exact = files.find(f => f.includes(version) && f.endsWith('.exe'));
  const any = files.filter(f => f.endsWith('.exe') && !f.includes('blockmap')).sort().pop();
  const found = exact ?? any;
  if (!found) return null;
  const fullPath = path.join(DIST_DIR, found);
  const stat = fs.statSync(fullPath);
  return { path: fullPath, size: stat.size };
}

/** GET — текущий статус сборки */
export async function GET() {
  const status = readStatus();
  const currentVersion = getCurrentVersion();

  // Проверяем есть ли готовый .exe
  const exe = findExe(currentVersion);

  return NextResponse.json({
    ...status,
    currentVersion,
    exeReady: !!exe,
    exePath: exe?.path ?? status.exePath,
    exeSize: exe?.size ?? status.exeSize,
    exeName: exe ? path.basename(exe.path) : null,
  });
}

/** POST — запустить сборку */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bumpType = body.bump ?? 'patch';

  const status = readStatus();
  if (status.state === 'building') {
    return NextResponse.json({ error: 'Сборка уже идёт' }, { status: 409 });
  }

  // 1) Запоминаем старую версию (для отката при ошибке)
  const oldVersion = getCurrentVersion();

  // 2) Bump version
  const newVersion = bumpVersion(bumpType);

  // 3) Start build
  writeStatus({
    state: 'building',
    version: newVersion,
    log: `Сборка v${newVersion} начата...\n`,
    exePath: null,
    exeSize: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  // Очищаем кэш .next, ставим NODE_ENV=production, собираем
  // ВАЖНО: после next build нужно скопировать static и public в standalone,
  // иначе CSS не будет работать в Electron.
  const cmd = `cd /d "${POS_DIR}" && rmdir /s /q .next 2>nul & set NODE_ENV=production && npx next build && node scripts/copy-static.js && npm run build:electron && npx electron-builder --win nsis`;

  const proc = exec(cmd, { maxBuffer: 10 * 1024 * 1024 });

  proc.stdout?.on('data', (data: string) => {
    const s = readStatus();
    writeStatus({ log: s.log + data });
  });

  proc.stderr?.on('data', (data: string) => {
    const s = readStatus();
    writeStatus({ log: s.log + data });
  });

  proc.on('close', (code) => {
    const exe = findExe(newVersion);
    if (code === 0 && exe) {
      cleanOldInstallers();
      writeStatus({
        state: 'done',
        log: readStatus().log + `\nСборка завершена: ${path.basename(exe.path)} (${(exe.size / 1024 / 1024).toFixed(1)} MB)\n`,
        exePath: exe.path,
        exeSize: exe.size,
        finishedAt: new Date().toISOString(),
      });
    } else {
      // Откатываем версию при ошибке
      try {
        const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
        pkg.version = oldVersion;
        fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
      } catch {}

      writeStatus({
        state: 'error',
        version: oldVersion,
        log: readStatus().log + `\nСборка завершилась с ошибкой (код: ${code}). Версия возвращена к ${oldVersion}.\n`,
        finishedAt: new Date().toISOString(),
      });
    }
  });

  return NextResponse.json({ ok: true, version: newVersion });
}
