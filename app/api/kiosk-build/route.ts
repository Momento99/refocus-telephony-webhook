import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const KIOSK_DIR = 'C:\\TouchScreenRefocus\\refocus-lens-kiosk';
const PKG_PATH = path.join(KIOSK_DIR, 'package.json');
const DIST_DIR = path.join(KIOSK_DIR, 'release');
const STATUS_FILE = path.join(KIOSK_DIR, '.build-status.json');

type BuildStatus = {
  state: 'idle' | 'building' | 'done' | 'error';
  version: string; log: string;
  exePath: string | null; exeSize: number | null;
  startedAt: string | null; finishedAt: string | null;
};

function readStatus(): BuildStatus {
  try { if (fs.existsSync(STATUS_FILE)) return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch {}
  return { state: 'idle', version: '', log: '', exePath: null, exeSize: null, startedAt: null, finishedAt: null };
}
const MAX_INSTALLERS = 3;
function cleanOldInstallers() {
  if (!fs.existsSync(DIST_DIR)) return;
  const exes = fs.readdirSync(DIST_DIR)
    .filter(f => f.endsWith('.exe') && !f.includes('blockmap'))
    .map(f => ({ name: f, time: fs.statSync(path.join(DIST_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const old of exes.slice(MAX_INSTALLERS)) {
    try { fs.unlinkSync(path.join(DIST_DIR, old.name)); const bm = path.join(DIST_DIR, old.name + '.blockmap'); if (fs.existsSync(bm)) fs.unlinkSync(bm); } catch {}
  }
}
function writeStatus(s: Partial<BuildStatus>) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...readStatus(), ...s }, null, 2));
}
function getCurrentVersion(): string {
  return JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8')).version;
}
function bumpVersion(type: 'patch' | 'minor' | 'major'): string {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  const nv = type === 'major' ? `${maj+1}.0.0` : type === 'minor' ? `${maj}.${min+1}.0` : `${maj}.${min}.${pat+1}`;
  pkg.version = nv;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  return nv;
}
function findExe(version: string): { path: string; size: number } | null {
  if (!fs.existsSync(DIST_DIR)) return null;
  const files = fs.readdirSync(DIST_DIR);
  const found = files.find(f => f.includes(version) && f.endsWith('.exe')) ?? files.filter(f => f.endsWith('.exe') && !f.includes('blockmap')).sort().pop();
  if (!found) return null;
  const fp = path.join(DIST_DIR, found);
  return { path: fp, size: fs.statSync(fp).size };
}

export async function GET() {
  const status = readStatus();
  const currentVersion = getCurrentVersion();
  const exe = findExe(currentVersion);
  return NextResponse.json({ ...status, currentVersion, exeReady: !!exe, exePath: exe?.path, exeSize: exe?.size, exeName: exe ? path.basename(exe.path) : null });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bumpType = body.bump ?? 'patch';
  const status = readStatus();
  if (status.state === 'building') return NextResponse.json({ error: 'Сборка уже идёт' }, { status: 409 });

  const oldVersion = getCurrentVersion();
  const newVersion = bumpVersion(bumpType);
  writeStatus({ state: 'building', version: newVersion, log: `Сборка Kiosk v${newVersion}...\n`, exePath: null, exeSize: null, startedAt: new Date().toISOString(), finishedAt: null });

  const cmd = `cd /d "${KIOSK_DIR}" && set NODE_ENV=production && npm run build && npx electron-builder --win nsis`;
  const proc = exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
  proc.stdout?.on('data', (d) => writeStatus({ log: readStatus().log + d }));
  proc.stderr?.on('data', (d) => writeStatus({ log: readStatus().log + d }));
  proc.on('close', (code) => {
    const exe = findExe(newVersion);
    if (code === 0 && exe) {
      cleanOldInstallers();
      writeStatus({ state: 'done', exePath: exe.path, exeSize: exe.size, finishedAt: new Date().toISOString(),
        log: readStatus().log + `\nKiosk v${newVersion}: ${path.basename(exe.path)} (${(exe.size/1024/1024).toFixed(1)} MB)\n` });
    } else {
      try { const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8')); pkg.version = oldVersion; fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n'); } catch {}
      writeStatus({ state: 'error', version: oldVersion, finishedAt: new Date().toISOString(), log: readStatus().log + `\nОшибка (код: ${code}). Версия возвращена к ${oldVersion}.\n` });
    }
  });

  return NextResponse.json({ ok: true, version: newVersion });
}
