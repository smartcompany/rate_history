import { NextResponse } from 'next/server';

const BYBIT_BASE_URL = 'https://api.bybit.com';

function parsePositiveNumber(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function inferCategory(symbol: string, explicit?: string | null) {
  if (explicit) return explicit.toLowerCase();
  if (symbol.endsWith('USDT')) return 'linear';
  if (symbol.endsWith('USD')) return 'inverse';
  return 'linear';
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const category = inferCategory(symbol, searchParams.get('category'));
    const fundingIntervalHours = parsePositiveNumber(
      searchParams.get('fundingIntervalHours'),
      8
    );

    const url = new URL(`${BYBIT_BASE_URL}/v5/market/tickers`);
    url.searchParams.set('category', category);
    url.searchParams.set('symbol', symbol);

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bybit request failed: ${response.status} ${text}`);
    }

    const payload = await response.json();
    const list = payload?.result?.list;
    const ticker = Array.isArray(list) ? list[0] : null;
    const fundingRateRaw = ticker?.fundingRate;

    const fundingRate = Number(fundingRateRaw);
    if (!Number.isFinite(fundingRate)) {
      throw new Error('Bybit funding rate not available');
    }

    const fundingPerDay = 24 / fundingIntervalHours;
    const annualizedRate = fundingRate * fundingPerDay * 365;

    return NextResponse.json({
      symbol,
      category,
      fundingRate,
      fundingRatePercent: fundingRate * 100,
      fundingIntervalHours,
      annualizedRate,
      annualizedRatePercent: annualizedRate * 100,
      nextFundingTime: ticker?.nextFundingTime || null,
      retrievedAt: new Date().toISOString(),
      source: 'bybit',
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

