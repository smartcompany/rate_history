import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";

const STRATEGE_PATH = "analyze-strategy.json";
const strategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${STRATEGE_PATH}`;

export async function GET() {
  try {
    // 1. 업비트에서 USDT 가격 읽어오기
    const upbitRes = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT');
    if (!upbitRes.ok) {
      return NextResponse.json({ error: '업비트 USDT 가격 조회 실패' }, { status: 500 });
    }
    const upbitData = await upbitRes.json();
    const usdtPrice = upbitData[0]?.trade_price;
    if (!usdtPrice) {
      return NextResponse.json({ error: 'USDT 가격 데이터 없음' }, { status: 500 });
    }

    // 2. 전략 파일에서 최근 전략 정보 읽기
    const stratRes = await fetch(strategyUrl);
    if (!stratRes.ok) {
      return NextResponse.json({ error: '전략 파일 조회 실패' }, { status: 500 });
    }
    const stratList = await stratRes.json();

    // analysis_date 기준으로 가장 최근 전략 선택
    let latestStrategy = null;
    if (Array.isArray(stratList) && stratList.length > 0) {
      latestStrategy = stratList.reduce((latest, curr) => {
        // analysis_date가 ISO 형식(YYYY-MM-DD 등)이라고 가정
        return new Date(curr.analysis_date) > new Date(latest.analysis_date) ? curr : latest;
      }, stratList[0]);
    }

    // latestStrategy 전체 로깅 추가
    console.log('[monitoring] latestStrategy:', latestStrategy);

    if (!latestStrategy) {
      return NextResponse.json({ error: '최신 전략 데이터 없음' }, { status: 500 });
    }

    const buyPrice = Number(latestStrategy.buy_price);
    const sellPrice = Number(latestStrategy.sell_price);

    // 3. 매수/매도 판단
    let action = '대기';
    if (usdtPrice < buyPrice) {
      action = '매수';
    } else if (usdtPrice > sellPrice) {
      action = '매도';
    }

    return NextResponse.json({
      usdtPrice,
      buyPrice,
      sellPrice,
      action,
      latestStrategyDate: latestStrategy.analysis_date,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

