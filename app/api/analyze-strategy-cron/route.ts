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

// 김치 프리미엄 트렌드 계산 함수 (단일 패스, 날짜 정렬/정합 처리)
function generatePremiumTrends(rateHistory: Record<string, number>, usdtHistory: Record<string, any>): Record<string, any> {
  const trends: Record<string, any> = {};
  const baseBuyThreshold = 0.5;
  const baseSellThreshold = 2.5;

  console.log('[generatePremiumTrends] rateHistory keys:', Object.keys(rateHistory).length);
  console.log('[generatePremiumTrends] usdtHistory keys:', Object.keys(usdtHistory).length);

  // 공통 날짜 교집합을 오름차순 정렬
  const commonDates = Object.keys(rateHistory)
    .filter(d => usdtHistory[d] !== undefined)
    .sort();

  const windowSize = 5;
  console.log('[generatePremiumTrends] Starting loop, dates:', commonDates.length, 'windowSize:', windowSize);

  // 슬라이딩 윈도우(현재/이전) 합과 개수 관리로 O(n) 계산
  const values: (number | null)[] = [];
  const curWindow: (number | null)[] = [];
  const prevWindow: (number | null)[] = [];
  let curSum = 0, curCount = 0;
  let prevSum = 0, prevCount = 0;

  for (let i = 0; i < commonDates.length; i++) {
    const dateKey = commonDates[i];
    const rate = rateHistory[dateKey];
    const usdtData = usdtHistory[dateKey];
    const usdt = (usdtData as any)?.close ?? (usdtData as any)?.price ?? usdtData;
    const val = (rate > 0 && usdt > 0) ? ((usdt - rate) / rate) * 100 : null;
    values.push(val);

    // 현재 윈도우 갱신
    curWindow.push(val);
    if (val != null) { curSum += val; curCount++; }
    if (curWindow.length > windowSize) {
      const out = curWindow.shift();
      if (out != null) { curSum -= out; curCount--; }
    }

    // 이전 윈도우 갱신 (현재 인덱스에서 windowSize만큼 뒤의 값을 사용)
    if (i - windowSize >= 0) {
      const prevValToAdd = values[i - windowSize];
      prevWindow.push(prevValToAdd);
      if (prevValToAdd != null) { prevSum += prevValToAdd; prevCount++; }
      if (prevWindow.length > windowSize) {
        const prevOut = prevWindow.shift();
        if (prevOut != null) { prevSum -= prevOut; prevCount--; }
      }
    }

    // MA5 계산 가능 시점부터 결과 산출
    if (curWindow.length === windowSize) {
      const kimchiMA5 = Math.round((curCount > 0 ? (curSum / curCount) : 0) * 10) / 10; // 소수점 첫째 자리
      let kimchiTrend = 0;
      if (prevWindow.length === windowSize && prevCount > 0) {
        const prevMA5 = prevSum / prevCount;
        kimchiTrend = Math.round((kimchiMA5 - prevMA5) * 10) / 10; // 소수점 첫째 자리
      }

      // 현재까지의 김치 프리미엄 값들 수집 (기술적 분석용)
      const kimchiValues = values.filter(v => v !== null) as number[];

      // 이전 임계값 가져오기 (변화율 제한용)
      const previousBuyThreshold = trends[commonDates[i - 1]]?.buy_threshold;
      const previousSellThreshold = trends[commonDates[i - 1]]?.sell_threshold;

      const buyThreshold = Math.round(calculateAdjustedThreshold(
        baseBuyThreshold,
        kimchiTrend,
        true,
        kimchiMA5,
        kimchiValues,
        previousBuyThreshold
      ) * 10) / 10; // 소수점 첫째 자리

      const sellThreshold = Math.round(calculateAdjustedThreshold(
        baseSellThreshold,
        kimchiTrend,
        false,
        kimchiMA5,
        kimchiValues,
        previousSellThreshold
      ) * 10) / 10; // 소수점 첫째 자리

      trends[dateKey] = {
        buy_threshold: buyThreshold, // 이미 소수점 첫째 자리로 반올림됨
        sell_threshold: sellThreshold, // 이미 소수점 첫째 자리로 반올림됨
        kimchi_trend: kimchiTrend, // 이미 소수점 첫째 자리로 반올림됨
        kimchi_ma5: kimchiMA5 // 이미 소수점 첫째 자리로 반올림됨
      };
    }
  }

  return trends;
}

// 고급 기술적 분석 지표 계산 함수들
function calculateMACD(values: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) {
  if (values.length < slowPeriod) return { macd: 0, signal: 0, histogram: 0 };
  
  const emaFast = calculateEMA(values, fastPeriod);
  const emaSlow = calculateEMA(values, slowPeriod);
  const macd = emaFast - emaSlow;
  
  // MACD 시그널라인 (MACD의 EMA)
  const macdValues = [macd];
  const signal = calculateEMA(macdValues, signalPeriod);
  const histogram = macd - signal;
  
  return { macd, signal, histogram };
}

function calculateEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return values[values.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = values[0];
  
  for (let i = 1; i < values.length; i++) {
    ema = (values[i] * multiplier) + (ema * (1 - multiplier));
  }
  
  return ema;
}

