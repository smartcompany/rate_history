import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const USDT_PATH = "usdt-history.json";
const GIMCHI_PATH = "kimchi-premium.json";
const USD_RATE_PATH = "rate-history.json";
const STRATEGE_PATH = "analyze-strategy.json";

const usdtHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USDT_PATH}`;
const gimchHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${GIMCHI_PATH}`;
const usdRateHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${USD_RATE_PATH}`;
const strategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${STRATEGE_PATH}`;
const strategyUploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${STRATEGE_PATH}`;

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

// OpenAI API 호출 함수 (예시)
async function requestStrategyFromChatGPT(usdtHistory: any, rateHistory: any, kimchiPremiumHistory: any) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
  const apiUrl = "https://api.openai.com/v1/chat/completions";

  const prompt = `
다음은 USDT, 환율, 김치 프리미엄의 일별 데이터입니다.
각 데이터는 날짜별로 매핑된 JSON 형태입니다.

USDT: ${JSON.stringify(usdtHistory)}
환율: ${JSON.stringify(rateHistory)}
김치 프리미엄: ${JSON.stringify(kimchiPremiumHistory)}

USDT 값은 "날짜":{"price":종가,"high":최고가,"low":최저가} 로 되어 있어 이 3개의 내용을 분석해서 
아래와 같은 JSON 형태로만, 마크다운 코드블록(백틱 등) 없이 답변해줘.

{
  "analysis_date": (매매 분석 날짜, YYYY-MM-DD),
  "buy_price": (구매 추천 가격, 숫자),
  "sell_price": (판매 추천 가격, 숫자),
  "expected_return": (예상 수익률, % 단위 숫자),
  "summary": "한 줄 요약"
}

analysis_date는 반드시 오늘 날짜(YYYY-MM-DD)로만 작성해줘.
USDT를 얼마에 사서 얼마에 팔면 좋을지 판단해주고, 이 전략의 예상 수익률도 계산해서 위 JSON으로만 답변해줘.
summary에는 이렇게 가격을 판단한 근거에 대해 히스토리를 분석한 내용을 담아줘.
`;

  const body = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "당신은 투자 전략 분석 전문가입니다." },
      { role: "user", content: prompt }
    ],
    max_tokens: 1000,
    temperature: 0.7,
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
  // 뒤에서부터 순회
  for (let i = strategyList.length - 1; i >= 0; i--) {
    const s = strategyList[i];
    if (!s.analysis_date) continue;
    if (!seen.has(s.analysis_date)) {
      seen.add(s.analysis_date);
      result.unshift(s); // 앞에 추가해서 원래 순서 유지
    }
  }
  return result;
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

    // Vercel Cron 여부 확인
    const isVercelCron = request.headers.get('x-vercel-cron') !== null;
    if (isVercelCron) {
      console.log('[analyze-strategy] 🚀 Vercel Cron으로 실행됨');
    } else {
      console.log('[analyze-strategy] 일반 API 호출');
    }

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