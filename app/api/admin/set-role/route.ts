import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body?.userId;
    const branchId: number | undefined = body?.branchId;
    const role: 'owner' | 'manager' | 'seller' | 'master' | undefined = body?.role;

    if (!userId || !branchId || !role) {
      return NextResponse.json(
        { ok: false, error: 'userId, branchId и role обязательны', received: body },
        { status: 400 }
      );
    }

    // Вызываем уже созданную тобой функцию set_user_role
    const { error } = await supabaseAdmin.rpc('set_user_role', {
      p_user_id: userId,
      p_branch_id: branchId,
      p_role: role,
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Server error' }, { status: 500 });
  }
}
