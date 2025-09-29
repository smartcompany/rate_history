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
async function getUSDTPriceHistory(): Promise<Record<string, any>>  {
  const response = await fetch(usdtHistoryUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (response.status === 404) return {}; // 파일 없으면 빈 객체 반환
  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  return await response.json();
}

async function getRateHistory(days: number): Promise<Record<string, number>> {
  const daysParam = `days=${days}`;
  console.log('[getRateHistory] API URL: https://rate-history.vercel.app/api/rate-history?' + daysParam);
  const response = await fetch('https://rate-history.vercel.app/api/rate-history?' + daysParam);

  console.log('[getRateHistory] Response status:', response.status);
  if (!response.ok) throw new Error('Failed to fetch rate history from API');
  
  const parsed = await response.json() as Record<string, number>;

  console.log('[getRateHistory] Data keys count:', Object.keys(parsed).length);
  return parsed;
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
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: "당신은 투자 전략 분석 전문가입니다." },
      { role: "user", content: prompt }
    ],
    max_completion_tokens: 2000
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
  console.log('[requestStrategyFromChatGPT] GPT API 응답:', JSON.stringify(data, null, 2));
  
  const content = data.choices?.[0]?.message?.content ?? "분석 결과를 가져오지 못했습니다.";
  console.log('[requestStrategyFromChatGPT] 추출된 content:', content);
  
  return content;
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

// 김치 프리미엄 트렌드 계산 함수 (5일 윈도우 기반 최소/최대값 임계값)
function generatePremiumTrends(rateHistory: Record<string, number>, usdtHistory: Record<string, any>): Record<string, any> {
  const trends: Record<string, any> = {};

  console.log('[generatePremiumTrends] rateHistory keys:', Object.keys(rateHistory).length);
  console.log('[generatePremiumTrends] usdtHistory keys:', Object.keys(usdtHistory).length);

  // 공통 날짜 교집합을 오름차순 정렬
  const commonDates = Object.keys(rateHistory)
    .filter(d => usdtHistory[d] !== undefined)
    .sort();

  const windowSize = 5;
  console.log('[generatePremiumTrends] Starting loop, dates:', commonDates.length, 'windowSize:', windowSize);

  // 김치 프리미엄 값들 계산
  const kimchiValues: number[] = [];
  for (let i = 0; i < commonDates.length; i++) {
    const dateKey = commonDates[i];
    const rate = rateHistory[dateKey];
    const usdtData = usdtHistory[dateKey];
    const usdt = (usdtData as any)?.close ?? (usdtData as any)?.price ?? usdtData;
    const kimchiPremium = (rate > 0 && usdt > 0) ? ((usdt - rate) / rate) * 100 : 0;
    kimchiValues.push(kimchiPremium);
  }

  // 5일 윈도우로 슬라이딩하면서 최소/최대값 기반 임계값 계산
  for (let i = windowSize - 1; i < commonDates.length; i++) {
    const dateKey = commonDates[i];
    
    // 현재 5일 윈도우의 김치 프리미엄 값들
    const windowValues = kimchiValues.slice(i - windowSize + 1, i + 1);
    
    // 5일 중 최소값 = 매수 임계값, 최대값 = 매도 임계값
    const minValue = Math.min(...windowValues);
    const maxValue = Math.max(...windowValues);
    
    // 현재 김치 프리미엄 (오늘)
    const currentKimchi = kimchiValues[i];
    
    // 5일 평균 (트렌드 파악용)
    const avgValue = windowValues.reduce((sum, val) => sum + val, 0) / windowSize;
    
    // 트렌드 계산 (현재값 - 평균값)
    const trend = currentKimchi - avgValue;

    trends[dateKey] = {
      buy_threshold: Math.round(minValue * 10) / 10,    // 5일 중 최소값
      sell_threshold: Math.round(maxValue * 10) / 10,   // 5일 중 최대값
      kimchi_trend: Math.round(trend * 10) / 10,        // 현재값 - 평균값
      kimchi_ma5: Math.round(avgValue * 10) / 10,       // 5일 평균
      current_kimchi: Math.round(currentKimchi * 10) / 10 // 현재 김치 프리미엄
    };
  }

  console.log('[generatePremiumTrends] 생성된 트렌드 데이터:', Object.keys(trends).length, '일');
  return trends;
}


