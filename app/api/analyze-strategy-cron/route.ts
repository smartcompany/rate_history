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

const usdtHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USDT_PATH}`;
const gimchHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${GIMCHI_PATH}`;
const usdRateHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USD_RATE_PATH}`;
const strategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${STRATEGE_PATH}`;
const strategyUploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${STRATEGE_UPLOAD_PATH}`;
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

    // 3. 새로운 전략 생성
    console.log('[analyze-strategy-cron] 새로운 전략 생성 시작');
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
