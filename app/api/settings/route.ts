import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;

const STORAGE_BUCKET = "rate-history";
const FILE_PATH = "settings.json";

const settingsUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${FILE_PATH}`;

export async function GET() {
  try {
    console.log(`[settings] Fetching: ${settingsUrl}`);
    const res = await fetch(settingsUrl);
    if (!res.ok) {
      console.error(`[settings] Fetch failed: ${res.status} ${res.statusText}`);
      return NextResponse.json({ error: 'Failed to fetch settings.json' }, { status: 500 });
    }
    const json = await res.json();
    console.log(`[settings] Success:`, json);
    return NextResponse.json(json, { status: 200 });
  } catch (e: any) {
    console.error(`[settings] Exception:`, e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
