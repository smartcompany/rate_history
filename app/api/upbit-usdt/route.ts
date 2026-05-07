import { NextResponse } from "next/server";

const UPBIT_USDT_URL =
  "https://api.upbit.com/v1/ticker?markets=KRW-USDT";

export async function GET() {
  try {
    const res = await fetch(UPBIT_USDT_URL, {
      // Upbit 쪽에서 CORS 처리를 하지 않기 때문에
      // 서버에서 대신 호출해서 그대로 JSON을 전달한다.
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        "[upbit-usdt] upstream error",
        res.status,
        text.slice(0, 500),
      );
      return NextResponse.json(
        { error: "Upbit upstream error", status: res.status },
        { status: 502 },
      );
    }

    const body = await res.text();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("[upbit-usdt] fetch failed", err);
    return NextResponse.json(
      { error: "Failed to fetch from Upbit" },
      { status: 500 },
    );
  }
}

