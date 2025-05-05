import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY;
const STORAGE_BUCKET = "rate-history";
const FILE_PATH = "rate-history.json";

const baseUrl = "https://finance.naver.com/marketindex/exchangeDailyQuote.naver?marketindexCd=FX_USDKRW";
const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${FILE_PATH}`;
const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${FILE_PATH}`;

console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('SUPABASE_KEY:', process.env.NEXT_PUBLIC_SUPABASE_KEY);
console.log('STORAGE_BUCKET:', STORAGE_BUCKET);
console.log('STORAGE_URL:', storageUrl);

async function fetchTodayRate() {
  const response = await fetch(`${baseUrl}&page=1`);
  const html = await response.text();
  const $ = cheerio.load(html);

  const firstRow = $('table.tbl_exchange tbody tr').first();
  const tds = firstRow.find('td');

  const date = $(tds[0]).text().trim().replace(/\./g, '-');
  const rateStr = $(tds[1]).text().trim().replace(',', '');
  const rate = parseFloat(rateStr);

  if (date && !isNaN(rate)) {
    return { date, rate };
  } else {
    throw new Error('Failed to parse today rate');
  }
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
    console.log('url', response.url)
    throw new Error('Failed to upload JSON to Supabase');
  }
}

export default async function handler(req, res) {
  const today = new Date().toISOString().split('T')[0];

  try {
    let rateHistory = await getRateHistory();

    if (!rateHistory[today]) {
      console.log("오늘 데이터 없음. 업데이트 중...");
      const { date, rate } = await fetchTodayRate();
      rateHistory[date] = rate;
      await saveRateHistory(rateHistory);
    }

    res.status(200).json(rateHistory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "환율 데이터를 처리하지 못했습니다." });
  }
}