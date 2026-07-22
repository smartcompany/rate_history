import { NextResponse } from 'next/server';
import {
  applySeriesMeta,
  assertSupabaseEnv,
  fetchStorageJson,
  mergeSeriesAddOnly,
  trimToRecentDays,
  uploadStorageJson,
  type HourlyPayload,
  type HourlySeriesEntry,
} from '../../../lib/hourlyArchive';

const SNAPSHOT_PATH = 'usd_krw_hour.json';
const ARCHIVE_PATH = 'usd_krw_hour_archive.json';

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
    note: '시간봉 누적 아카이브. 스냅샷(최근 구간 유지)을 계속 병합해 데이터 유실을 막습니다.',
    series: [],
  };
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

    if (series.length === 0) {
      return NextResponse.json({ error: 'Hourly rate snapshot not found' }, { status: 404 });
    }

    // 아카이브에는 전체를 누적 저장하고, 응답은 최근 3달(90일)만 노출합니다.
    applySeriesMeta(archive, series);
    if (added > 0) {
      try {
        await uploadStorageJson(ARCHIVE_PATH, archive);
        console.log('[rate-history-hour] archive updated: +', added, 'entries, total', series.length);
      } catch (e) {
        console.error('[rate-history-hour] archive upload failed:', e);
      }
    }

    const recent = trimToRecentDays(series);
    const response: HourlyPayload = {
      ...archive,
      note: '최근 90일 시간봉입니다. 전체 데이터는 아카이브에 계속 누적됩니다.',
      series: recent,
    };
    applySeriesMeta(response, recent);

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
