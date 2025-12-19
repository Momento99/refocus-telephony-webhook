import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name: string = (body?.name || "").toString().trim();

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const supa = getSupabaseAdmin();

  // у тебя city NOT NULL — подстрахуемся
  const insert = { name, city: name, is_workshop: false };

  const { data, error } = await supa.from("branches").insert(insert).select("id,name").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, name: data.name });
}
