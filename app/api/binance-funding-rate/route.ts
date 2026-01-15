import { NextResponse } from 'next/server';

const BINANCE_USDT_BASE_URL = 'https://fapi.binance.com';
const BINANCE_COIN_BASE_URL = 'https://dapi.binance.com';

function parsePositiveNumber(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function inferMarket(symbol: string, explicit?: string | null) {
  if (explicit) return explicit.toLowerCase();
  if (symbol.endsWith('USDT')) return 'usdt';
  if (symbol.endsWith('USD') || symbol.endsWith('USD_PERP')) return 'coin';
  return 'usdt';
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const market = inferMarket(symbol, searchParams.get('market'));
    const fundingIntervalHours = parsePositiveNumber(
      searchParams.get('fundingIntervalHours'),
      8
    );

    const baseUrl = market === 'coin' ? BINANCE_COIN_BASE_URL : BINANCE_USDT_BASE_URL;
    const url = new URL(`${baseUrl}/fapi/v1/premiumIndex`);
    if (market === 'coin') {
      url.pathname = '/dapi/v1/premiumIndex';
    }
    url.searchParams.set('symbol', symbol);

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Binance request failed: ${response.status} ${text}`);
    }

    const payload = await response.json();
    const data = Array.isArray(payload) ? payload[0] : payload;
    const fundingRateRaw = data?.lastFundingRate;
    const fundingRate = Number(fundingRateRaw);
    if (!Number.isFinite(fundingRate)) {
      throw new Error('Binance funding rate not available');
    }

    const fundingPerDay = 24 / fundingIntervalHours;
    const annualizedRate = fundingRate * fundingPerDay * 365;

    return NextResponse.json({
      symbol,
      market,
      fundingRate,
      fundingRatePercent: fundingRate * 100,
      fundingIntervalHours,
      annualizedRate,
      annualizedRatePercent: annualizedRate * 100,
      nextFundingTime: data?.nextFundingTime || null,
      retrievedAt: new Date().toISOString(),
      source: 'binance',
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

