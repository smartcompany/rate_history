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

// Next.js API Route Handler
export async function GET() {
  try {
    // 1. 데이터 읽기
    const [usdtHistory, rateHistory, kimchiPremiumHistory] = await Promise.all([
      getUSDTPriceHistory(),
      getRateHistory(),
      getKimchiPremiumHistory(),
    ]);

    // 데이터 콘솔 로그로 확인
    console.log('USDT History:', JSON.stringify(usdtHistory, null, 2));
    console.log('Rate History:', JSON.stringify(rateHistory, null, 2));
    console.log('Kimchi Premium History:', JSON.stringify(kimchiPremiumHistory, null, 2));

    // 2. ChatGPT에 전략 요청
    const strategy = await requestStrategyFromChatGPT(usdtHistory, rateHistory, kimchiPremiumHistory);
    const response = NextResponse.json({ strategy });
    const body = JSON.stringify({ strategy });

    console.log('body:', body);
    
    // 2-1. 전략 결과를 Supabase에 저장
    await fetch(strategyUploadUrl, {
      method: "PUT",
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: body
    });

    // 3. 결과 반환
    return response;
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}