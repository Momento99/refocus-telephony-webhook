import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const POS_DIR = 'C:\\refocusTerminal\\refocus-pos';
const DIST_DIR = path.join(POS_DIR, 'dist_installer');
const REPO = 'Momento99/refocus-pos';

/** POST — создать GitHub Release и загрузить .exe.
 *  Body: { countryId: string } */
export async function POST(req: NextRequest) {
  const { countryId } = await req.json();
  if (!countryId) return NextResponse.json({ error: 'countryId required' }, { status: 400 });

  // Найти .exe и latest.yml
  if (!fs.existsSync(DIST_DIR)) return NextResponse.json({ error: 'dist_installer not found' }, { status: 404 });

  const files = fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.exe') && !f.includes('blockmap')).sort();
  const exeName = files.pop();
  if (!exeName) return NextResponse.json({ error: 'No .exe found' }, { status: 404 });

  const exePath = path.join(DIST_DIR, exeName);
  const ymlPath = path.join(DIST_DIR, 'latest.yml');

  // Извлечь версию
  const vMatch = exeName.match(/(\d+\.\d+\.\d+)/);
  const version = vMatch ? vMatch[1] : '0.0.0';
  const tag = `v${version}`;

  // Суффикс для страны (чтобы разные страны могли иметь разные версии)
  const releaseTag = countryId === 'kg' ? tag : `${tag}-${countryId}`;
  const releaseName = countryId === 'kg' ? `Refocus POS ${tag}` : `Refocus POS ${tag} (${countryId.toUpperCase()})`;

  try {
    // 1) Проверяем существует ли релиз
    let releaseExists = false;
    try {
      execSync(`gh release view ${releaseTag} --repo ${REPO}`, { cwd: POS_DIR, stdio: 'pipe' });
      releaseExists = true;
    } catch {}

    // 2) Создаём или обновляем релиз
    if (releaseExists) {
      // Удаляем старые файлы из релиза и загружаем новые
      try { execSync(`gh release delete-asset ${releaseTag} "${exeName}" --repo ${REPO} --yes`, { cwd: POS_DIR, stdio: 'pipe' }); } catch {}
      try { execSync(`gh release delete-asset ${releaseTag} latest.yml --repo ${REPO} --yes`, { cwd: POS_DIR, stdio: 'pipe' }); } catch {}
    } else {
      // KG-релиз помечаем как Latest — старые терминалы без country-URL
      // используют GitHub API "latest release" для поиска обновлений
      const latestFlag = countryId === 'kg' ? '' : '--latest=false';
      execSync(`gh release create ${releaseTag} --repo ${REPO} --title "${releaseName}" ${latestFlag} --notes "POS ${tag} for ${countryId.toUpperCase()}"`, { cwd: POS_DIR, stdio: 'pipe' });
    }

    // 3) Загружаем .exe
    execSync(`gh release upload ${releaseTag} "${exePath}" --repo ${REPO} --clobber`, { cwd: POS_DIR, stdio: 'pipe', timeout: 600000 });

    // 4) Загружаем latest.yml (если есть)
    if (fs.existsSync(ymlPath)) {
      execSync(`gh release upload ${releaseTag} "${ymlPath}" --repo ${REPO} --clobber`, { cwd: POS_DIR, stdio: 'pipe', timeout: 60000 });
    }

    // 5) URL для electron-updater: GitHub releases API
    const updateUrl = `https://github.com/${REPO}/releases/download/${releaseTag}`;

    return NextResponse.json({ ok: true, version, tag: releaseTag, exeName, updateUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'GitHub upload failed' }, { status: 500 });
  }
}
