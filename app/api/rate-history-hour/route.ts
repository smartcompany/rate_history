import { NextResponse } from 'next/server';
import {
  applySeriesMeta,
  assertSupabaseEnv,
  backfillCutoffMs,
  fetchStorageJson,
  kstHourString,
  kstStringToEpochMs,
  mergeSeriesAddOnly,
  uploadStorageJson,
  type HourlyPayload,
  type HourlySeriesEntry,
} from '../../../lib/hourlyArchive';

const SNAPSHOT_PATH = 'usd_krw_hour.json';
const ARCHIVE_PATH = 'usd_krw_hour_archive.json';
const YAHOO_SYMBOL = 'USDKRW=X';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function emptyArchive(): HourlyPayload {
  return {
    base: 'USD',
    target: 'KRW',
    start_date: '',
    end_date: '',
    time_unit: 'hour',
    source: 'yfinance',
    note: '시간봉 전체 누적 아카이브. 스냅샷(최근 구간 유지)을 계속 병합하고 과거는 Yahoo로 백필합니다.',
    series: [],
  };
}

/** Yahoo Finance v8 chart API에서 [fromMs, toMs) 구간 1시간봉 종가를 가져옵니다. */
async function fetchYahooHourly(fromMs: number, toMs: number): Promise<HourlySeriesEntry[]> {
  const period1 = Math.floor(fromMs / 1000);
  const period2 = Math.floor(toMs / 1000);
  if (period1 >= period2) return [];

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(YAHOO_SYMBOL)}` +
    `?period1=${period1}&period2=${period2}&interval=1h`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (rate-history backfill)' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[rate-history-hour] Yahoo fetch failed:', res.status, text.slice(0, 300));
    return [];
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];

  const entries: HourlySeriesEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || Number.isNaN(Number(close))) continue;
    const dtStr = kstHourString(timestamps[i] * 1000, 'T');
    if (seen.has(dtStr)) continue;
    seen.add(dtStr);
    entries.push({ datetime: dtStr, usd_krw: Math.round(Number(close) * 100) / 100 });
  }
  return entries;
}

export async function GET() {
  try {
    if (!assertSupabaseEnv()) {
      return NextResponse.json({ error: 'Server configuration missing' }, { status: 500 });
    }

    const [snapshot, storedArchive] = await Promise.all([
      fetchStorageJson(SNAPSHOT_PATH).catch((e) => {
        console.error('[rate-history-hour] snapshot fetch failed:', e);
        return null;
      }),
      fetchStorageJson(ARCHIVE_PATH).catch((e) => {
        console.error('[rate-history-hour] archive fetch failed:', e);
        return null;
      }),
    ]);

    if (!snapshot && !storedArchive) {
      return NextResponse.json({ error: 'Hourly rate snapshot not found' }, { status: 404 });
    }

    const archive = storedArchive ?? emptyArchive();
    const series: HourlySeriesEntry[] = Array.isArray(archive.series) ? archive.series : [];
    let added = 0;

    if (snapshot && Array.isArray(snapshot.series)) {
      added += mergeSeriesAddOnly(series, snapshot.series);
    }

    // 아카이브 시작 시점이 Yahoo 1h 제공 한도(약 730일)보다 뒤라면, 그 이전 구간을 백필합니다.
    const cutoffMs = backfillCutoffMs();
    const firstMs = series.length > 0 ? kstStringToEpochMs(series[0].datetime) : Date.now();
    if (firstMs - cutoffMs > 24 * 60 * 60 * 1000) {
      try {
        const backfilled = await fetchYahooHourly(cutoffMs, firstMs);
        const backfillAdded = mergeSeriesAddOnly(series, backfilled);
        added += backfillAdded;
        console.log('[rate-history-hour] Yahoo backfill:', backfillAdded, 'entries');
      } catch (e) {
        console.error('[rate-history-hour] Yahoo backfill failed:', e);
      }
    }

    if (series.length === 0) {
      return NextResponse.json({ error: 'Hourly rate snapshot not found' }, { status: 404 });
    }

    applySeriesMeta(archive, series);

    if (added > 0) {
      try {
        await uploadStorageJson(ARCHIVE_PATH, archive);
        console.log('[rate-history-hour] archive updated: +', added, 'entries, total', series.length);
      } catch (e) {
        console.error('[rate-history-hour] archive upload failed:', e);
      }
    }

    return NextResponse.json(archive);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
