import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { google } from 'googleapis';
import path from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const STRATEGE_PATH = "analyze-strategy.json";
const strategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${STRATEGE_PATH}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 서비스 계정 키 파일 경로 (예: 프로젝트 루트에 service-account.json)
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const PROJECT_ID = serviceAccount.project_id;

export async function GET() {
  try {
    // 1. 업비트에서 USDT 가격 읽어오기
    const upbitRes = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT');
    if (!upbitRes.ok) {
      return NextResponse.json({ error: '업비트 USDT 가격 조회 실패' }, { status: 500 });
    }
    const upbitData = await upbitRes.json();
    const usdtPrice = upbitData[0]?.trade_price;
    if (!usdtPrice) {
      return NextResponse.json({ error: 'USDT 가격 데이터 없음' }, { status: 500 });
    }

    // 2. 전략 파일에서 최근 전략 정보 읽기
    const stratRes = await fetch(strategyUrl);
    if (!stratRes.ok) {
      return NextResponse.json({ error: '전략 파일 조회 실패' }, { status: 500 });
    }
    const stratList = await stratRes.json();

    // analysis_date 기준으로 가장 최근 전략 선택
    let latestStrategy = null;
    if (Array.isArray(stratList) && stratList.length > 0) {
      latestStrategy = stratList.reduce((latest, curr) => {
        // analysis_date가 ISO 형식(YYYY-MM-DD 등)이라고 가정
        return new Date(curr.analysis_date) > new Date(latest.analysis_date) ? curr : latest;
      }, stratList[0]);
    }

    // latestStrategy 전체 로깅 추가
    console.log('[monitoring] latestStrategy:', latestStrategy);

    if (!latestStrategy) {
      return NextResponse.json({ error: '최신 전략 데이터 없음' }, { status: 500 });
    }

    const buyPrice = Number(latestStrategy.buy_price);
    const sellPrice = Number(latestStrategy.sell_price);

    // 3. 매수/매도 판단
    let action = '대기';
    if (usdtPrice < buyPrice) {
      action = '매수';
    } else if (usdtPrice > sellPrice) {
      action = '매도';
    }

    // 매수/매도 상태면 푸시 알림 전송
    if (action === '매수' || action === '매도') {
      // 예시: FCM 푸시 전송 함수 호출
      await sendPushToUsers({
        title: `USDT ${action} 시점 도달`,
        body: `현재 USDT 가격: ${usdtPrice}원 (${action} 추천가: ${action === '매수' ? buyPrice : sellPrice}원)`,
        data: { action, usdtPrice, buyPrice, sellPrice }
      });
    }

    return NextResponse.json({
      usdtPrice,
      buyPrice,
      sellPrice,
      action,
      latestStrategyDate: latestStrategy.analysis_date,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// FCM V1 푸시 전송 함수
async function sendPushToUsers({ title, body, data }: { title: string, body: string, data: any }) {
  // 1. Supabase에서 fcm_tokens 테이블의 토큰 목록 조회
  const { data: tokensData, error } = await supabase
    .from('fcm_tokens')
    .select('token')
    .neq('token', null);

  if (error) {
    console.error('[FCM] 토큰 조회 실패:', error);
    return;
  }

  const userTokens: string[] = (tokensData ?? []).map((row: any) => row.token).filter(Boolean);

  if (userTokens.length === 0) {
    console.log('[FCM] 전송할 토큰이 없습니다.');
    return;
  }

  // 2. 서비스 계정으로 OAuth2 access_token 발급
  const jwtClient = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  
  await jwtClient.authorize();
  const accessToken = jwtClient.credentials.access_token;

  // 3. 여러명에게 반복 전송
  for (const token of userTokens) {
    const message = {
      message: {
        notification: {
          title,
          body,
        },
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        token,
      }
    };

    try {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        }
      );
      const result = await res.json();
      // details가 있으면 JSON.stringify로 상세 출력
      if (result?.error?.details) {
        console.error(
          `[FCM] V1 푸시 전송 결과 (token: ${token}):`,
          JSON.stringify(result, null, 2)
        );
      } else {
        console.log(`[FCM] V1 푸시 전송 결과 (token: ${token}):`, result);
      }
    } catch (e) {
      console.error(`[FCM] V1 푸시 전송 실패 (token: ${token}):`, e);
    }
  }
}

