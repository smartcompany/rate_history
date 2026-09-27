// app/api/rate-history/route.ts

import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const FILE_PATH = "rate-history.json";

const naverFxUrl = "https://api.stock.naver.com/marketindex/exchange/FX_USDKRW";
const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${FILE_PATH}`;
const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${FILE_PATH}`;

function formatDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function getDateNDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// sinceDate ~ today까지 모든 날짜 생성
function getAllDates(sinceDate: string, today: string): string[] {
  const dates = [];
  let d = new Date(sinceDate);
  const end = new Date(today);
  while (d <= end) {
    dates.push(formatDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates; // 최신순
}

function parseNaverPrice(raw: unknown): number | null {
  const rate = parseFloat(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function fxErrorResponse() {
  return NextResponse.json({ error: "환율 정보 오류" }, { status: 502 });
}

/** 최신 고시 환율. `calcPrice`가 없으면 `closePrice`. 실패·null이면 throw. */
async function fetchLatestNaverRate(): Promise<{ date: string; rate: number }> {
  const response = await fetch(naverFxUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`naver fx ${response.status}`);

  const info = (await response.json())?.exchangeInfo;
  const rate = parseNaverPrice(info?.calcPrice) ?? parseNaverPrice(info?.closePrice);
  const date = String(info?.localTradedAt ?? "").slice(0, 10);
  if (!date || rate == null) throw new Error("naver fx empty");
  return { date, rate };
}

/** 일별 매매기준율. 과거 페이지는 같은 경로의 `/prices`. HTTP 오류면 throw, 마지막 페이지는 빈 배열. */
async function fetchRateByPage(page: number) {
  const response = await fetch(
    `${naverFxUrl}/prices?page=${page}&pageSize=10`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`naver fx prices ${response.status}`);

  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("naver fx prices invalid");

  const result: { date: string; rate: number }[] = [];
  for (const row of rows) {
    const date = String(row?.localTradedAt ?? "").slice(0, 10);
    const rate = parseNaverPrice(row?.closePrice);
    if (date && rate != null) result.push({ date, rate });
  }
  return result;
}

async function getRateHistory() {
  const response = await fetch(storageUrl, {
    headers: { apikey: SUPABASE_KEY }
  });

  if (!response.ok) throw new Error('Failed to fetch JSON from Supabase');
  return await response.json();
}

async function saveRateHistory(data: any) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(data, null, 2) // 2칸 들여쓰기
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Upload failed:', response.status, errorText);
    throw new Error('Failed to upload JSON to Supabase');
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Number(searchParams.get('days') || '0');

  if (days == 0) {
    try {
      const history: Record<string, number> = {};
      const rates = await fetchRateByPage(1);
      for (const { date, rate } of rates) {
        history[date] = rate;
      }
      const latest = await fetchLatestNaverRate();
      history[latest.date] = latest.rate;
      if (Object.keys(history).length === 0) return fxErrorResponse();

      return new Response(
        JSON.stringify(history, null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (err) {
      console.error(err);
      return fxErrorResponse();
    }
  }

  const today = formatDate(new Date());
  const sinceDate = formatDate(getDateNDaysAgo(days));

  console.log(`오늘 날짜: ${today}`);
  console.log(`sinceDate: ${sinceDate}`);

  try {
    let rateHistory = await getRateHistory();
    let newHistory = { ...rateHistory };
    const lastAvailableDate = Object.keys(rateHistory).sort().pop();

    console.log(`lastAvailableDate: ${lastAvailableDate}`);
    let lastDate = new Date(lastAvailableDate);
    let todayDate = new Date(today);

    console.log(`lastDate: ${lastDate}`);
    console.log(`todayDate: ${todayDate}`);

    if (!lastAvailableDate || lastDate < todayDate) {
      let missingDates: string[] = [];
      let page = 1;
      let done = false;

      while (!done && page <= 100) {
        const rates = await fetchRateByPage(page);
        console.log(`페이지 ${page} 데이터:`, rates);

        if (rates.length === 0) {
          if (page === 1) throw new Error("naver fx prices empty");
          break;
        }

        for (const { date, rate } of rates) {
          if (newHistory[date]) continue;
          if (new Date(date) < new Date(sinceDate)) {
            done = true;
            break;
          }
          newHistory[date] = rate;
          missingDates.push(date);
        }

        page += 1;
      }

      const latest = await fetchLatestNaverRate();
      if (new Date(latest.date) >= new Date(sinceDate)) {
        newHistory[latest.date] = latest.rate;
      }

      const allDates = getAllDates(sinceDate, today);

      let prevRate: number | undefined = undefined;
      for (const date of allDates) {
        if (newHistory[date] == undefined) {
          if (prevRate == undefined) continue;
          console.log(`누락된 날짜 환율 채움: ${date} = ${prevRate}`);
          newHistory[date] = prevRate;
        } else {
          prevRate = newHistory[date];
        }
      }

      const sortedHistory: Record<string, number> = {};
      Object.keys(newHistory)
        .sort()
        .reverse()
        .forEach(date => {
          sortedHistory[date] = newHistory[date];
        });
      newHistory = sortedHistory;

      await saveRateHistory(newHistory);
    } else if (lastDate.getTime() === todayDate.getTime()) {
      // 최신 고시를 못 받으면 저장본을 성공처럼 돌려주지 않는다
      const latest = await fetchLatestNaverRate();
      console.log(`오늘 날짜 환율 갱신:`, latest);
      newHistory[latest.date] = latest.rate;
      await saveRateHistory(newHistory);
    }

    return new Response(
      JSON.stringify(newHistory, null, 2), // 2칸 들여쓰기
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err) {
    console.error(err);
    return fxErrorResponse();
  }
}