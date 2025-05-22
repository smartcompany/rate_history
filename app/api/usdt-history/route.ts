import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const FILE_PATH = "usdt-history.json";

const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${FILE_PATH}`;
const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${FILE_PATH}`;

// 날짜 포맷 YYYY-MM-DD
function formatDate(date: Date) {
  return date.toISOString().split('T')[0];
}

/**
 * 업비트 KRW-USDT 일별 시세를 가져오는 함수
 * @param count 가져올 일수 (최대 200)
 * @returns [{ date: 'YYYY-MM-DD', price: number }, ...]
 */
export async function fetchUpbitUSDTByPage(count = 200) {
  const url = `https://api.upbit.com/v1/candles/days?market=KRW-USDT&count=${count}`;
  console.log(`[fetchUpbitUSDTByPage] 요청 URL:`, url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    }
  });
  console.log(`[fetchUpbitUSDTByPage] 응답 status:`, res.status);

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[fetchUpbitUSDTByPage] 에러 응답:`, errText);
    throw new Error('Upbit USDT fetch failed');
  }

  const data = await res.json();
  console.log(`[fetchUpbitUSDTByPage] 데이터 개수:`, Array.isArray(data) ? data.length : 'not array');
  // 날짜 리스트 로그 (최신 → 과거 순)
  console.log(
    '[fetchUpbitUSDTByPage] mapped date 리스트:',
    data.map((item: any) => item.candle_date_time_utc.split('T')[0])
  );

  // [{ date: 'YYYY-MM-DD', price: number }, ...] 형태로 변환
  return data.map((item: any) => ({
    date: item.candle_date_time_utc.split('T')[0],
    price: item.trade_price,
  }));
}

// Supabase에서 USDT 히스토리 가져오기
async function getUSDTPriceHistory() {
  const response = await fetch(storageUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (response.status === 404) return {}; // 파일 없으면 빈 객체 반환
  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  return await response.json();
}

// Supabase에 USDT 히스토리 저장하기
async function saveUSDTPriceHistory(history: Record<string, number>) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(history),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Failed to save USDT history: ' + errText);
  }
}

// Next.js Route Handler
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Number(searchParams.get('days') || '1');
    const upbitData = await fetchUpbitUSDTByPage(days);
    const newHistory: Record<string, number> = {};
    upbitData.forEach(item => {
      newHistory[item.date] = item.price;
    });

    // 기존 데이터와 비교하여 누락된 날짜만 저장
    const prevHistory = await getUSDTPriceHistory();
    const prevDates = Object.keys(prevHistory);
    const newDates = Object.keys(newHistory);
    const missingDates = newDates.filter(date => !prevDates.includes(date));

    let merged = prevHistory;
    if (missingDates.length > 0) {
      // 누락된 날짜가 있으면 저장
      merged = { ...prevHistory, ...newHistory };
      await saveUSDTPriceHistory(merged);
      console.log('새로운 USDT 데이터 저장:', missingDates);
    }

    // 날짜-가격 map 데이터 반환
    return NextResponse.json(merged);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}