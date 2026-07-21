import { NextResponse } from 'next/server';
import {
  applySeriesMeta,
  assertSupabaseEnv,
  backfillCutoffMs,
  fetchStorageJson,
  kstStringToEpochMs,
  mergeSeriesAddOnly,
  uploadStorageJson,
  type HourlyPayload,
  type HourlySeriesEntry,
} from '../../../lib/hourlyArchive';

const SNAPSHOT_PATH = 'upbit_usdt_hour.json';
const ARCHIVE_PATH = 'upbit_usdt_hour_archive.json';
const UPBIT_CANDLES_URL = 'https://api.upbit.com/v1/candles/minutes/60';
const MARKET = 'KRW-USDT';
const CANDLES_PER_REQUEST = 200;
/** 요청 1회당 Upbit 백필 호출 상한 (Vercel 함수 시간 제한 대비). 여러 요청에 걸쳐 점진 백필됩니다. */
const MAX_BACKFILL_CALLS_PER_REQUEST = 8;
const UPBIT_CALL_INTERVAL_MS = 120;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function emptyArchive(): HourlyPayload {
  return {
    market: MARKET,
    start_date: '',
    end_date: '',
    time_unit: 'hour',
    source: 'Upbit',
    note: '업비트 KRW-USDT 1시간봉 전체 누적 아카이브. 스냅샷(최근 구간 유지)을 계속 병합하고 과거는 Upbit API로 점진 백필합니다.',
    series: [],
  };
}

function candleToEntry(c: Record<string, unknown>): HourlySeriesEntry | null {
  const rawDt = (c.candle_date_time_kst || c.candle_date_time_utc || '') as string;
  const dt = rawDt.replace('T', ' ').slice(0, 19);
  if (!dt) return null;
  return {
    datetime: dt,
    timestamp_ms: c.timestamp,
    open: c.opening_price,
    high: c.high_price,
    low: c.low_price,
    close: Math.round(Number(c.trade_price || 0) * 100) / 100,
    volume: c.candle_acc_trade_volume,
  };
}

async function fetchUpbitCandles(toUtcIso: string | null): Promise<Record<string, unknown>[]> {
  let url = `${UPBIT_CANDLES_URL}?market=${MARKET}&count=${CANDLES_PER_REQUEST}`;
  if (toUtcIso) url += `&to=${encodeURIComponent(toUtcIso)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'rate-history-backfill/1.0' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upbit API ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || 'Upbit API error');
  return Array.isArray(data) ? data : [];
}

/**
 * 아카이브의 가장 오래된 시각 이전 구간을 Upbit에서 거꾸로 조회해 병합합니다.
 * 호출 횟수를 제한해 요청마다 조금씩 과거로 확장합니다.
 * @returns 추가된 개수
 */
async function backfillFromUpbit(series: HourlySeriesEntry[], cutoffMs: number): Promise<number> {
  let added = 0;
  for (let i = 0; i < MAX_BACKFILL_CALLS_PER_REQUEST; i++) {
    if (series.length === 0) break;
    const oldestMs = kstStringToEpochMs(series[0].datetime);
    if (oldestMs <= cutoffMs) break;

    if (i > 0) await new Promise((r) => setTimeout(r, UPBIT_CALL_INTERVAL_MS));
    const toUtcIso = new Date(oldestMs).toISOString().slice(0, 19);
    const candles = await fetchUpbitCandles(toUtcIso);
    if (candles.length === 0) break;

    const entries: HourlySeriesEntry[] = [];
    for (const c of candles) {
      const entry = candleToEntry(c);
      if (!entry) continue;
      if (kstStringToEpochMs(entry.datetime) < cutoffMs) continue;
      entries.push(entry);
    }
    const batchAdded = mergeSeriesAddOnly(series, entries);
    added += batchAdded;
    if (batchAdded === 0) break;
  }
  return added;
}

export async function GET() {
  try {
    if (!assertSupabaseEnv()) {
      return NextResponse.json({ error: 'Server configuration missing' }, { status: 500 });
    }

    const [snapshot, storedArchive] = await Promise.all([
      fetchStorageJson(SNAPSHOT_PATH).catch((e) => {
        console.error('[usdt-history-hour] snapshot fetch failed:', e);
        return null;
      }),
      fetchStorageJson(ARCHIVE_PATH).catch((e) => {
        console.error('[usdt-history-hour] archive fetch failed:', e);
        return null;
      }),
    ]);

    if (!snapshot && !storedArchive) {
      return NextResponse.json({ error: 'Hourly USDT snapshot not found' }, { status: 404 });
    }

    const archive = storedArchive ?? emptyArchive();
    const series: HourlySeriesEntry[] = Array.isArray(archive.series) ? archive.series : [];
    let added = 0;

    if (snapshot && Array.isArray(snapshot.series)) {
      added += mergeSeriesAddOnly(series, snapshot.series);
    }

    const cutoffMs = backfillCutoffMs();
    const firstMs = series.length > 0 ? kstStringToEpochMs(series[0].datetime) : Date.now();
    if (firstMs - cutoffMs > 24 * 60 * 60 * 1000) {
      try {
        const backfillAdded = await backfillFromUpbit(series, cutoffMs);
        added += backfillAdded;
        console.log('[usdt-history-hour] Upbit backfill:', backfillAdded, 'entries');
      } catch (e) {
        console.error('[usdt-history-hour] Upbit backfill failed:', e);
      }
    }

    if (series.length === 0) {
      return NextResponse.json({ error: 'Hourly USDT snapshot not found' }, { status: 404 });
    }

    applySeriesMeta(archive, series);

    if (added > 0) {
      try {
        await uploadStorageJson(ARCHIVE_PATH, archive);
        console.log('[usdt-history-hour] archive updated: +', added, 'entries, total', series.length);
      } catch (e) {
        console.error('[usdt-history-hour] archive upload failed:', e);
      }
    }

    return NextResponse.json(archive);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
