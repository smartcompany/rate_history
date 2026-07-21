/**
 * 시간봉 스냅샷(usd_krw_hour.json / upbit_usdt_hour.json)은 업데이트 서버가
 * 최근 N일(rolling window)만 유지하며 덮어쓰기 때문에, 오래된 시간봉이 계속 유실됩니다.
 * 여기서는 별도 아카이브 파일(*_archive.json)에 스냅샷을 계속 병합해
 * 시간봉 데이터를 무제한 누적하고, 과거 구간은 원천 API(Yahoo/Upbit)로 백필합니다.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = 'rate-history';

export type HourlySeriesEntry = { datetime: string } & Record<string, unknown>;

export type HourlyPayload = {
  series: HourlySeriesEntry[];
  start_date?: string;
  end_date?: string;
} & Record<string, unknown>;

export function assertSupabaseEnv(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export async function fetchStorageJson(filePath: string): Promise<HourlyPayload | null> {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${filePath}`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY }, cache: 'no-store' });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage fetch failed (${filePath}): ${res.status} ${text}`);
  }
  const json = await res.json();
  if (!json || typeof json !== 'object') return null;
  return json as HourlyPayload;
}

export async function uploadStorageJson(filePath: string, data: unknown): Promise<void> {
  const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${filePath}`;
  // 아카이브는 수 MB까지 커질 수 있어 압축(비정형화) JSON으로 저장합니다.
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'x-upsert': 'true',
  };
  // 신규 객체는 POST, 기존 객체 교체는 PUT이므로 순서대로 시도합니다.
  let res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    res = await fetch(url, { method: 'PUT', headers, body });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage upload failed (${filePath}): ${res.status} ${text}`);
  }
}

/**
 * datetime 기준 add-only 병합. 이미 있는 시각은 건드리지 않습니다.
 * @returns 새로 추가된 개수
 */
export function mergeSeriesAddOnly(
  base: HourlySeriesEntry[],
  incoming: HourlySeriesEntry[],
): number {
  const existing = new Set(base.map((e) => e.datetime));
  let added = 0;
  for (const entry of incoming) {
    if (!entry || typeof entry.datetime !== 'string' || !entry.datetime) continue;
    if (existing.has(entry.datetime)) continue;
    existing.add(entry.datetime);
    base.push(entry);
    added++;
  }
  if (added > 0) {
    base.sort((a, b) => (a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0));
  }
  return added;
}

/** series 정렬 상태를 전제로 start_date / end_date 메타를 갱신합니다. */
export function applySeriesMeta(payload: HourlyPayload, series: HourlySeriesEntry[]): void {
  payload.series = series;
  if (series.length > 0) {
    payload.start_date = series[0].datetime.slice(0, 10);
    payload.end_date = series[series.length - 1].datetime.slice(0, 10);
  }
}

/** epoch(ms) → KST 기준 'YYYY-MM-DD{sep}HH:00:00' (분 이하 절삭) */
export function kstHourString(epochMs: number, sep: 'T' | ' '): string {
  const kst = new Date(epochMs + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  return `${y}-${m}-${d}${sep}${h}:00:00`;
}

/** 'YYYY-MM-DD[T ]HH:mm:ss' (KST) → epoch(ms) */
export function kstStringToEpochMs(datetime: string): number {
  const normalized = datetime.replace(' ', 'T');
  return new Date(`${normalized}+09:00`).getTime();
}

/** 원천 API가 시간봉을 제공하는 최대 과거 기간 (Yahoo 1h 한도인 730일보다 하루 여유) */
export const BACKFILL_MAX_DAYS = 729;

export function backfillCutoffMs(): number {
  return Date.now() - BACKFILL_MAX_DAYS * 24 * 60 * 60 * 1000;
}
