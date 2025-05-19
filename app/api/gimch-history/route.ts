import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const FILE_PATH = "kimchi-premium.json";

const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${FILE_PATH}`;
const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${FILE_PATH}`;

// 날짜 포맷 YYYY-MM-DD
function formatDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function getDateNDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// 업비트 일별 BTC 가격 가져오기
async function fetchUpbitBTCByPage(count = 200) {
  const toDate = new Date();
  const toStr = toDate.toISOString().split('T')[0] + 'T00:00:00';
  const url = `https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=${count}&to=${toStr}`;
  console.log(`[fetchUpbitBTCByPage] 요청 URL:`, url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      // 필요시 추가 헤더
    }
  });
  console.log(`[fetchUpbitBTCByPage] 응답 status:`, res.status);

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[fetchUpbitBTCByPage] 에러 응답:`, errText);
    throw new Error('Upbit fetch failed');
  }

  const data = await res.json();
  console.log(`[fetchUpbitBTCByPage] 데이터 개수:`, Array.isArray(data) ? data.length : 'not array');
  return data; // [{candle_date_time_utc, trade_price, ...}, ...]
}

// 바이비트 일별 BTCUSDT 가격 가져오기
async function fetchBybitBTCByPage(count = 200) {
  const now = new Date();
  const toTimestamp = Math.floor(now.getTime() / 1000);
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=D&limit=${count}`;
  console.log(`[fetchBybitBTCByPage] 요청 URL:`, url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      // 필요시 추가 헤더
    }
  });
  console.log(`[fetchBybitBTCByPage] 응답 status:`, res.status);

  const data = await res.json();
  
  if (!data.result || !Array.isArray(data.result.list) || data.result.list.length === 0) {
    console.error('[fetchBybitBTCByPage] result.list 없음 또는 빈 배열:', data);
    return [];
  }

  const mapped = data.result.list.map((item: any) => ({
    date: new Date(Number(item[0])).toISOString().split('T')[0],
    price: parseFloat(item[4]),
  }));

  // date 값만 출력
  console.log('[fetchBybitBTCByPage] mapped date 리스트:', mapped.map(i => i.date));

  console.log(`[fetchBybitBTCByPage] 파싱된 데이터 개수:`, mapped.length);
  return mapped;
}

// 환율 정보 가져오기 (rate-history API)
async function fetchRateHistory(count = 200) {
  const url = `https://rate-history.vercel.app/api/rate-history?days=${count}`;
  console.log(`fetchRateHistory url:`, url);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Rate history fetch failed');
  return await res.json(); // { 'YYYY-MM-DD': 환율, ... }
}

async function fetchKimchiPremiumByPage(count: number) {

  const [upbit, bybit, rateHistory] = await Promise.all([
    fetchUpbitBTCByPage(count),
    fetchBybitBTCByPage(count),
    fetchRateHistory(count),
  ]);
  
  console.log('[fetchKimchiPremiumByPage] rateHistory 날짜 리스트:', Object.keys(rateHistory));
  // 2. 바이비트 데이터 날짜별로 매핑
  const bybitMap: Record<string, number> = {};
  for (const item of bybit) {
    bybitMap[item.date] = item.price;
  }

  // 3. 김치 프리미엄 계산
  const result: { date: string; premium: number }[] = [];
  for (const item of upbit) {
    const date = item.candle_date_time_utc.split('T')[0];
    const upbitPrice = item.trade_price;
    const bybitPrice = bybitMap[date];
    const rate = rateHistory[date];

    if (upbitPrice && bybitPrice && rate) {
      const premium = ((upbitPrice / (bybitPrice * rate)) - 1) * 100;
      result.push({ date, premium: Number(premium.toFixed(2)) });
    } else {
      console.log('[김프 계산 누락] date:', date, 
        '| upbitPrice:', upbitPrice, 
        '| bybitPrice:', bybitPrice, 
        '| rate:', rate);
    }
  }

  return result;
}

async function getKimchiPremiumHistory() {
  const response = await fetch(storageUrl, {
    headers: { apikey: SUPABASE_KEY }
  });
  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  return await response.json();
}

async function saveKimchiPremiumHistory(data: any) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Upload failed:', response.status, errorText);
    throw new Error('Failed to upload JSON to Supabase');
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Number(searchParams.get('days') || '1');

  const today = formatDate(new Date());
  const sinceDate = formatDate(getDateNDaysAgo(days));

  try {
    console.log('GET kimchi-premium: 시작', { days, today, sinceDate });

    let premiumHistory = await getKimchiPremiumHistory();
    console.log('기존 premiumHistory 불러옴', Object.keys(premiumHistory).length);

    const newHistory = { ...premiumHistory };

    let missingDates: string[] = [];
    const lastAvailableDate = Object.keys(premiumHistory).sort().pop();
    console.log('lastAvailableDate:', lastAvailableDate);

    if (!lastAvailableDate || new Date(lastAvailableDate) < new Date(today)) {
      let done = false;
 
      console.log(`김치 프리미엄 계산 시도`);
      const premiums = await fetchKimchiPremiumByPage(days);
      console.log(`페이지 premiums 개수:`, premiums.length);

      for (const { date, premium } of premiums) {
        if (newHistory[date]) continue;
        if (new Date(date) < new Date(sinceDate)) {
          done = true;
          break;
        }
        newHistory[date] = premium;
        missingDates.push(date);
      }

      if (missingDates.length > 0) {
        console.log('새로운 날짜 저장:', missingDates);
        await saveKimchiPremiumHistory(newHistory);
      }
    }

    const result: Record<string, number> = {};
    const allDates = Object.keys(newHistory).sort().reverse();
    console.log('최종 allDates 개수:', allDates.length);

    for (const date of allDates) {
      if (date >= sinceDate) {
        result[date] = newHistory[date];
      }
    }

    console.log('응답 데이터 개수:', Object.keys(result).length);
    return NextResponse.json(result);
  } catch (err) {
    console.error('김치 프리미엄 처리 에러:', err);
    return NextResponse.json({ error: "김치 프리미엄 데이터를 처리하지 못했습니다." }, { status: 500 });
  }
}