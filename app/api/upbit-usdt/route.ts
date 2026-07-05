import { NextResponse } from "next/server";
import { fetchUpbitJson, upbitErrorResponse, UpbitError } from "../../../lib/upbit";

const UPBIT_USDT_URL =
  "https://api.upbit.com/v1/ticker?markets=KRW-USDT";

export async function GET() {
  try {
    // Upbit 쪽에서 CORS 처리를 하지 않기 때문에
    // 서버에서 대신 호출해서 그대로 JSON을 전달한다.
    const data = await fetchUpbitJson(UPBIT_USDT_URL, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof UpbitError) {
      // 점검 중이면 503 + UPBIT_MAINTENANCE 코드를 앱(main)으로 전달한다.
      return upbitErrorResponse(err);
    }
    console.error("[upbit-usdt] fetch failed", err);
    return NextResponse.json(
      { error: "Failed to fetch from Upbit" },
      { status: 500 },
    );
  }
}
