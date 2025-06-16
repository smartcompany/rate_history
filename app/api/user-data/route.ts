import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log('user-data POST input:', body); // 입력 데이터 로그

    const { userId, userData } = body;

    if (!userId || !userData) {
      return NextResponse.json({ error: 'userId, userData 필수' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('fcm_tokens')
      .upsert(
        { 
          user_id: userId,
          user_data: userData,
          updated_at: new Date().toISOString() 
        },
        { onConflict: 'user_id' } // 이 부분 추가!
      )
      .select();

    console.log('update result:', data, error);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    if (!data || data.length === 0) {
      return NextResponse.json({ error: '해당 user_id row 없음' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}