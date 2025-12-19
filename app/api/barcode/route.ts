import { NextRequest } from 'next/server';
import bwipjs from 'bwip-js';

// GET /api/barcode?data=RF2500012345&scale=2&height=10
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const data = searchParams.get('data') || '';
    // scale: толщина линии в пикселях (2–3 оптимально для 203 dpi)
    const scale = Math.max(1, Math.min(4, Number(searchParams.get('scale') || 2)));
    // height: высота бар-кодов в мм (в пикселях для bwip-js указывается в "X-height" условных единицах)
    const height = Math.max(8, Math.min(30, Number(searchParams.get('height') || 12)));

    if (!data) {
      return new Response('Missing data', { status: 400 });
    }

    // Генерируем Code 128 (auto)
    const png = await bwipjs.toBuffer({
      bcid: 'code128',      // тип штрихкода
      text: data,           // данные
      scale,                // толщина баров
      height,               // высота в "ячейках", 10–15 обычно хорошо для маленькой этикетки
      includetext: false,   // без подписи под штрихкодом
      textxalign: 'center',
      backgroundcolor: 'FFFFFF',
      paddingwidth: 2,      // небольшой внутренний отступ
      paddingheight: 2,
      monochrome: true,
    });

    return new Response(png, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=600',
      },
    });
  } catch (e: any) {
    return new Response('Barcode error: ' + (e?.message || String(e)), { status: 500 });
  }
}
