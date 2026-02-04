import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const STORAGE_BUCKET = "rate-history";
const EXCHANGE_RATE_PATH = "rate-history.json";
const STRATEGE_PATH = "analyze-strategy.json";
const KIMCHI_TRENDS_PATH = "kimchi-premium-trend.json";
const exchangeRateUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${EXCHANGE_RATE_PATH}`;
const strategyUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${STRATEGE_PATH}`;
const kimchiTrendsUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${KIMCHI_TRENDS_PATH}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 서비스 계정 키를 .env의 GOOGLE_CREDENTIALS에서 파싱
const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS!);
const PROJECT_ID = serviceAccount.project_id;

// 김치 프리미엄 트렌드 계산 함수들

async function calculateKimchiTrends(exchangeRate: number, targetDate: string): Promise<{ buyPrice: number, sellPrice: number } | null> {
  try {
    // kimchiTrendsUrl에서 직접 김치 프리미엄 트렌드 데이터 가져오기
    const trendResponse = await fetch(kimchiTrendsUrl);
    
    if (!trendResponse.ok) {
      console.warn('[monitoring] kimchiTrendsUrl에서 김치 프리미엄 트렌드 데이터를 가져올 수 없음');
      return null;
    }
    
    const trends = await trendResponse.json();
    
    if (!trends || Object.keys(trends).length === 0) {
      console.warn('[monitoring] 김치 프리미엄 트렌드 데이터가 없음');
      return null;
    }
    
    const targetDateTime = new Date(targetDate);
    const targetDateStr = targetDateTime.toISOString().split('T')[0];
    
    // 해당 날짜의 트렌드 데이터 찾기
    let trendData = trends[targetDateStr];
    
    // 정확한 날짜가 없으면 가장 가까운 이전 날짜 찾기
    if (!trendData) {
      const sortedDates = Object.keys(trends).sort().reverse();
      for (const dateStr of sortedDates) {
        const trendDate = new Date(dateStr);
        if (trendDate <= targetDateTime) {
          trendData = trends[dateStr];
          break;
        }
      }
    }
    
    if (!trendData) {
      console.warn('[monitoring] 해당 날짜의 김치 프리미엄 트렌드 데이터를 찾을 수 없음');
      return null;
    }
    
    // 동적 임계값으로 매수/매도 가격 계산
    const buyPrice = Number((exchangeRate * (1 + trendData.buy_threshold / 100)).toFixed(1));
    const sellPrice = Number((exchangeRate * (1 + trendData.sell_threshold / 100)).toFixed(1));
    
    console.log('[monitoring] 김치 프리미엄 트렌드 계산 (kimchiTrendsUrl):', {
      targetDate: targetDateStr,
      buyThreshold: trendData.buy_threshold,
      sellThreshold: trendData.sell_threshold,
      kimchiTrend: trendData.kimchi_trend,
      kimchiMA5: trendData.kimchi_ma5,
      buyPrice,
      sellPrice
    });
    
    return { buyPrice, sellPrice };
    
  } catch (error) {
    console.error('[monitoring] 김치 프리미엄 트렌드 계산 실패:', error);
    return null;
  }
}


export async function GET() {
  try {
    // 1. 업비트에서 USDT 가격 읽어오기
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

    // 2. 전략 파일에서 최근 전략 정보 읽기
    const stratRes = await fetch(strategyUrl);
    if (!stratRes.ok) {
      console.error('[monitoring] 전략 파일 조회 실패');
      return NextResponse.json({ error: '전략 파일 조회 실패' }, { status: 500 });
    }
    const stratList = await stratRes.json();

    // analysis_date 기준으로 가장 최근 전략 선택
    let latestStrategy = null;
    if (Array.isArray(stratList) && stratList.length > 0) {
      latestStrategy = stratList.reduce((latest, curr) => {
        return new Date(curr.analysis_date) > new Date(latest.analysis_date) ? curr : latest;
      }, stratList[0]);
    }

    // latestStrategy 전체 로깅 추가
    console.log('[monitoring] latestStrategy:', latestStrategy);

    if (!latestStrategy) {
      console.error('[monitoring] 최신 전략 데이터 없음');
      return NextResponse.json({ error: '최신 전략 데이터 없음' }, { status: 500 });
    }

    // 환율 히스토리 가져오기
    const exchangeRateData = await fetch(exchangeRateUrl).then(res => res.json());

    // 가장 최근 날짜의 환율을 구함
    const latestExchangeRateDate = Object.keys(exchangeRateData).sort().reverse()[0];
    const latestExchangeRate = exchangeRateData[latestExchangeRateDate];

    console.log('[monitoring] latestExchangeRate:', latestExchangeRate, 'date:', latestExchangeRateDate);

    var result = await sendPushMessagesIfneeded(latestStrategy, usdtPrice, latestExchangeRate);

    console.log('[monitoring] sendPushMessagesIfneeded result:', result);

    return NextResponse.json({
      usdtPrice,
      result,
      latestStrategyDate: latestStrategy.analysis_date,
      latestExchangeRateDate: latestExchangeRateDate,
    });
  } catch (err: any) {
    console.error('[monitoring] 예외 발생:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function sendPushMessagesIfneeded(latestStrategy: any, usdtPrice: any, latestExchangeRate: any) {
  console.log('[monitoring] sendPushMessagesIfneeded 호출:', { latestStrategy, usdtPrice, latestExchangeRate });
  // 1. Supabase에서 fcm_tokens 테이블의 토큰, user_data 목록 조회
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

  // 2. 서비스 계정으로 OAuth2 access_token 발급
  const jwtClient = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  await jwtClient.authorize();
  const accessToken = jwtClient.credentials.access_token;

  // 트렌드 추종 모드: 저장된 데이터 사용
  const trendData = await calculateKimchiTrends(latestExchangeRate, latestStrategy.analysis_date);
  console.log('[monitoring] trendData:', trendData);

  console.log('[monitoring] 푸시 전송 시작:', userTokens.length, '개 토큰');
  for (const user of userTokens) {
    const { token, user_data } = user;

    // user_data가 있을 경우 pushType에 따라 분기
    const { buyPrice, sellPrice, action, body } = await makeBody(latestStrategy, usdtPrice, latestExchangeRate, user_data, trendData);

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
        console.log(`[FCM] V1 푸시 전송 결과 (token: ${token}):`, '\n전송 메시지:', JSON.stringify(message, null, 2)); // 메시지 로깅 추가
      }
    } catch (e) {
      console.error(`[FCM] V1 푸시 전송 실패 (token: ${token}):`, e);
    }
  }

  return { success: true, details: null };
}

