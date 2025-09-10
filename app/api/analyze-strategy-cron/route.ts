import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const STRATEGE_PATH = "analyze-strategy.json";
const STRATEGE_UPLOAD_PATH = "analyze-strategy.json";
const USDT_PATH = "usdt-history.json";
const GIMCHI_PATH = "kimchi-premium.json";
const USD_RATE_PATH = "rate-history.json";
const PROMPT_PATH = "analysis-prompt.txt";
const GIMCH_PREMIUM_TREND_PATH = "kimchi-premium-trend.json";

const usdtHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USDT_PATH}`;
const gimchHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${GIMCHI_PATH}`;
const usdRateHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USD_RATE_PATH}`;
const strategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${STRATEGE_PATH}`;
const strategyUploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${STRATEGE_UPLOAD_PATH}`;
const promptUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${PROMPT_PATH}`;
const gimchPremiumTrendUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${GIMCH_PREMIUM_TREND_PATH}`;
const gimchPremiumTrendUploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${GIMCH_PREMIUM_TREND_PATH}`;

// Supabase에서 USDT 히스토리 가져오기
async function getUSDTPriceHistory() {
  const response = await fetch(usdtHistoryUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (response.status === 404) return {}; // 파일 없으면 빈 객체 반환
  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  return await response.json();
}

async function getRateHistory() {
  console.log('[getRateHistory] URL:', usdRateHistoryUrl);
  const response = await fetch(usdRateHistoryUrl, {
    headers: { apikey: SUPABASE_KEY }
  });

  console.log('[getRateHistory] Response status:', response.status);
  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  
  const data = await response.json();
  console.log('[getRateHistory] Data keys count:', Object.keys(data).length);
  return data;
}

async function getKimchiPremiumHistory() {
  const response = await fetch(gimchHistoryUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (response.status === 404) return {}; // 파일 없으면 빈 객체 반환
  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  return await response.json();
}

async function getPromptTemplate() {
  const response = await fetch(promptUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (!response.ok) throw new Error('Failed to fetch prompt template');
  return await response.text();
}

// OpenAI API 호출 함수
async function requestStrategyFromChatGPT(usdtHistory: any, rateHistory: any, kimchiPremiumHistory: any) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
  const apiUrl = "https://api.openai.com/v1/chat/completions";

  const promptTemplate = await getPromptTemplate();
  const prompt = promptTemplate
    .replace('{{usdtHistory}}', JSON.stringify(usdtHistory))
    .replace('{{rateHistory}}', JSON.stringify(rateHistory))
    .replace('{{kimchiPremiumHistory}}', JSON.stringify(kimchiPremiumHistory));

  // 프롬프트 로깅
  console.log('[analyze-strategy-cron] ChatGPT 프롬프트:', prompt);

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "당신은 투자 전략 분석 전문가입니다." },
      { role: "user", content: prompt }
    ],
    max_completion_tokens: 1000
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI API error:', errorText);
    throw new Error('Failed to get strategy from ChatGPT: ' + errorText);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "분석 결과를 가져오지 못했습니다.";
}

// 날짜 비교 함수 (문자열 비교로 시간대 문제 해결)
function isTodayOrFuture(dateStr: string) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
  return dateStr >= todayStr;
}

// strategyList에서 analysis_date가 같은 항목은 마지막 것만 남기기
function dedupLatestStrategyByDate(strategyList: any[]) {
  const seen = new Set<string>();
  const result: any[] = [];
  // 앞에서부터 순회 (최신이 맨 앞)
  for (const s of strategyList) {
    if (!s.analysis_date) continue;
    if (!seen.has(s.analysis_date)) {
      seen.add(s.analysis_date);
      result.push(s); // 뒤에 추가해서 최신이 남음
    }
  }
  return result;
}

