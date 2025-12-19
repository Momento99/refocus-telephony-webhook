// app/api/employees/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const employees = await prisma.employee.findMany({
    orderBy: { fullName: "asc" },
    include: { branch: true },
  });
  return NextResponse.json(employees);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      fullName,
      role,
      mbank,
      branchName,
      branchId,
      passportFront,
      passportBack,
    } = body || {};

    if (!fullName || !role || (!branchId && !branchName)) {
      return NextResponse.json({ error: "fullName, role, branch required" }, { status: 400 });
    }

    let bId = branchId as string | undefined;
    if (!bId && branchName) {
      const b = await prisma.branch.findFirst({ where: { name: String(branchName) } });
      if (!b) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
      bId = b.id;
    }

    const created = await prisma.employee.create({
      data: {
        fullName: String(fullName),
        role: String(role).toUpperCase(),
        mbank: mbank ? String(mbank) : null,
        passportFront: passportFront ?? null,
        passportBack: passportBack ?? null,
        branchId: bId!,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
