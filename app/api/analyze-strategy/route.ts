import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const USDT_PATH = "usdt-history.json";
const GIMCHI_PATH = "kimchi-premium.json";
const USD_RATE_PATH = "rate-history.json";
const STRATEGE_PATH = "analyze-strategy.json";
const LOG_PATH = "vercel-logs.json";
const PROMPT_PATH = "analysis-prompt.txt";

const usdtHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USDT_PATH}`;
const gimchHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${GIMCHI_PATH}`;
const usdRateHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USD_RATE_PATH}`;
const strategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${STRATEGE_PATH}`;
const strategyUploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${STRATEGE_PATH}`;
const logUploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${LOG_PATH}`;
const promptUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${PROMPT_PATH}`;

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
  const response = await fetch(usdRateHistoryUrl, {
    headers: { apikey: SUPABASE_KEY }
  });

  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  return await response.json();
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

// OpenAI API 호출 함수 (예시)
async function requestStrategyFromChatGPT(usdtHistory: any, rateHistory: any, kimchiPremiumHistory: any) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
  const apiUrl = "https://api.openai.com/v1/chat/completions";

  const promptTemplate = await getPromptTemplate();
  const prompt = promptTemplate
    .replace('{{usdtHistory}}', JSON.stringify(usdtHistory))
    .replace('{{rateHistory}}', JSON.stringify(rateHistory))
    .replace('{{kimchiPremiumHistory}}', JSON.stringify(kimchiPremiumHistory));

  // 프롬프트 로깅
  console.log('[analyze-strategy] ChatGPT 프롬프트:', prompt);

  const body = {
    model: "gpt-5-mini",
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

// 날짜 비교 함수
function isTodayOrFuture(dateStr: string) {
  const today = new Date();
  const target = new Date(dateStr);
  // 오늘 날짜(시분초 제거)
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return target >= today;
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

// 로그를 Supabase Storage에 저장하는 함수
async function uploadLogToSupabase(log: any) {
  try {
    await fetch(logUploadUrl, {
      method: "PUT",
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        ...log,
      }, null, 2),
    });
  } catch (e) {
    console.error('[analyze-strategy] 로그 업로드 실패:', e);
  }
}

// Next.js API Route Handler
export async function GET(request: Request) {
  try {
    // 쿼리 파라미터에서 shouldUpdate 확인
    const url = new URL(request.url);
    const shouldUpdateParam = url.searchParams.get('shouldUpdate');
    let shouldUpdateOverride: boolean | undefined = undefined;
    if (shouldUpdateParam !== null) {
      // 'true', '1', 'yes' 등은 true로 간주
      shouldUpdateOverride = ['true', '1', 'yes'].includes(shouldUpdateParam.toLowerCase());
    }

    // Vercel Cron 여부 확인 (user-agent에 vercel-cron 포함 여부로 변경)
    const userAgent = request.headers.get('user-agent') || '';
    const isVercelCron = userAgent.toLowerCase().includes('vercel-cron');
    if (isVercelCron) {
      console.log('[analyze-strategy] 🚀 Vercel Cron으로 실행됨');
      
      await uploadLogToSupabase({
        event: isVercelCron ? 'vercel-cron' : 'api-call',
        date: new Date().toISOString(),
        userAgent,
        url: request.url,
      });
      
    } else {
      console.log('[analyze-strategy] 일반 API 호출');
    }

    console.log('[analyze-strategy] User-agent:', userAgent);

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

    // 2. 최신 전략이 이미 있으면 반환
    const latest = strategyList[0];
    let shouldUpdate = true;
    if (latest && latest.analysis_date) {
      shouldUpdate = !isTodayOrFuture(latest.analysis_date);
      console.log('[analyze-strategy] shouldUpdate:', shouldUpdate, latest.analysis_date);
    }

    // 쿼리 파라미터로 강제 오버라이드
    if (shouldUpdateOverride !== undefined) {
      shouldUpdate = shouldUpdateOverride;
      console.log('[analyze-strategy] shouldUpdate 파라미터 오버라이드:', shouldUpdate);
    }

    if (!shouldUpdate && latest) {
      console.log('[analyze-strategy] 파일에서 최신 전략 반환:', latest.analysis_date);
      // 최신 전략이 이미 있으면 전체 히스토리(배열) 반환 (가독성 있게)
      return new Response(
        JSON.stringify(strategyList, null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // 3. 최신 전략 필요시 ChatGPT에 요청
    console.log('[analyze-strategy] ChatGPT API 호출 및 전략 갱신');
    const [usdtHistory, rateHistory, kimchiPremiumHistory] = await Promise.all([
      getUSDTPriceHistory(),
      getRateHistory(),
      getKimchiPremiumHistory(),
    ]);

    const strategy = await requestStrategyFromChatGPT(usdtHistory, rateHistory, kimchiPremiumHistory);
    let parsedStrategy: any;
    try {
      parsedStrategy = JSON.parse(strategy);
    } catch {
      parsedStrategy = { strategy };
    }

    // 4. 배열 맨 앞에 추가 (최신이 맨 앞)
    // analysis_date를 오늘 날짜로 강제 보정
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
    if (parsedStrategy && parsedStrategy.analysis_date && parsedStrategy.analysis_date !== todayStr) {
      console.log(`[analyze-strategy] analysis_date 보정: ${parsedStrategy.analysis_date} → ${todayStr}`);
      parsedStrategy.analysis_date = todayStr;
    }

    console.log('[analyze-strategy] parsedStrategy:', parsedStrategy); // ← 로그 추가
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
      body: body // ← 들여쓰기 추가!
    });

    // 6. 전략 히스토리 전체 반환 (가독성 좋은 JSON)
    console.log('[analyze-strategy] 전략 히스토리 전체 반환:', strategyList.length);
    return new Response(
      body, // 2스페이스 들여쓰기
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    console.error('[analyze-strategy] 에러:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}