// 김치 프리미엄 트렌드 계산 함수 (monitoring API와 동일)
function generatePremiumTrends(rateHistory: any, usdtHistory: any): Record<string, any> {
  const trends: Record<string, any> = {};
  const baseBuyThreshold = 0.5;
  const baseSellThreshold = 2.5;
  
  console.log('[generatePremiumTrends] rateHistory keys:', Object.keys(rateHistory).length);
  console.log('[generatePremiumTrends] usdtHistory keys:', Object.keys(usdtHistory).length);
  
  // 환율 데이터를 날짜별로 정렬
  const sortedRates = Object.entries(rateHistory)
    .map(([date, rate]) => ({ date: new Date(date), rate: Number(rate) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // USDT 데이터를 날짜별로 정렬
  const sortedUsdt = Object.entries(usdtHistory)
    .map(([date, data]) => ({ 
      date: new Date(date), 
      price: Number((data as any).price || data) 
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  
  console.log('[generatePremiumTrends] sortedRates length:', sortedRates.length);
  console.log('[generatePremiumTrends] sortedUsdt length:', sortedUsdt.length);
  
  // 5일 이동평균 윈도우
  const windowSize = 5;
  
  console.log('[generatePremiumTrends] Starting loop, sortedRates.length:', sortedRates.length, 'windowSize:', windowSize);
  
  // USDT 데이터가 있는 마지막 날짜까지만 계산
  const maxUsdtDate = sortedUsdt[sortedUsdt.length - 1]?.date;
  const maxUsdtIndex = sortedRates.findIndex(rate => rate.date > maxUsdtDate);
  const endIndex = maxUsdtIndex > 0 ? maxUsdtIndex : sortedRates.length;
  
  console.log('[generatePremiumTrends] USDT 데이터 마지막 날짜:', maxUsdtDate?.toISOString().split('T')[0]);
  console.log('[generatePremiumTrends] 계산할 마지막 인덱스:', endIndex);
  
  for (let i = windowSize - 1; i < endIndex; i++) {
    const currentDate = sortedRates[i].date;
    const dateKey = currentDate.toISOString().split('T')[0];
    
    // 5일 윈도우의 환율과 USDT 데이터 수집
    const rateWindow = sortedRates.slice(i - windowSize + 1, i + 1);
    const usdtWindow = sortedUsdt.slice(i - windowSize + 1, i + 1);
    
    if (rateWindow.length < windowSize || usdtWindow.length < windowSize) {
      console.log('[generatePremiumTrends] Skipping', dateKey, 'insufficient data:', rateWindow.length, usdtWindow.length);
      continue;
    }
    
    // 김치 프리미엄 계산 (5일 평균)
    let kimchiSum = 0;
    let validDays = 0;
    
    for (let j = 0; j < windowSize; j++) {
      const rate = rateWindow[j].rate;
      const usdtPrice = usdtWindow[j].price;
      
      if (rate > 0 && usdtPrice > 0) {
        const kimchiPremium = ((usdtPrice - rate) / rate) * 100;
        kimchiSum += kimchiPremium;
        validDays++;
      }
    }
    
    if (validDays === 0) continue;
    
    const kimchiMA5 = kimchiSum / validDays;
    
    // 트렌드 계산 (이전 5일 대비 현재 5일)
    let kimchiTrend = 0;
    if (i >= windowSize * 2 - 1) {
      const prevWindow = sortedRates.slice(i - windowSize * 2 + 1, i - windowSize + 1);
      const prevUsdtWindow = sortedUsdt.slice(i - windowSize * 2 + 1, i - windowSize + 1);
      
      let prevKimchiSum = 0;
      let prevValidDays = 0;
      
      for (let j = 0; j < windowSize; j++) {
        const rate = prevWindow[j].rate;
        const usdtPrice = prevUsdtWindow[j].price;
        
        if (rate > 0 && usdtPrice > 0) {
          const kimchiPremium = ((usdtPrice - rate) / rate) * 100;
          prevKimchiSum += kimchiPremium;
          prevValidDays++;
        }
      }
      
      if (prevValidDays > 0) {
        const prevKimchiMA5 = prevKimchiSum / prevValidDays;
        kimchiTrend = kimchiMA5 - prevKimchiMA5;
      }
    }
    
    // 조정된 임계값 계산
    const buyThreshold = calculateAdjustedThreshold(
      baseBuyThreshold,
      kimchiTrend,
      0, // exchangeRateTrend (사용하지 않음)
      0, // usdtTrend (사용하지 않음)
      true, // isBuyThreshold
      kimchiMA5
    );
    
    const sellThreshold = calculateAdjustedThreshold(
      baseSellThreshold,
      kimchiTrend,
      0, // exchangeRateTrend (사용하지 않음)
      0, // usdtTrend (사용하지 않음)
      false, // isBuyThreshold
      kimchiMA5
    );
    
    trends[dateKey] = {
      buy_threshold: buyThreshold,
      sell_threshold: sellThreshold,
      kimchi_trend: kimchiTrend,
      kimchi_ma5: kimchiMA5
    };
  }
  
  return trends;
}

// 조정된 임계값 계산 함수
function calculateAdjustedThreshold(
  baseThreshold: number,
  kimchiTrend: number,
  exchangeRateTrend: number, // 사용하지 않음
  usdtTrend: number,         // 사용하지 않음
  isBuyThreshold: boolean,
  kimchiMA5: number
): number {
  let adjustedThreshold = baseThreshold;
  
  // 김치 프리미엄 트렌드와 5일 이동평균을 고려한 조정
  const buyTrendCoefficient = 0.3;
  const buyMa5Coefficient = 0.2;
  const sellTrendCoefficient = 0.5;
  const sellMa5Coefficient = 0.3;
  
  if (isBuyThreshold) {
    adjustedThreshold += kimchiTrend * buyTrendCoefficient;
    adjustedThreshold += kimchiMA5 * buyMa5Coefficient;
  } else {
    adjustedThreshold += kimchiTrend * sellTrendCoefficient;
    adjustedThreshold += kimchiMA5 * sellMa5Coefficient;
  }
  
  // 임계값 범위 제한 (20% ~ 500%)
  const minThreshold = baseThreshold * 0.2;
  const maxThreshold = baseThreshold * 5.0;
  
  return Math.max(minThreshold, Math.min(maxThreshold, adjustedThreshold));
}

// Next.js API Route Handler
export async function GET(request: Request) {
  try {
    console.log('[analyze-strategy-cron] Cron job started');

    // 1. 파일에서 기존 전략 읽기 (배열 형태)
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

    // 2. 오늘 날짜의 전략이 이미 있는지 확인
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    
    // 한국 시간대 고려 (UTC+9)
    const koreaToday = new Date(today.getTime() + (9 * 60 * 60 * 1000));
    const koreaTodayStr = koreaToday.toISOString().slice(0, 10);
    
    console.log(`[analyze-strategy-cron] UTC 오늘: ${todayStr}, 한국 오늘: ${koreaTodayStr}`);

    console.log('usdtHistory, rateHistory, kimchiPremiumHistory 가져오기 시작');
    const [usdtHistory, rateHistory, kimchiPremiumHistory] = await Promise.all([
      getUSDTPriceHistory(),
      getRateHistory(),
      getKimchiPremiumHistory(),
    ]);
 
    await setupKPremiumTrends(rateHistory, usdtHistory);
    
    const latest = strategyList[0];
    if (latest && latest.analysis_date) {
      console.log(`[analyze-strategy-cron] 최신 전략 날짜: ${latest.analysis_date}`);
      
      // 오늘 또는 내일 날짜가 이미 있으면 스킵
      if (latest.analysis_date === todayStr || latest.analysis_date === koreaTodayStr) {
        console.log(`[analyze-strategy-cron] 오늘(${koreaTodayStr}) 전략이 이미 존재함: ${latest.analysis_date}`);
        return NextResponse.json({ 
          message: '오늘 전략이 이미 존재합니다.', 
          latest_date: latest.analysis_date,
          today: koreaTodayStr
        }, { status: 200 });
      }
    }

    const strategy = await requestStrategyFromChatGPT(usdtHistory, rateHistory, kimchiPremiumHistory);
    let parsedStrategy: any;
    try {
      parsedStrategy = JSON.parse(strategy);
    } catch {
      parsedStrategy = { strategy };
    }

    // 4. 배열 맨 앞에 추가 (최신이 맨 앞)
    // analysis_date를 한국 오늘 날짜로 강제 보정
    if (parsedStrategy && parsedStrategy.analysis_date && parsedStrategy.analysis_date !== koreaTodayStr) {
      console.log(`[analyze-strategy-cron] analysis_date 보정: ${parsedStrategy.analysis_date} → ${koreaTodayStr}`);
      parsedStrategy.analysis_date = koreaTodayStr;
    }

    console.log('[analyze-strategy-cron] parsedStrategy:', parsedStrategy);
    strategyList.unshift(parsedStrategy);

    // 중복 제거: 동일 날짜는 마지막(최신) 것만 남김
    strategyList = dedupLatestStrategyByDate(strategyList);

    const body = JSON.stringify(strategyList, null, 2);

    // 5. Supabase에 저장 (배열 전체)
    await fetch(strategyUploadUrl, {
      method: "PUT",
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: body
    });

    console.log('[analyze-strategy-cron] 전략 업데이트 완료:', strategyList.length);

    return NextResponse.json({ 
      message: '전략이 성공적으로 업데이트되었습니다.', 
      new_strategy: parsedStrategy,
      total_strategies: strategyList.length
    }, { status: 200 });

  } catch (err: any) {
    console.error('[analyze-strategy-cron] 에러:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
async function setupKPremiumTrends(rateHistory: any, usdtHistory: any) {
  console.log('[analyze-strategy-cron] 김치 프리미엄 트렌드 계산 시작');
  try {
    const kimchiTrends = generatePremiumTrends(rateHistory, usdtHistory);

    // Supabase에 김치 프리미엄 트렌드 데이터 저장
    const trendBody = JSON.stringify(kimchiTrends, null, 2);
    await fetch(gimchPremiumTrendUploadUrl, {
      method: "PUT",
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: trendBody
    });

    console.log('[analyze-strategy-cron] 김치 프리미엄 트렌드 업데이트 완료:', Object.keys(kimchiTrends).length, '일');
  } catch (trendError) {
    console.error('[analyze-strategy-cron] 김치 프리미엄 트렌드 계산 실패:', trendError);
    // 트렌드 계산 실패해도 전략 업데이트는 성공으로 처리
  }
}

