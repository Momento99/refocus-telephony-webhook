import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path');
    if (!path) return NextResponse.json({ ok: false, error: 'path required' }, { status: 400 });

    const { data, error } = await supabaseAdmin.storage
      .from('feedback-voice')
      .createSignedUrl(path, 600); // 10 минут

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, signed_url: data.signedUrl });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server error' }, { status: 500 });
  }
}
