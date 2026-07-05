import { NextResponse } from 'next/server';

/**
 * 업비트 API 호출 실패를 나타내는 에러.
 * isMaintenance가 true이면 업비트 서버 점검(또는 장애)으로 판단된 경우다.
 */
export class UpbitError extends Error {
  readonly isMaintenance: boolean;
  readonly status: number | null;

  constructor(message: string, options: { isMaintenance?: boolean; status?: number | null } = {}) {
    super(message);
    this.name = 'UpbitError';
    this.isMaintenance = options.isMaintenance ?? false;
    this.status = options.status ?? null;
  }
}

const MAINTENANCE_KEYWORDS = ['점검', 'maintenance', 'server_error', 'unavailable'];

function looksLikeMaintenanceBody(text: string): boolean {
  const lowered = text.toLowerCase();
  return MAINTENANCE_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

/**
 * 업비트 API를 호출하고 점검/장애 상황을 감지한다.
 *
 * 다음의 경우 점검으로 판단하여 UpbitError(isMaintenance: true)를 던진다.
 * - HTTP 5xx 응답 (점검 시 업비트는 502/503 등을 반환)
 * - JSON 대신 HTML(점검 안내 페이지)이 내려오는 경우
 * - 응답 본문에 점검 관련 키워드가 포함된 경우
 * - 네트워크 연결 자체가 실패한 경우
 *
 * 성공 시 파싱된 JSON을 반환한다.
 */
export async function fetchUpbitJson(url: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err: any) {
    console.error('[upbit] 네트워크 오류 (점검 가능성):', url, err?.message ?? err);
    throw new UpbitError('업비트 서버에 연결할 수 없습니다. (점검 중일 수 있습니다)', {
      isMaintenance: true,
    });
  }

  const text = await res.text();

  if (!res.ok) {
    const maintenance = res.status >= 500 || looksLikeMaintenanceBody(text);
    console.error('[upbit] 응답 오류:', url, res.status, text.slice(0, 300));
    throw new UpbitError(
      maintenance
        ? '업비트 서버가 점검 중입니다.'
        : `업비트 API 오류 (status: ${res.status})`,
      { isMaintenance: maintenance, status: res.status },
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    // 200이지만 JSON이 아닌 경우 → 점검 안내 HTML 페이지일 가능성이 높다.
    console.error('[upbit] JSON 파싱 실패 (점검 페이지 가능성):', url, text.slice(0, 300));
    throw new UpbitError('업비트 서버가 점검 중입니다. (비정상 응답)', {
      isMaintenance: true,
      status: res.status,
    });
  }
}

/**
 * UpbitError를 클라이언트(main)에 전달할 HTTP 응답으로 변환한다.
 *
 * 점검 중이면: 503 + { error: 'UPBIT_MAINTENANCE', message: '...' }
 * 그 외 업비트 오류면: 502 + { error: 'UPBIT_ERROR', message: '...' }
 *
 * 클라이언트는 error === 'UPBIT_MAINTENANCE' (또는 status 503)를 확인해서
 * "업비트 점검 중" 알림을 표시하면 된다.
 */
export function upbitErrorResponse(err: UpbitError) {
  if (err.isMaintenance) {
    return NextResponse.json(
      {
        error: 'UPBIT_MAINTENANCE',
        message: '업비트 서버 점검 중입니다. 점검이 끝난 후 다시 시도해 주세요.',
        upstreamStatus: err.status,
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      error: 'UPBIT_ERROR',
      message: err.message,
      upstreamStatus: err.status,
    },
    { status: 502 },
  );
}
