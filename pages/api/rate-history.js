import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY;
const STORAGE_BUCKET = "rate-history";
const FILE_PATH = "rate-history.json";

const baseUrl = "https://finance.naver.com/marketindex/exchangeDailyQuote.naver?marketindexCd=FX_USDKRW";
const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${FILE_PATH}`;
const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${FILE_PATH}`;

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function fetchRateByPage(page) {
  const response = await fetch(`${baseUrl}&page=${page}`);
  const html = await response.text();
  const $ = cheerio.load(html);

  const rows = $('table.tbl_exchange tbody tr');
  const result = [];

  rows.each((i, el) => {
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

async function saveRateHistory(data) {
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

export default async function handler(req, res) {
  const { days = 1 } = req.query;
  const today = formatDate(new Date());
  const sinceDate = formatDate(getDateNDaysAgo(Number(days)));

  try {
    let rateHistory = await getRateHistory();
    const newHistory = { ...rateHistory };

    let missingDates = [];
    const lastAvailableDate = Object.keys(rateHistory).sort().pop();

    if (!lastAvailableDate || lastAvailableDate < sinceDate) {
      let page = 1;
      let done = false;

      while (!done && page <= 30) {
        const rates = await fetchRateByPage(page);
        if (rates.length === 0) break;

        for (const { date, rate } of rates) {
          if (newHistory[date]) continue;
          if (date < sinceDate) {
            done = true;
            break;
          }
          newHistory[date] = rate;
          missingDates.push(date);
        }

        page += 1;
      }

      if (missingDates.length > 0) {
        await saveRateHistory(newHistory);
        console.log(`추가된 날짜 수: ${missingDates.length}`);
      }
    }

    // 필요한 기간만 추출해서 응답
    const result = {};
    const allDates = Object.keys(newHistory).sort().reverse();
    for (const date of allDates) {
      if (date >= sinceDate) {
        result[date] = newHistory[date];
      }
    }

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "환율 데이터를 처리하지 못했습니다." });
  }
}