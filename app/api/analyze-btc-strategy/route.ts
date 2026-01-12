import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const BTC_STRATEGY_PATH = "analyze-btc-strategy.json";

const btcStrategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${BTC_STRATEGY_PATH}`;

// Next.js API Route Handler
export async function GET(request: Request) {
  try {
    console.log('[analyze-btc-strategy] Supabase에서 BTC 전략 데이터 조회');

    // Supabase에서 기존 전략 데이터만 가져오기
    const fileRes = await fetch(btcStrategyUrl, {
      headers: { apikey: SUPABASE_KEY }
    });
    
    let strategyList: any[] = [];
    if (fileRes.ok) {
      const text = await fileRes.text();
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          strategyList = parsed;
        } else if (parsed) {
          strategyList = [parsed];
        }
      } catch {
        strategyList = [];
      }
    } else if (fileRes.status === 404 || fileRes.status === 400) {
      // 파일이 없으면 빈 배열 반환 (에러 아님)
      console.log('[analyze-btc-strategy] 전략 파일 없음 (404/400), 빈 배열 반환');
      try {
        const errorBody = await fileRes.json();
        if (errorBody.error === 'not_found' || errorBody.message?.includes('not found')) {
          console.log('[analyze-btc-strategy] 파일 없음 확인, 빈 배열 반환');
          return new Response(
            JSON.stringify([], null, 2),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
      } catch (_) {
        // JSON 파싱 실패 시 계속 진행
      }
      // 404/400이지만 not_found가 아닌 경우 빈 배열 반환
      return new Response(
        JSON.stringify([], null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('[analyze-btc-strategy] BTC 전략 데이터 반환:', strategyList.length, '개 전략');
    return new Response(
      JSON.stringify(strategyList, null, 2),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    console.error('[analyze-btc-strategy] 에러:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