// Next.js API Route Handler
export async function GET(request: Request) {
  try {
    console.log('[analyze-strategy-cron] Cron job started');

    // URL에서 force 파라미터 확인
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === 'true';
    console.log(`[analyze-strategy-cron] Force mode: ${force}`);

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

    // 2. 오늘 날짜의 전략이 이미 있는지 확인 (force가 true가 아닐 때만)
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    
    // 한국 시간대 고려 (UTC+9)
    const koreaToday = new Date(today.getTime() + (9 * 60 * 60 * 1000));
    const koreaTodayStr = koreaToday.toISOString().slice(0, 10);
    
    console.log(`[analyze-strategy-cron] UTC 오늘: ${todayStr}, 한국 오늘: ${koreaTodayStr}`);

    console.log('usdtHistory, rateHistory, kimchiPremiumHistory 가져오기 시작');
    
    // 먼저 USDT 데이터를 가져와서 개수 확인
    const usdtHistory = await getUSDTPriceHistory();
    const usdtCount = Object.keys(usdtHistory).length;
    console.log('[analyze-strategy-cron] USDT 데이터 개수:', usdtCount);
    
    // USDT 개수만큼 환율 데이터 가져오기
    const [rateHistory, kimchiPremiumHistory] = await Promise.all([
      getRateHistory(usdtCount),
      getKimchiPremiumHistory(),
    ]);
 
    await setupKPremiumTrends(rateHistory, usdtHistory);
    
    // 주기적으로 최적화 실행 (매일 한 번)
    const shouldOptimize = Math.random() < 0.1; // 10% 확률로 최적화 실행
    if (shouldOptimize) {
      console.log('[analyze-strategy-cron] 전략 최적화 실행');
      try {
        const optimizeResponse = await fetch('http://localhost:3001/api/optimize-strategy');
        const optimizeResult = await optimizeResponse.json();
        if (optimizeResult.success) {
          console.log('[analyze-strategy-cron] 최적화 완료:', optimizeResult.bestResult);
        }
      } catch (error) {
        console.error('[analyze-strategy-cron] 최적화 실패:', error);
      }
    }
    
    const latest = strategyList[0];
    if (latest && latest.analysis_date) {
      console.log(`[analyze-strategy-cron] 최신 전략 날짜: ${latest.analysis_date}`);
      
      // force가 true가 아니고, 오늘 또는 내일 날짜가 이미 있으면 스킵
      if (!force && (latest.analysis_date === todayStr || latest.analysis_date === koreaTodayStr)) {
        console.log(`[analyze-strategy-cron] 오늘(${koreaTodayStr}) 전략이 이미 존재함: ${latest.analysis_date}`);
        return NextResponse.json({ 
          message: '오늘 전략이 이미 존재합니다.', 
          latest_date: latest.analysis_date,
          today: koreaTodayStr
        }, { status: 200 });
      }
      
      if (force) {
        console.log(`[analyze-strategy-cron] Force mode: 기존 전략 무시하고 새로 생성`);
      }
    }

    const strategy = await requestStrategyFromChatGPT(usdtHistory, rateHistory, kimchiPremiumHistory);
    console.log('[analyze-strategy-cron] GPT 응답 원본:', strategy);
    
    let parsedStrategy: any;
    try {
      parsedStrategy = JSON.parse(strategy);
      console.log('[analyze-strategy-cron] JSON 파싱 성공:', parsedStrategy);
    } catch (error) {
      console.log('[analyze-strategy-cron] JSON 파싱 실패:', error);
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
    console.log('[analyze-strategy-cron] parsedStrategy 구조:', JSON.stringify(parsedStrategy, null, 2));

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
async function setupKPremiumTrends(rateHistory: Record<string, number>, usdtHistory: Record<string, any>) {
  console.log('[analyze-strategy-cron] 김치 프리미엄 트렌드 계산 시작');
  console.log('[analyze-strategy-cron] rateHistory keys:', Object.keys(rateHistory).length);
  console.log('[analyze-strategy-cron] usdtHistory keys:', Object.keys(usdtHistory).length);
  
  try {
    const kimchiTrends = generatePremiumTrends(rateHistory, usdtHistory);
    console.log('[analyze-strategy-cron] generatePremiumTrends 결과:', Object.keys(kimchiTrends).length, '일');

    // Supabase에 김치 프리미엄 트렌드 데이터 저장
    const trendBody = JSON.stringify(kimchiTrends, null, 2);
    console.log('[analyze-strategy-cron] 저장할 데이터 크기:', trendBody.length, 'bytes');
    
    const uploadResponse = await fetch(gimchPremiumTrendUploadUrl, {
      method: "PUT",
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: trendBody
    });
    
    console.log('[analyze-strategy-cron] Supabase 업로드 응답:', uploadResponse.status, uploadResponse.statusText);

    console.log('[analyze-strategy-cron] 김치 프리미엄 트렌드 업데이트 완료:', Object.keys(kimchiTrends).length, '일');
  } catch (trendError) {
    console.error('[analyze-strategy-cron] 김치 프리미엄 트렌드 계산 실패:', trendError);
    // 트렌드 계산 실패해도 전략 업데이트는 성공으로 처리
  }
}

