import { NextResponse } from 'next/server';
import btcAnalysisPrompt from './btc-analysis-prompt.txt' assert { type: 'text' };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const BTC_STRATEGY_PATH = "analyze-btc-strategy.json";
const BTC_STRATEGY_UPLOAD_PATH = "analyze-btc-strategy.json";
const BTC_PATH = "btc-history.json";

const btcHistoryUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${BTC_PATH}`;
const btcStrategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${BTC_STRATEGY_PATH}`;
const btcStrategyUploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${BTC_STRATEGY_UPLOAD_PATH}`;

// Supabase에서 BTC 히스토리 가져오기
async function getBTCPriceHistory(): Promise<Record<string, any>> {
  const response = await fetch(btcHistoryUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (response.status === 404) return {}; // 파일 없으면 빈 객체 반환
  if (!response.ok) throw new Error('Failed to fetch BTC history from Supabase');
  return await response.json();
}

// OpenAI API 호출 함수
async function requestBTCStrategyFromChatGPT(btcHistory: any) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
  const apiUrl = "https://api.openai.com/v1/chat/completions";

  const promptTemplate = btcAnalysisPrompt;
  const prompt = promptTemplate.replace('{{btcHistory}}', JSON.stringify(btcHistory));

  // 프롬프트 로깅
  console.log('[analyze-btc-strategy-cron] ChatGPT 프롬프트:', prompt);

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "당신은 암호화폐 기술적 분석 전문가입니다. MA/EMA, RSI, MACD, Bollinger Bands, Volume/OBV 등의 기술적 지표를 종합적으로 분석하여 정확한 매수/매도 가격을 예측합니다." },
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
    throw new Error('Failed to get BTC strategy from ChatGPT: ' + errorText);
  }
  const data = await response.json();
  console.log('[requestBTCStrategyFromChatGPT] GPT API 응답:', JSON.stringify(data, null, 2));
  
  const content = data.choices?.[0]?.message?.content ?? "분석 결과를 가져오지 못했습니다.";
  console.log('[requestBTCStrategyFromChatGPT] 추출된 content:', content);
  
  return content;
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
    console.log('[analyze-btc-strategy-cron] Cron job started');

    // URL에서 force 파라미터 확인
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === 'true';
    console.log(`[analyze-btc-strategy-cron] Force mode: ${force}`);

    // 1. 파일에서 기존 전략 읽기 (배열 형태)
    const fileRes = await fetch(btcStrategyUrl, {
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
    
    console.log(`[analyze-btc-strategy-cron] UTC 오늘: ${todayStr}, 한국 오늘: ${koreaTodayStr}`);

    console.log('btcHistory 가져오기 시작');
    
    // BTC 히스토리 데이터 가져오기
    const btcHistory = await getBTCPriceHistory();
    const btcCount = Object.keys(btcHistory).length;
    console.log('[analyze-btc-strategy-cron] BTC 데이터 개수:', btcCount);

    if (btcCount === 0) {
      return NextResponse.json({ 
        error: 'BTC 히스토리 데이터가 없습니다.' 
      }, { status: 400 });
    }
    
    const latest = strategyList[0];
    if (latest && latest.analysis_date) {
      console.log(`[analyze-btc-strategy-cron] 최신 전략 날짜: ${latest.analysis_date}`);
      
      // force가 true가 아니고, 오늘 또는 내일 날짜가 이미 있으면 스킵
      if (!force && (latest.analysis_date === todayStr || latest.analysis_date === koreaTodayStr)) {
        console.log(`[analyze-btc-strategy-cron] 오늘(${koreaTodayStr}) 전략이 이미 존재함: ${latest.analysis_date}`);
        return NextResponse.json({ 
          message: '오늘 BTC 전략이 이미 존재합니다.', 
          latest_date: latest.analysis_date,
          today: koreaTodayStr
        }, { status: 200 });
      }
      
      if (force) {
        console.log(`[analyze-btc-strategy-cron] Force mode: 기존 전략 무시하고 새로 생성`);
      }
    }

    // 3. ChatGPT API 호출하여 전략 생성
    const strategy = await requestBTCStrategyFromChatGPT(btcHistory);
    console.log('[analyze-btc-strategy-cron] GPT 응답 원본:', strategy);
    
    let parsedStrategy: any;
    try {
      parsedStrategy = JSON.parse(strategy);
      console.log('[analyze-btc-strategy-cron] JSON 파싱 성공:', parsedStrategy);
    } catch (error) {
      console.log('[analyze-btc-strategy-cron] JSON 파싱 실패:', error);
      // JSON 파싱 실패 시 기본 구조 생성
      parsedStrategy = { 
        analysis_date: koreaTodayStr,
        buy_price: 0,
        sell_price: 0,
        expected_return: 0,
        summary: strategy 
      };
    }

    // 4. 배열 맨 앞에 추가 (최신이 맨 앞)
    // analysis_date를 한국 오늘 날짜로 강제 보정
    if (parsedStrategy && parsedStrategy.analysis_date && parsedStrategy.analysis_date !== koreaTodayStr) {
      console.log(`[analyze-btc-strategy-cron] analysis_date 보정: ${parsedStrategy.analysis_date} → ${koreaTodayStr}`);
      parsedStrategy.analysis_date = koreaTodayStr;
    } else if (!parsedStrategy.analysis_date) {
      parsedStrategy.analysis_date = koreaTodayStr;
    }

    console.log('[analyze-btc-strategy-cron] parsedStrategy:', parsedStrategy);
    strategyList.unshift(parsedStrategy);

    // 중복 제거: 동일 날짜는 마지막(최신) 것만 남김
    strategyList = dedupLatestStrategyByDate(strategyList);

    const body = JSON.stringify(strategyList, null, 2);

    // 5. Supabase에 저장 (배열 전체)
    await fetch(btcStrategyUploadUrl, {
      method: "PUT",
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: body
    });

    console.log('[analyze-btc-strategy-cron] BTC 전략 업데이트 완료:', strategyList.length);
    console.log('[analyze-btc-strategy-cron] parsedStrategy 구조:', JSON.stringify(parsedStrategy, null, 2));

    return NextResponse.json({ 
      message: 'BTC 전략이 성공적으로 업데이트되었습니다.', 
      new_strategy: parsedStrategy,
      total_strategies: strategyList.length
    }, { status: 200 });

  } catch (err: any) {
    console.error('[analyze-btc-strategy-cron] 에러:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

