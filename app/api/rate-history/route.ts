// app/api/rate-history/route.ts

import * as cheerio from 'cheerio';
import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const FILE_PATH = "rate-history.json";

const baseUrl = "https://finance.naver.com/marketindex/exchangeDailyQuote.naver?marketindexCd=FX_USDKRW";
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

async function fetchRateByPage(page: number) {
  const response = await fetch(`${baseUrl}&page=${page}`);
  const html = await response.text();
  const $ = cheerio.load(html);

  const rows = $('table.tbl_exchange tbody tr');
  const result: { date: string; rate: number }[] = [];

  rows.each((_, el) => {
    const tds = $(el).find('td');
    const date = $(tds[0]).text().trim().replace(/\./g, '-');
    const rateStr = $(tds[1]).text().trim().replace(',', '');
    const rate = parseFloat(rateStr);

    if (date && !isNaN(rate)) {
      result.push({ date, rate });
    }
  });

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

  console.log(`오늘 날짜: ${today}`);
  console.log(`sinceDate: ${sinceDate}`);

  try {
    let rateHistory = await getRateHistory();
    let newHistory = { ...rateHistory };
    const lastAvailableDate = Object.keys(rateHistory).sort().pop();

    console.log(`lastAvailableDate: ${lastAvailableDate}`);

    if (!lastAvailableDate || new Date(lastAvailableDate) < new Date(today)) {
      let missingDates: string[] = [];
      let page = 1;
      let done = false;

      while (!done && page <= 100) {
        const rates = await fetchRateByPage(page);
        console.log(`페이지 ${page} 데이터:`, rates);

        if (rates.length === 0) break;

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

      const allDates = getAllDates(sinceDate, today);

      let prevRate: number | undefined = undefined;
      for (const date of allDates) {
        if (newHistory[date] == undefined) {
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
    }

    return NextResponse.json(newHistory);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "환율 데이터를 처리하지 못했습니다." }, { status: 500 });
  }
}