import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import {
  fxBlocksBuy,
  fxBlocksSell,
  kimchiTradingPrices,
  loadKimchiFxDeltaPayloadFromFile,
  type KimchiFxDeltaPayload,
} from '../../../lib/kimchiFxDelta';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const EXCHANGE_RATE_PATH = "rate-history.json";
const exchangeRateUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${EXCHANGE_RATE_PATH}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS!);
const PROJECT_ID = serviceAccount.project_id;

function resolvePushType(userData: any): 'kimchi' | 'off' {
  if (!userData) return 'off';
  const raw = userData.pushType;
  if (raw === 'kimchi' || raw === 'ai') return 'kimchi';
  return 'off';
}

export async function GET() {
  try {
    const upbitRes = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT');
    if (!upbitRes.ok) {
      console.error('[monitoring] 업비트 USDT 가격 조회 실패');
      return NextResponse.json({ error: '업비트 USDT 가격 조회 실패' }, { status: 500 });
    }
    const upbitData = await upbitRes.json();
    const usdtPrice = upbitData[0]?.trade_price;
    console.log('[monitoring] usdtPrice:', usdtPrice);
    if (!usdtPrice) {
      console.error('[monitoring] USDT 가격 데이터 없음');
      return NextResponse.json({ error: 'USDT 가격 데이터 없음' }, { status: 500 });
    }

    const exchangeRateData = await fetch(exchangeRateUrl).then(res => res.json());
    const latestExchangeRateDate = Object.keys(exchangeRateData).sort().reverse()[0];
    const latestExchangeRate = exchangeRateData[latestExchangeRateDate];

    console.log('[monitoring] latestExchangeRate:', latestExchangeRate, 'date:', latestExchangeRateDate);

    const result = await sendPushMessagesIfneeded(
      usdtPrice,
      latestExchangeRate,
      latestExchangeRateDate,
    );

    console.log('[monitoring] sendPushMessagesIfneeded result:', result);

    return NextResponse.json({
      usdtPrice,
      result,
      latestExchangeRateDate,
    });
  } catch (err: any) {
    console.error('[monitoring] 예외 발생:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function sendPushMessagesIfneeded(
  usdtPrice: any,
  latestExchangeRate: any,
  referenceDate: string,
) {
  console.log('[monitoring] sendPushMessagesIfneeded 호출:', { usdtPrice, latestExchangeRate, referenceDate });
  const kimchiFxDeltaBase = loadKimchiFxDeltaPayloadFromFile();
  const { data: tokensData, error } = await supabase
    .from('fcm_tokens')
    .select('token, user_data')
    .neq('token', null);

  if (error) {
    console.error('[FCM] 토큰 조회 실패:', error);
    return { error: '[FCM] 토큰 조회 실패:', details: error };
  }

  const userTokens: { token: string, user_data: any }[] = (tokensData ?? []).filter((row: any) => !!row.token);

  console.log('[monitoring] userTokens.length:', userTokens.length);

  if (userTokens.length === 0) {
    console.log('[FCM] 전송할 토큰이 없습니다.');
    return { error: '[FCM] 토큰 조회 실패:', details: '전송할 토큰이 없습니다.' };
  }

  const jwtClient = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  await jwtClient.authorize();
  const accessToken = jwtClient.credentials.access_token;

  console.log('[monitoring] 푸시 전송 시작:', userTokens.length, '개 토큰');
  for (const user of userTokens) {
    const { token, user_data } = user;

    const { buyPrice, sellPrice, action, body } = await makeBody(
      usdtPrice,
      latestExchangeRate,
      user_data,
      kimchiFxDeltaBase,
    );

    if (action === '대기') {
      console.log('[monitoring] 대기 상태, 푸시 전송 생략:', { token });
      continue;
    }

    const message = {
      message: {
        notification: {
          title: `USDT ${action} 시점 도달`,
          body: body,
        },
        data: {
          action: String(action),
          usdtPrice: String(usdtPrice),
          buyPrice: String(buyPrice),
          sellPrice: String(sellPrice),
        },
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
      if (result?.error?.details) {
        console.error(
          `[FCM] V1 푸시 전송 실패 (token: ${token}):`,
          JSON.stringify(result, null, 2)
        );
        const errorCodes = (result.error.details as any[]).map(d => d.errorCode);
        if (errorCodes.includes('UNREGISTERED') || errorCodes.includes('INVALID_ARGUMENT')) {
          await supabase.from('fcm_tokens').delete().eq('token', token);
          console.log(`[FCM] 무효 토큰 삭제: ${token}`);
        }
      } else {
        console.log(`[FCM] V1 푸시 전송 결과 (token: ${token}):`, '\n전송 메시지:', JSON.stringify(message, null, 2));
      }
    } catch (e) {
      console.error(`[FCM] V1 푸시 전송 실패 (token: ${token}):`, e);
    }
  }

  return { success: true, details: null };
}

async function makeBody(
  usdtPrice: any,
  latestExchangeRate: any,
  userData: any,
  kimchiFxDeltaBase: KimchiFxDeltaPayload | null,
): Promise<{ buyPrice: any; sellPrice: any; action: any; body: any; }> {
  let buyPrice = null;
  let sellPrice = null;
  let action = '대기';
  let logic = '김치 프리미엄 분석';

  if (resolvePushType(userData) === 'kimchi') {
    const { buyPrice: rawBuy, sellPrice: rawSell, deltaPp } = kimchiTradingPrices(
      Number(latestExchangeRate),
      userData,
      kimchiFxDeltaBase,
    );
    buyPrice = Number(rawBuy.toFixed(1));
    sellPrice = Number(rawSell.toFixed(1));
    if (userData.kimchiFxDeltaCorrection === true && deltaPp !== 0) {
      logic = `김치 프리미엄 분석 (환율 보정 Δ ${deltaPp.toFixed(2)}pp)`;
    }

    if (usdtPrice < buyPrice) {
      if (!fxBlocksBuy(Number(latestExchangeRate), userData)) {
        action = '매수';
      }
    } else if (usdtPrice > sellPrice) {
      if (!fxBlocksSell(Number(latestExchangeRate), userData)) {
        action = '매도';
      }
    } else {
      action = '대기';
    }
  }

  const displayBuyPrice = (action === '매수' && buyPrice != null)
    ? Math.min(Number(buyPrice), Number(usdtPrice))
    : buyPrice;

  const displaySellPrice = (action === '매도' && sellPrice != null)
    ? Math.max(Number(sellPrice), Number(usdtPrice))
    : sellPrice;

  let actionText = "";
  if (action === '대기') {
    actionText = buyPrice != null && sellPrice != null
      ? `대기 중: ${buyPrice}원 ~ ${sellPrice}원`
      : '대기 중';
  } else if (action === '매수') {
    actionText = `매수 추천: ${displayBuyPrice}원`;
  } else if (action === '매도') {
    actionText = `매도 추천: ${displaySellPrice}원`;
  }

  const body = `${logic}\n${actionText}\n현재 USDT 가격: ${usdtPrice}원`;

  const finalBuyPrice = (action === '매수') ? displayBuyPrice : buyPrice;
  const finalSellPrice = (action === '매도') ? displaySellPrice : sellPrice;

  return { buyPrice: finalBuyPrice, sellPrice: finalSellPrice, action, body };
}
