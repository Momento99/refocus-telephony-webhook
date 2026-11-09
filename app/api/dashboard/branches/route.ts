// app/api/dashboard/branches/route.ts
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { requireCrmPermission } from '@/lib/crmAccessServer';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const gate = await requireCrmPermission('statistics');
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const supabase = getSupabaseServerClient();
    // RLS пускает аутентифицированных читать branches
    const { data, error } = await supabase
      .from('branches')
      .select('id,name')
      .order('name', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data ?? []);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
