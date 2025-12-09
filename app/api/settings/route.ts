import { NextResponse } from 'next/server';
import settings from './settings.json' assert { type: 'json' };

export async function GET() {
  try {
    console.log(`[settings] Loading from local file`);
    console.log(`[settings] Success:`, settings);
    return NextResponse.json(settings, { status: 200 });
  } catch (e: any) {
    console.error(`[settings] Exception:`, e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