async function makeBody(latestStrategy: any, usdtPrice: any, latestExchangeRate: any, userData: any, trendData: any): Promise<{ buyPrice: any; sellPrice: any; action: any; body: any; }> {
  let buyPrice = null;
  let sellPrice = null;
  let action = '대기';
  let logic = 'AI 전략 분석';

  if (userData) {
    if (userData.pushType === 'ai') {
        logic = 'AI 전략 분석';
        buyPrice = Number(latestStrategy.buy_price);
        sellPrice = Number(latestStrategy.sell_price);

        if (usdtPrice <= buyPrice) {
          action = '매수';
        } else if (usdtPrice >= sellPrice) {
          action = '매도';
        } else {
          action = '대기';
        }
    } else if (userData.pushType === 'kimchi') {
      logic = '김치 프리미엄 분석';
      
        if (userData.useTrend === true && trendData !== null) {
          // 트렌드 데이터가 있으면 사용
          buyPrice = trendData.buyPrice;
          sellPrice = trendData.sellPrice;
        } else {
          // 기존 모드: 고정 백분율
          const buyPercent = Number(userData.gimchiBuyPercent ?? 0.5);
          const sellPercent = Number(userData.gimchiSellPercent ?? 2.5);
          buyPrice = Number((latestExchangeRate * (1 + buyPercent / 100)).toFixed(1));
          sellPrice = Number((latestExchangeRate * (1 + sellPercent / 100)).toFixed(1));
        }

      if (usdtPrice < buyPrice) {
        action = '매수';
      } else if (usdtPrice > sellPrice) {
        action = '매도';
      } else {
        action = '대기';
      }
    }
  } else {
    // userData가 없을 경우 기본 전략 사용
    logic = 'AI 전략 분석';
    buyPrice = Number(latestStrategy.buy_price);
    sellPrice = Number(latestStrategy.sell_price);

    if (usdtPrice <= buyPrice) {
      action = '매수';
    } else if (usdtPrice >= sellPrice) {
      action = '매도';
    } else {
      action = '대기';
    }
  }

  // 표시용 추천가 보정:
  // - 매수 추천가가 현재가보다 높으면, 실제로는 "현재가에 사는 것"이 합리적이므로 현재가로 표시
  // - 매도 추천가가 현재가보다 낮으면, 실제로는 "현재가에 파는 것"이 합리적이므로 현재가로 표시
  const displayBuyPrice = (action === '매수' && buyPrice != null)
    ? Math.min(Number(buyPrice), Number(usdtPrice))
    : buyPrice;

  const displaySellPrice = (action === '매도' && sellPrice != null)
    ? Math.max(Number(sellPrice), Number(usdtPrice))
    : sellPrice;

  let actionText = "";
  if (action === '대기') {
    actionText = `대기 중: ${buyPrice}원 ~ ${sellPrice}원`;
  } else if (action === '매수') {
    actionText = `매수 추천: ${displayBuyPrice}원`;
  } else if (action === '매도') {
    actionText = `매도 추천: ${displaySellPrice}원`;
  }

  const body = `${logic}\n${actionText}\n현재 USDT 가격: ${usdtPrice}원`;

  // 알림 payload(data)에서도 추천가를 동일하게 보정해 전달
  const finalBuyPrice = (action === '매수') ? displayBuyPrice : buyPrice;
  const finalSellPrice = (action === '매도') ? displaySellPrice : sellPrice;

  return { buyPrice: finalBuyPrice, sellPrice: finalSellPrice, action, body };
}

