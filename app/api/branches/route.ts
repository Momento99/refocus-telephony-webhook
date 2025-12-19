// app/api/branches/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const branches = await prisma.branch.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(branches);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name: string = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const created = await prisma.branch.create({ data: { name } });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      // unique constraint
      return NextResponse.json({ error: "Branch already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
