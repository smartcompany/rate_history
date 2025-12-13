import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const FILE_PATH = "btc-history.json";

const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${FILE_PATH}`;
const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${FILE_PATH}`;

// 날짜 포맷 YYYY-MM-DD
function formatDate(date: Date) {
  return date.toISOString().split('T')[0];
}

/**
 * 업비트 KRW-BTC 일별 시세를 가져오는 함수
 * @param count 가져올 일수 (최대 200)
 * @returns [{ date: 'YYYY-MM-DD', open, close, high, low }, ...]
 */
async function fetchUpbitBTCByPage(count = 200) {
  const url = `https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=${count}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) throw new Error('Upbit BTC fetch failed');
  const data = await res.json();

  // [{ date, open, close, high, low }, ...] 형태로 변환
  return data.map((item: any) => ({
    date: item.candle_date_time_utc.split('T')[0],
    open: item.opening_price,
    close: item.trade_price,
    high: item.high_price,
    low: item.low_price,
  }));
}

// Supabase에서 BTC 히스토리 가져오기
async function getBTCPriceHistory() {
  const response = await fetch(storageUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (response.status === 404) return {}; // 파일 없으면 빈 객체 반환
  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  return await response.json();
}

// Supabase에 BTC 히스토리 저장하기
async function saveBTCPriceHistory(history: Record<string, { open: number; close: number; high: number; low: number }>) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(history, null, 2),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Failed to save BTC history: ' + errText);
  }
}

// Next.js Route Handler
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days');

    let days = 1;
    if (daysParam === 'all') {
      days = 200;
    } else {
      days = Number(daysParam) || 1;
    }

    // 기존 데이터와 비교하여 누락된 날짜만 저장
    const prevHistory = await getBTCPriceHistory();
    const prevDates = Object.keys(prevHistory);
    const prevLatestDateStr = prevDates.length > 0 ? prevDates.sort().reverse()[0] : null;
    const today = new Date();
    const prevLatestDate = prevLatestDateStr ? new Date(prevLatestDateStr) : null;
    const diffTime = prevLatestDate ? today.getTime() - prevLatestDate.getTime() : today.getTime();
    const diffDays = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    console.log('[DEBUG] prevLatestDateStr:', prevLatestDateStr);
    console.log('[DEBUG] today:', formatDate(today));
    console.log('[DEBUG] diffDays:', diffDays);
    console.log('[DEBUG] daysParam:', daysParam, 'days:', days);

    const upbitData = await fetchUpbitBTCByPage(diffDays);
    console.log('[DEBUG] upbitData.length:', upbitData.length);
    let newHistory: Record<string, { 
      open: number; 
      close: number; 
      high: number; 
      low: number }> = {};

    upbitData.forEach(item => {
      newHistory[item.date] = {
        open: item.open,
        close: item.close,
        high: item.high,
        low: item.low,
      };
    });
    console.log('[DEBUG] newHistory keys:', Object.keys(newHistory));

    let merged = { ...prevHistory, ...newHistory };

    // 날짜 기준 내림차순 정렬
    const sorted: Record<string, { open: number; close: number; high: number; low: number }> = {};
    Object.keys(merged)
      .sort()
      .reverse()
      .forEach(date => {
        sorted[date] = merged[date];
      });
    console.log('[DEBUG] sorted keys:', Object.keys(sorted));

    await saveBTCPriceHistory(sorted);

    if (daysParam === 'all') {
      return new Response(
        JSON.stringify(sorted, null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      // 요청한 days 만큼 날짜(key)를 유지한 객체로 반환
      const slicedKeys = Object.keys(sorted).slice(0, days);
      const slicedSorted: typeof sorted = {};
      slicedKeys.forEach(date => {
        slicedSorted[date] = sorted[date];
      });
      return new Response(
        JSON.stringify(slicedSorted, null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

