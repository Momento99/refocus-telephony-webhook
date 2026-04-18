import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const POS_DIR = 'C:\\refocusTerminal\\refocus-pos';
const DIST_DIR = path.join(POS_DIR, 'dist_installer');

/** GET — отдаёт последний .exe как поток для загрузки в Storage */
export async function GET() {
  if (!fs.existsSync(DIST_DIR)) {
    return NextResponse.json({ error: 'dist_installer не найден' }, { status: 404 });
  }

  const files = fs.readdirSync(DIST_DIR)
    .filter(f => f.endsWith('.exe') && !f.includes('blockmap'))
    .sort();

  const latest = files.pop();
  if (!latest) {
    return NextResponse.json({ error: '.exe не найден' }, { status: 404 });
  }

  const fullPath = path.join(DIST_DIR, latest);
  const stat = fs.statSync(fullPath);
  const stream = fs.readFileSync(fullPath);

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${latest}"`,
      'Content-Length': String(stat.size),
      'X-Filename': latest,
      'X-Filesize': String(stat.size),
    },
  });
}
