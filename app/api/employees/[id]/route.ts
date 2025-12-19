// app/api/employees/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;

  try {
    const body = await req.json();

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        fullName: body.fullName ?? undefined,
        role: body.role ? String(body.role).toUpperCase() : undefined,
        mbank: body.mbank ?? undefined,
        passportFront: body.passportFront ?? undefined,
        passportBack: body.passportBack ?? undefined,
        branchId: body.branchId ?? undefined,
      },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Not found or invalid" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;

  try {
    await prisma.employee.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
