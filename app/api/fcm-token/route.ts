import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function POST(req: Request) {
  try {
    const { token, platform, userId } = await req.json();

    if (!token || !platform) {
      return NextResponse.json({ error: 'token, platform 필수' }, { status: 400 });
    }

    // 토큰 중복 방지: token 기준 upsert
    const { error } = await supabase
      .from('fcm_tokens')
      .upsert(
        [{
          token,
          platform,
          user_id: userId ?? null,
          updated_at: new Date().toISOString()
        }],
        { onConflict: 'token' }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}