import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const KIOSK_DIR = 'C:\\TouchScreenRefocus\\refocus-lens-kiosk';
const DIST_DIR = path.join(KIOSK_DIR, 'release');
const REPO = 'Momento99/refocus-pos'; // тот же репо, но теги kiosk-v*

export async function POST(req: NextRequest) {
  const { countryId } = await req.json();
  if (!countryId) return NextResponse.json({ error: 'countryId required' }, { status: 400 });

  if (!fs.existsSync(DIST_DIR)) return NextResponse.json({ error: 'release dir not found' }, { status: 404 });

  const ymlPath = path.join(DIST_DIR, 'latest.yml');

  // Версию берём из latest.yml (его пишет electron-builder для текущей сборки).
  // Имя .exe сортировать строкой НЕЛЬЗЯ: '2.1.9' окажется ПОЗЖЕ '2.1.10' (символ '9' > '1').
  const semverCmp = (a: string, b: string) => {
    const pa = (a.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? []).map(Number);
    const pb = (b.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? []).map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
  };

  let exeName: string | undefined;
  if (fs.existsSync(ymlPath)) {
    const yml = fs.readFileSync(ymlPath, 'utf8');
    const fromYml = yml.match(/^path:\s*(.+\.exe)\s*$/m)?.[1]?.trim();
    if (fromYml && fs.existsSync(path.join(DIST_DIR, fromYml))) exeName = fromYml;
  }
  if (!exeName) {
    const files = fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.exe') && !f.includes('blockmap'));
    files.sort(semverCmp);
    exeName = files.pop();
  }
  if (!exeName) return NextResponse.json({ error: 'No .exe' }, { status: 404 });

  const exePath = path.join(DIST_DIR, exeName);
  const vMatch = exeName.match(/(\d+\.\d+\.\d+)/);
  const version = vMatch ? vMatch[1] : '0.0.0';
  const releaseTag = countryId === 'kg' ? `kiosk-v${version}` : `kiosk-v${version}-${countryId}`;
  const releaseName = `Refocus Kiosk v${version}${countryId !== 'kg' ? ` (${countryId.toUpperCase()})` : ''}`;

  try {
    let exists = false;
    try { execSync(`gh release view ${releaseTag} --repo ${REPO}`, { cwd: KIOSK_DIR, stdio: 'pipe' }); exists = true; } catch {}

    if (exists) {
      try { execSync(`gh release delete-asset ${releaseTag} "${exeName}" --repo ${REPO} --yes`, { cwd: KIOSK_DIR, stdio: 'pipe' }); } catch {}
      try { execSync(`gh release delete-asset ${releaseTag} latest.yml --repo ${REPO} --yes`, { cwd: KIOSK_DIR, stdio: 'pipe' }); } catch {}
    } else {
      execSync(`gh release create ${releaseTag} --repo ${REPO} --title "${releaseName}" --latest=false --notes "Kiosk ${version} for ${countryId.toUpperCase()}"`, { cwd: KIOSK_DIR, stdio: 'pipe' });
    }

    execSync(`gh release upload ${releaseTag} "${exePath}" --repo ${REPO} --clobber`, { cwd: KIOSK_DIR, stdio: 'pipe', timeout: 600000 });
    if (fs.existsSync(ymlPath)) {
      execSync(`gh release upload ${releaseTag} "${ymlPath}" --repo ${REPO} --clobber`, { cwd: KIOSK_DIR, stdio: 'pipe', timeout: 60000 });
    }

    const updateUrl = `https://github.com/${REPO}/releases/download/${releaseTag}`;
    return NextResponse.json({ ok: true, version, tag: releaseTag, exeName, updateUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
