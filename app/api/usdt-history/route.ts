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
async function fetchUpbitUSDTByPage(count = 200) {
  const url = `https://api.upbit.com/v1/candles/days?market=KRW-USDT&count=${count}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) throw new Error('Upbit USDT fetch failed');
  const data = await res.json();

  // [{ date, open: close, high, low }, ...] 형태로 변환
  return data.map((item: any) => ({
    date: item.candle_date_time_utc.split('T')[0],
    open: item.opening_price,
    close: item.trade_price,
    high: item.high_price,
    low: item.low_price,
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
async function saveUSDTPriceHistory(history: Record<string, { price: number; high: number; low: number }>) {
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
    throw new Error('Failed to save USDT history: ' + errText);
  }
}

// Next.js Route Handler
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Number(searchParams.get('days') || '1');
    const upbitData = await fetchUpbitUSDTByPage(days);
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

    // 기존 데이터와 비교하여 누락된 날짜만 저장
    const prevHistory = await getUSDTPriceHistory();
    const prevDates = Object.keys(prevHistory);
    const newDates = Object.keys(newHistory);
    const missingDates = newDates.filter(date => !prevDates.includes(date));

    // ★★★ 최신 날짜는 항상 덮어쓰기
    const latestDate = newDates.length > 0
      ? newDates.sort().reverse()[0]
      : null;
    if (latestDate) {
      // 기존에 있던 값도 최신값으로 덮어씀
      prevHistory[latestDate] = newHistory[latestDate];
      // 혹시 newHistory에만 있고 prevHistory에 없으면 이미 병합될 예정
    }

    if (missingDates.length > 0 || latestDate) {
      // 누락된 날짜가 있거나, 최신 날짜를 덮어썼으면 저장
      let merged = { ...prevHistory, ...newHistory };

      // 날짜 기준 내림차순 정렬
      const sorted: Record<string, { price: number; high: number; low: number; open?: number; close?: number }> = {};
      Object.keys(merged)
        .sort()
        .reverse()
        .forEach(date => {
          sorted[date] = merged[date];
        });

      await saveUSDTPriceHistory(sorted);
      console.log('새로운 USDT 데이터 저장:', missingDates, '최신 날짜 덮어쓰기:', latestDate);
    }

    // 날짜-가격 map 데이터 반환
    return new Response(
      JSON.stringify(newHistory, null, 2), // 2칸 들여쓰기
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}