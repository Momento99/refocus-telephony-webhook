// app/api/dev/admin-ping/route.ts
export const runtime = 'nodejs'; // чтобы точно был Node, не Edge

import { NextResponse } from 'next/server';
// если алиас "@/..." вдруг не настроен в api-роутах — см. Примечание ниже
import supabaseAdmin from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, count: data?.users?.length ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'unknown' }, { status: 500 });
  }
}
