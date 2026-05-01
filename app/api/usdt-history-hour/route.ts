import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = 'rate-history';
const FILE_PATH = 'upbit_usdt_hour.json';

const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${FILE_PATH}`;

/**
 * 업비트 KRW-USDT 시간봉 스냅샷(upbit_usdt_hour.json)을 Supabase에서 읽어 그대로 반환합니다.
 * 일별 /api/usdt-history 와 같은 버킷·환경변수 패턴입니다.
 */
export async function GET() {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.json({ error: 'Server configuration missing' }, { status: 500 });
    }

    const response = await fetch(storageUrl, {
      headers: { apikey: SUPABASE_KEY },
    });

    if (response.status === 404) {
      return NextResponse.json({ error: 'Hourly USDT snapshot not found' }, { status: 404 });
    }

    if (!response.ok) {
      const text = await response.text();
      console.error('[usdt-history-hour]', response.status, text);
      return NextResponse.json(
        { error: 'Failed to fetch hourly USDT history' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
