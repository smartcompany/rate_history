import { NextResponse } from 'next/server';
import { differenceInCalendarDays } from 'date-fns'; // 상단에 추가 (date-fns 설치 필요)

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
  const url = `https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=${count}`;
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
  // 날짜 리스트 로그 (최신 → 과거 순)
  console.log(
    '[fetchUpbitBTCByPage] mapped date 리스트:',
    data.map((item: any) => item.candle_date_time_utc.split('T')[0])
  );
  return data; // [{candle_date_time_utc, trade_price, ...}, ...]
}

// 바이낸스 일별 BTCUSDT 가격 가져오기
async function fetchBinanceBTCByPage(count = 200) {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=${count}`;
  console.log(`[fetchBinanceBTCByPage] 요청 URL:`, url);

  const res = await fetch(url);
  console.log(`[fetchBinanceBTCByPage] 응답 status:`, res.status);

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[fetchBinanceBTCByPage] 에러 응답:`, errText);
    return [];
  }

  const data = await res.json();

  // Binance 응답: [ [openTime, open, high, low, close, ...], ... ]
  const mapped = data.map((item: any) => ({
    date: new Date(item[0]).toISOString().split('T')[0],
    price: parseFloat(item[4]), // 종가(close)
  }));

  // date 값만 출력 (최신 → 과거 순으로)
  console.log(
    '[fetchBinanceBTCByPage] mapped date 리스트:',
    mapped.map(i => i.date).reverse()
  );
  console.log(`[fetchBinanceBTCByPage] 파싱된 데이터 개수:`, mapped.length);
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
    fetchBinanceBTCByPage(count),
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
  if (response.status === 404) return {}; // 파일 없으면 빈 객체 반환
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

  let premiumHistory = await getKimchiPremiumHistory();
  const newHistory = { ...premiumHistory };
  const lastAvailableDate = Object.keys(premiumHistory).sort().pop();
  const days = Number(searchParams.get('days'));

  // 오늘 날짜
  const today = formatDate(new Date());

  // 누락된 일수 계산
  let missingDays = days;
  if (lastAvailableDate) {
    missingDays = differenceInCalendarDays(new Date(today), new Date(lastAvailableDate));
  }
  
  const sortedHistory: Record<string, number> = newHistory;

  try {
    console.log('GET kimchi-premium: 시작', { lastAvailableDate, today, missingDays });

    if (missingDays > 0) {
      console.log('누락된 일수:', missingDays);
      const premiums = await fetchKimchiPremiumByPage(missingDays);

      if (premiums.length > 0) {
        for (const { date, premium } of premiums) {
          newHistory[date] = premium;
        }

        Object.keys(newHistory)
          .sort()
          .reverse()
          .forEach(date => {
            sortedHistory[date] = newHistory[date];
          });

        console.log('저장 직전 데이터:', sortedHistory);

        await saveKimchiPremiumHistory(sortedHistory);
        console.log('프리미엄 데이터 저장 완료:', Object.keys(sortedHistory).length);
      } else {
        console.log('유효한 프리미엄 데이터 없음');
      }
    } else {
      console.log('업데이트 필요 없음:', lastAvailableDate);
    }

    return NextResponse.json(sortedHistory);
  } catch (err) {
    console.error('김치 프리미엄 처리 에러:', err);
    return NextResponse.json({ error: "김치 프리미엄 데이터를 처리하지 못했습니다." }, { status: 500 });
  }
}