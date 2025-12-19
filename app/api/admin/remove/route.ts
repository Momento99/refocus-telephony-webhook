import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body?.userId;
    const branchId: number | undefined = body?.branchId;

    if (!userId || !branchId) {
      return NextResponse.json(
        { ok: false, error: 'userId и branchId обязательны', received: body },
        { status: 400 }
      );
    }

    // Сколько владельцев у филиала
    const { count: ownersCount, error: cntErr } = await supabaseAdmin
      .from('user_branch_roles')
      .select('*', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .eq('role', 'owner');

    if (cntErr) {
      return NextResponse.json({ ok: false, error: cntErr.message }, { status: 400 });
    }

    // Является ли удаляемый пользователь владельцем
    const { data: isOwnerRow, error: isOwnerErr } = await supabaseAdmin
      .from('user_branch_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('branch_id', branchId)
      .eq('role', 'owner')
      .maybeSingle();

    if (isOwnerErr) {
      return NextResponse.json({ ok: false, error: isOwnerErr.message }, { status: 400 });
    }

    if ((ownersCount ?? 0) === 1 && isOwnerRow) {
      return NextResponse.json(
        { ok: false, error: 'Нельзя удалить единственного владельца филиала' },
        { status: 400 }
      );
    }

    const { error: delErr } = await supabaseAdmin
      .from('user_branch_roles')
      .delete()
      .eq('user_id', userId)
      .eq('branch_id', branchId);

    if (delErr) {
      return NextResponse.json({ ok: false, error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('remove error:', e);
    return NextResponse.json({ ok: false, error: e?.message || 'Server error' }, { status: 500 });
  }
}
