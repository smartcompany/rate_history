import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const STRATEGE_PATH = "analyze-strategy.json";
const GIMCH_PREMIUM_TREND_PATH = "kimchi-premium-trend.json";

const strategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${STRATEGE_PATH}`;
const gimchPremiumTrendUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${GIMCH_PREMIUM_TREND_PATH}`;

// Next.js API Route Handler
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeKimchiTrends = searchParams.get('includeKimchiTrends') === 'true';
    
    console.log('[analyze-strategy] Supabase에서 전략 데이터 조회', { includeKimchiTrends });

    // Supabase에서 기존 전략 데이터만 가져오기
    const fileRes = await fetch(strategyUrl, {
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
    }

    // 김치 프리미엄 트렌드 데이터 가져오기 (선택적)
    let kimchiTrends = null;
    if (includeKimchiTrends) {
      try {
        const trendRes = await fetch(gimchPremiumTrendUrl, {
          headers: { apikey: SUPABASE_KEY }
        });
        
        if (trendRes.ok) {
          kimchiTrends = await trendRes.json();
          console.log('[analyze-strategy] 김치 프리미엄 트렌드 데이터 로드:', Object.keys(kimchiTrends).length, '일');
        } else {
          console.warn('[analyze-strategy] 김치 프리미엄 트렌드 데이터 없음');
        }
      } catch (trendError) {
        console.warn('[analyze-strategy] 김치 프리미엄 트렌드 로드 실패:', trendError);
      }
    }

    // 하위 호환성: includeKimchiTrends=true일 때만 kimchiTrends 포함
    if (includeKimchiTrends && kimchiTrends) {
      const response = {
        strategies: strategyList,
        kimchiTrends: kimchiTrends
      };
      
      console.log('[analyze-strategy] 전략 + 김치 트렌드 데이터 반환:', strategyList.length, '개 전략,', Object.keys(kimchiTrends).length, '일 트렌드');
      return new Response(
        JSON.stringify(response, null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      // 기존 방식: strategyList만 반환 (완전한 하위 호환성)
      console.log('[analyze-strategy] 전략 데이터 반환:', strategyList.length, '개 전략');
      return new Response(
        JSON.stringify(strategyList, null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (err: any) {
    console.error('[analyze-strategy] 에러:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}