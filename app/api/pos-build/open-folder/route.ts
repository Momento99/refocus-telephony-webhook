import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';

/** POST — открыть папку в проводнике Windows */
export async function POST(req: NextRequest) {
  const { path: dir } = await req.json();
  if (!dir) return NextResponse.json({ error: 'path required' }, { status: 400 });

  try {
    exec(`explorer "${dir}"`);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
