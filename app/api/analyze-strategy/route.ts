import { NextResponse } from 'next/server';

// 레거시 AI/추세 전략 제거. 클라이언트 호환용 빈 strategies 응답만 유지.
export async function GET() {
  return new Response(
    JSON.stringify({ strategies: [] }, null, 2),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
