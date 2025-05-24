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

아래와 같은 JSON 형태로만, 마크다운 코드블록(백틱 등) 없이 답변해줘.

{
  "analysis_date": (매매 분석 날짜, YYYY-MM-DD),
  "buy_price": (구매 추천 가격, 숫자),
  "sell_price": (판매 추천 가격, 숫자),
  "expected_return": (예상 수익률, % 단위 숫자),
  "summary": "한 줄 요약"
}

현재 시간 기준 USDT를 얼마에 사서 얼마에 팔면 좋을지 판단해주고, 이 전략의 예상 수익률도 계산해서 위 JSON으로만 답변해줘.
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

// Next.js API Route Handler
export async function GET() {
  try {
    // 1. 파일에서 기존 전략 읽기
    const fileRes = await fetch(strategyUrl, {
      headers: { apikey: SUPABASE_KEY }
    });
    let fileStrategy: any = null;
    if (fileRes.ok) {
      const text = await fileRes.text();
      try {
        fileStrategy = JSON.parse(text);
      } catch {
        console.log('[analyze-strategy] fileStrategy is null')
        fileStrategy = null;
      }
    }

    // 2. analysis_date가 없거나 오늘 이전이면 새로 요청
    let shouldUpdate = true;
    if (fileStrategy && fileStrategy.analysis_date) {
      shouldUpdate = !isTodayOrFuture(fileStrategy.analysis_date);
      console.log('[analyze-strategy] shouldUpdate:', shouldUpdate, fileStrategy.analysis_date);
    }

    if (!shouldUpdate && fileStrategy) {
      // 파일의 전략이 최신이면 바로 반환
      console.log('[analyze-strategy] 파일에서 전략 반환:', fileStrategy.analysis_date);
      return NextResponse.json(fileStrategy);
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

    // 4. Supabase에 저장
    await fetch(strategyUploadUrl, {
      method: "PUT",
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify(parsedStrategy)
    });

    // 5. 최신 전략 반환
    console.log('[analyze-strategy] 최신 전략 반환 및 저장:', parsedStrategy.analysis_date);
    return NextResponse.json(parsedStrategy);
  } catch (err: any) {
    console.error('[analyze-strategy] 에러:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}