function calculateRSI(values: number[], period: number = 14): number {
  if (values.length < period + 1) return 50; // 중립값
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = values[values.length - i] - values[values.length - i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateBollingerBands(values: number[], period: number = 20, stdDev: number = 2) {
  if (values.length < period) return { upper: 0, middle: 0, lower: 0, width: 0 };
  
  const recentValues = values.slice(-period);
  const sma = recentValues.reduce((sum, val) => sum + val, 0) / period;
  
  const variance = recentValues.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);
  
  const upper = sma + (standardDeviation * stdDev);
  const lower = sma - (standardDeviation * stdDev);
  const width = (upper - lower) / sma; // 정규화된 밴드 폭
  
  return { upper, middle: sma, lower, width };
}

// 최적화된 파라미터 (자동 최적화 결과 - 모든 데이터 기반)
const OPTIMIZED_PARAMS = {
  buyTrendCoefficient: 0.05,  // 최적화된 매수 기준 조정 계수
  sellTrendCoefficient: 0.05, // 최적화된 매도 기준 조정 계수
  macdWeight: 0.05,
  rsiWeight: 0.05,
  bbWeight: 0.05,
  maWeight: 0.05,
  adjustmentFactor: 0.02
};

// 조정된 임계값 계산 함수 (고급 기술적 분석 + 변화율 제한 적용)
function calculateAdjustedThreshold(
  baseThreshold: number,
  kimchiTrend: number,
  isBuyThreshold: boolean,
  kimchiMA5: number,
  kimchiValues: number[] = [],
  previousThreshold?: number
): number {
  let adjustedThreshold = baseThreshold;
  
  // 최적화된 트렌드 기반 조정
  const buyTrendCoefficient = OPTIMIZED_PARAMS.buyTrendCoefficient;
  const sellTrendCoefficient = OPTIMIZED_PARAMS.sellTrendCoefficient;
  
  if (isBuyThreshold) {
    // 매수 기준: 김치 프리미엄이 낮을 때 사야 하므로
    // 김치 프리미엄이 상승 중이면 → 매수 기준 낮춤 (더 쉽게 매수)
    // 김치 프리미엄이 하락 중이면 → 매수 기준 높임 (더 신중하게)
    adjustedThreshold -= kimchiTrend * buyTrendCoefficient;
  } else {
    // 매도 기준: 김치 프리미엄이 높을 때 팔아야 하므로
    // 김치 프리미엄이 상승 중이면 → 매도 기준 높임 (더 오래 보유)
    // 김치 프리미엄이 하락 중이면 → 매도 기준 낮춤 (빨리 매도)
    adjustedThreshold += kimchiTrend * sellTrendCoefficient;
  }
  
  // 추가 기술적 분석 지표 적용 (최근 20일 데이터가 있을 때만)
  if (kimchiValues.length >= 20) {
    const recentValues = kimchiValues.slice(-20);
    
    // 1. MACD 신호
    const macd = calculateMACD(recentValues);
    const macdSignal = macd.histogram > 0 ? 1 : -1; // MACD 히스토그램이 양수면 상승 신호
    
    // 2. RSI 신호
    const rsi = calculateRSI(recentValues);
    const rsiSignal = rsi < 30 ? 1 : rsi > 70 ? -1 : 0; // 과매도/과매수 신호
    
    // 3. Bollinger Bands 신호
    const bb = calculateBollingerBands(recentValues);
    const currentValue = recentValues[recentValues.length - 1];
    const bbSignal = currentValue < bb.lower ? 1 : currentValue > bb.upper ? -1 : 0; // 밴드 돌파 신호
    
    // 4. 이동평균선 크로스오버 신호
    const ma5 = recentValues.slice(-5).reduce((sum, val) => sum + val, 0) / 5;
    const ma10 = recentValues.slice(-10).reduce((sum, val) => sum + val, 0) / 10;
    const maCrossSignal = ma5 > ma10 ? 1 : -1; // 골든크로스/데드크로스
    
    // 종합 신호 계산 (최적화된 가중평균)
    const totalSignal = (macdSignal * OPTIMIZED_PARAMS.macdWeight) + 
                       (rsiSignal * OPTIMIZED_PARAMS.rsiWeight) + 
                       (bbSignal * OPTIMIZED_PARAMS.bbWeight) + 
                       (maCrossSignal * OPTIMIZED_PARAMS.maWeight);
    
    // 신호 강도에 따른 임계값 조정 (최적화된 계수)
    const signalStrength = Math.abs(totalSignal);
    const adjustmentFactor = signalStrength * OPTIMIZED_PARAMS.adjustmentFactor;
    
    if (isBuyThreshold) {
      // 매수: 강한 상승 신호일 때 기준 더 낮춤
      adjustedThreshold -= totalSignal * adjustmentFactor;
    } else {
      // 매도: 강한 하락 신호일 때 기준 더 낮춤
      adjustedThreshold += totalSignal * adjustmentFactor;
    }
    
    // 변동성 기반 조정 (Bollinger Bands 폭)
    const volatilityAdjustment = bb.width * 0.5; // 변동성이 클수록 더 민감하게
    adjustedThreshold *= (1 - volatilityAdjustment);
  }
  
  // 범위 제한 제거 - 김치 프리미엄 트렌드에 따라 자연스럽게 조정
  // (매수 기준 < 매도 기준은 로직상 보장됨)
  
  // 변화율 제한 적용 (이전 값이 있을 때만) - 더 완화
  if (previousThreshold !== undefined) {
    const maxChangeRate = 0.3; // 최대 30% 변화 허용 (더 보수적)
    const minThreshold = previousThreshold * (1 - maxChangeRate);
    const maxThreshold = previousThreshold * (1 + maxChangeRate);
    
    // 변화율 제한 내에서 조정
    adjustedThreshold = Math.max(minThreshold, Math.min(maxThreshold, adjustedThreshold));
  }
  
  return adjustedThreshold;
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

