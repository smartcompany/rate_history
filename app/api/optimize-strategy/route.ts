import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const USDT_PATH = "usdt-history.json";
const GIMCHI_PATH = "kimchi-premium.json";
const USD_RATE_PATH = "rate-history.json";

const usdtHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USDT_PATH}`;
const gimchHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${GIMCHI_PATH}`;
const usdRateHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USD_RATE_PATH}`;

// 데이터 가져오기 함수들
async function getUSDTPriceHistory(): Promise<Record<string, any>> {
  const response = await fetch(usdtHistoryUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error('Failed to fetch USDT history');
  return await response.json();
}

async function getRateHistory(days: number): Promise<Record<string, number>> {
  const response = await fetch(`https://rate-history.vercel.app/api/rate-history?days=${days}`);
  if (!response.ok) throw new Error('Failed to fetch rate history');
  return await response.json();
}

async function getKimchiPremiumHistory() {
  const response = await fetch(gimchHistoryUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error('Failed to fetch kimchi premium history');
  return await response.json();
}

// 백테스팅 함수
function backtestStrategy(
  usdtHistory: Record<string, any>,
  rateHistory: Record<string, number>,
  params: {
    buyTrendCoefficient: number;
    sellTrendCoefficient: number;
    macdWeight: number;
    rsiWeight: number;
    bbWeight: number;
    maWeight: number;
    adjustmentFactor: number;
  }
): { totalReturn: number; trades: number; winRate: number; maxDrawdown: number } {
  const commonDates = Object.keys(rateHistory)
    .filter(d => usdtHistory[d] !== undefined)
    .sort();

  let balance = 10000; // 초기 자본 10,000원
  let position = 0; // 보유 수량
  let trades = 0;
  let wins = 0;
  let maxBalance = balance;
  let maxDrawdown = 0;

  const values: (number | null)[] = [];
  const windowSize = 5;

  for (let i = 0; i < commonDates.length; i++) {
    const dateKey = commonDates[i];
    const rate = rateHistory[dateKey];
    const usdtData = usdtHistory[dateKey];
    const usdt = usdtData?.close ?? usdtData?.price ?? usdtData;
    const val = (rate > 0 && usdt > 0) ? ((usdt - rate) / rate) * 100 : null;
    values.push(val);

    if (i < windowSize) continue;

    // 김치 프리미엄 계산
    const recentValues = values.slice(-windowSize).filter(v => v !== null) as number[];
    if (recentValues.length < windowSize) continue;

    const kimchiMA5 = recentValues.reduce((sum, v) => sum + v, 0) / windowSize;
    const kimchiTrend = i >= windowSize * 2 ? 
      kimchiMA5 - (values.slice(-windowSize * 2, -windowSize).filter(v => v !== null) as number[])
        .reduce((sum, v) => sum + v, 0) / windowSize : 0;

    // 임계값 계산
    const baseBuyThreshold = 0.5;
    const baseSellThreshold = 2.5;

    let buyThreshold = baseBuyThreshold - kimchiTrend * params.buyTrendCoefficient;
    let sellThreshold = baseSellThreshold + kimchiTrend * params.sellTrendCoefficient;

    // 기술적 분석 적용 (간소화)
    if (recentValues.length >= 10) {
      const rsi = calculateSimpleRSI(recentValues.slice(-10));
      const ma5 = recentValues.slice(-5).reduce((sum, v) => sum + v, 0) / 5;
      const ma10 = recentValues.slice(-10).reduce((sum, v) => sum + v, 0) / 10;

      const rsiSignal = rsi < 30 ? 1 : rsi > 70 ? -1 : 0;
      const maSignal = ma5 > ma10 ? 1 : -1;

      const totalSignal = (rsiSignal * params.rsiWeight + maSignal * params.maWeight) / 2;
      const adjustment = totalSignal * params.adjustmentFactor;

      buyThreshold -= adjustment;
      sellThreshold += adjustment;
    }

    const currentPremium = val || 0;

    // 매매 로직
    if (position === 0 && currentPremium <= buyThreshold) {
      // 매수
      position = balance / usdt;
      balance = 0;
      trades++;
    } else if (position > 0 && currentPremium >= sellThreshold) {
      // 매도
      const sellValue = position * usdt;
      const profit = sellValue - (10000 - balance);
      if (profit > 0) wins++;
      
      balance = sellValue;
      position = 0;
      trades++;
    }

    // 최대 낙폭 계산
    const currentValue = balance + (position * usdt);
    if (currentValue > maxBalance) {
      maxBalance = currentValue;
    }
    const drawdown = (maxBalance - currentValue) / maxBalance;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const finalValue = balance + (position * (usdtHistory[commonDates[commonDates.length - 1]]?.close ?? 0));
  const totalReturn = (finalValue - 10000) / 10000 * 100;
  const winRate = trades > 0 ? (wins / trades) * 100 : 0;

  return {
    totalReturn,
    trades,
    winRate,
    maxDrawdown: maxDrawdown * 100
  };
}

// 간단한 RSI 계산
function calculateSimpleRSI(values: number[]): number {
  if (values.length < 2) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / (values.length - 1);
  const avgLoss = losses / (values.length - 1);
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// 파라미터 최적화 함수
function optimizeParameters(
  usdtHistory: Record<string, any>,
  rateHistory: Record<string, number>
): { bestParams: any; bestResult: any; allResults: any[] } {
  const paramRanges = {
    buyTrendCoefficient: [0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0],
    sellTrendCoefficient: [0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0],
    macdWeight: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
    rsiWeight: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
    bbWeight: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
    maWeight: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
    adjustmentFactor: [0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3]
  };

  let bestResult = { totalReturn: -Infinity, trades: 0, winRate: 0, maxDrawdown: 100 };
  let bestParams = {};
  const allResults: any[] = [];

  // 그리드 서치 (더 많은 조합 테스트)
  const combinations = generateCombinations(paramRanges, 500); // 최대 500개 조합

  for (const params of combinations) {
    try {
      const result = backtestStrategy(usdtHistory, rateHistory, params);
      allResults.push({ params, result });

      // 수익률과 거래 횟수를 고려한 점수 계산
      const score = result.totalReturn - (result.maxDrawdown * 0.5) + (result.trades * 0.1);
      
      if (score > (bestResult.totalReturn - (bestResult.maxDrawdown * 0.5) + (bestResult.trades * 0.1))) {
        bestResult = result;
        bestParams = params;
      }
    } catch (error) {
      console.error('백테스팅 에러:', error);
    }
  }

  return { bestParams, bestResult, allResults };
}

// 조합 생성 함수
function generateCombinations(paramRanges: any, maxCombinations: number): any[] {
  const keys = Object.keys(paramRanges);
  const combinations: any[] = [];
  
  function generate(index: number, current: any) {
    if (combinations.length >= maxCombinations) return;
    if (index === keys.length) {
      combinations.push({ ...current });
      return;
    }
    
    const key = keys[index];
    const values = paramRanges[key];
    
    for (const value of values) {
      current[key] = value;
      generate(index + 1, current);
      if (combinations.length >= maxCombinations) break;
    }
  }
  
  generate(0, {});
  return combinations;
}

export async function GET() {
  try {
    console.log('[optimize-strategy] 전략 최적화 시작');

    // 데이터 가져오기 (모든 데이터 사용)
    const [usdtHistory, rateHistory, kimchiHistory] = await Promise.all([
      getUSDTPriceHistory(),
      getRateHistory(1000), // 모든 데이터 사용 (충분히 큰 값)
      getKimchiPremiumHistory()
    ]);

    console.log('[optimize-strategy] 데이터 로드 완료:', {
      usdt: Object.keys(usdtHistory).length,
      rate: Object.keys(rateHistory).length,
      kimchi: Object.keys(kimchiHistory).length
    });

    // 최적화 실행
    const { bestParams, bestResult, allResults } = optimizeParameters(usdtHistory, rateHistory);

    console.log('[optimize-strategy] 최적화 완료:', {
      bestParams,
      bestResult,
      totalCombinations: allResults.length
    });

    // 결과 정렬 (수익률 기준)
    allResults.sort((a, b) => b.result.totalReturn - a.result.totalReturn);

    return NextResponse.json({
      success: true,
      bestParams,
      bestResult,
      topResults: allResults.slice(0, 10), // 상위 10개 결과
      totalCombinations: allResults.length,
      message: '전략 최적화가 완료되었습니다.'
    });

  } catch (error: any) {
    console.error('[optimize-strategy] 에러:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
