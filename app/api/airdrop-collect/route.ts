import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Airdrop 정보 타입
interface CollectedAirdrop {
  source: string; // 수집 소스 (예: 'coingecko', 'cryptorank', 'manual')
  title: string;
  description: string;
  reward?: string;
  link: string;
  startDate?: string;
  endDate?: string;
  requirements?: string[]; // 참여 요구사항
  token?: string; // 토큰 심볼 (예: 'USDT', 'BTC')
  value?: string; // 예상 가치
  participants?: number; // 참여자 수
  imageUrl?: string;
}

// CoinGecko API에서 Airdrop 정보 수집
async function collectFromCoinGecko(): Promise<{ airdrops: CollectedAirdrop[], logs: string[] }> {
  const airdrops: CollectedAirdrop[] = [];
  const logs: string[] = [];
  
  try {
    logs.push('[CoinGecko] 수집 시작');
    
    // CoinGecko에는 직접 airdrop API가 없으므로, 
    // 대신 최신 토큰/프로젝트 정보를 기반으로 추론하거나
    // 다른 소스와 조합하여 사용
    
    // 예시: 최신 토큰 리스트에서 신규 프로젝트 찾기
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=id_asc&per_page=50&page=1';
    logs.push(`[CoinGecko] API 호출: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    logs.push(`[CoinGecko] 응답 상태: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      logs.push(`[CoinGecko] 토큰 데이터 수신: ${data.length}개`);
      
      // 신규 토큰이 있을 경우 airdrop 가능성 체크
      // 실제로는 더 정교한 로직이 필요
      // 현재는 CoinGecko에서 직접 airdrop 정보를 제공하지 않으므로 빈 배열 반환
      logs.push('[CoinGecko] CoinGecko는 직접 airdrop API를 제공하지 않음. 스킵');
    } else {
      const errorText = await response.text().catch(() => '');
      logs.push(`[CoinGecko] API 호출 실패: ${response.status} - ${errorText.substring(0, 200)}`);
    }
  } catch (error: any) {
    logs.push(`[CoinGecko] 예외 발생: ${error.message || error}`);
    console.error('[airdrop-collect] CoinGecko 수집 실패:', error);
  }
  
  logs.push(`[CoinGecko] 수집 완료: ${airdrops.length}개`);
  return { airdrops, logs };
}

// CryptoRank나 다른 소스에서 수집
async function collectFromCryptoRank(): Promise<{ airdrops: CollectedAirdrop[], logs: string[] }> {
  const airdrops: CollectedAirdrop[] = [];
  const logs: string[] = [];
  
  try {
    logs.push('[CryptoRank] 수집 시작');
    
    // CryptoRank API 사용 (API 키 필요할 수 있음)
    // 또는 웹 크롤링
    const apiKey = process.env.CRYPTO_RANK_API_KEY;
    const url = `https://api.cryptorank.io/v1/airdrops?api_key=${apiKey}`;
    
    if (apiKey === 'YOUR_API_KEY') {
      logs.push('[CryptoRank] API 키가 설정되지 않음. 스킵');
      return { airdrops, logs };
    }
    
    logs.push(`[CryptoRank] API 호출: ${url.replace(apiKey, '***')}`);
    
    const response = await fetch(url);
    
    logs.push(`[CryptoRank] 응답 상태: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      logs.push(`[CryptoRank] 데이터 수신: ${JSON.stringify(data).substring(0, 200)}...`);
      
      // 데이터 파싱 및 변환
      if (data.data && Array.isArray(data.data)) {
        logs.push(`[CryptoRank] Airdrop 배열 발견: ${data.data.length}개`);
        
        for (const item of data.data) {
          const airdrop: CollectedAirdrop = {
            source: 'cryptorank',
            title: item.name || item.title || 'Airdrop',
            description: item.description || '',
            link: item.url || item.website || '',
            reward: item.reward || item.amount,
            startDate: item.startDate,
            endDate: item.endDate,
            token: item.token || item.symbol,
            imageUrl: item.image || item.logo,
          };
          
          if (airdrop.link) {
            airdrops.push(airdrop);
            logs.push(`[CryptoRank] Airdrop 추가: ${airdrop.title}`);
          } else {
            logs.push(`[CryptoRank] Link가 없는 항목 스킵: ${airdrop.title}`);
          }
        }
      } else {
        logs.push('[CryptoRank] data.data가 배열이 아니거나 없음');
      }
    } else {
      const errorText = await response.text().catch(() => '');
      logs.push(`[CryptoRank] API 호출 실패: ${response.status} - ${errorText.substring(0, 200)}`);
      
      if (response.status === 401) {
        logs.push('[CryptoRank] 인증 실패 - API 키를 확인하세요');
      }
    }
  } catch (error: any) {
    logs.push(`[CryptoRank] 예외 발생: ${error.message || error}`);
    console.error('[airdrop-collect] CryptoRank 수집 실패:', error);
  }
  
  logs.push(`[CryptoRank] 수집 완료: ${airdrops.length}개`);
  return { airdrops, logs };
}

// 웹 크롤링을 통한 수집 (예시: airdropalert.com 같은 사이트)
async function collectFromWeb(): Promise<{ airdrops: CollectedAirdrop[], logs: string[] }> {
  const airdrops: CollectedAirdrop[] = [];
  const logs: string[] = [];
  
  try {
    logs.push('[Web] 수집 시작');
    
    // 실제 웹 크롤링은 더 복잡하지만, 여기서는 예시만 제공
    // 실제 구현 시 cheerio나 puppeteer 사용 고려
    
    // 예시: RSS 피드나 API 엔드포인트가 있다면 사용
    // const response = await fetch('https://airdropalert.com/api/airdrops');
    
    logs.push('[Web] 웹 크롤링 수집 기능은 아직 구현되지 않음');
  } catch (error: any) {
    logs.push(`[Web] 예외 발생: ${error.message || error}`);
    console.error('[airdrop-collect] 웹 크롤링 실패:', error);
  }
  
  logs.push(`[Web] 수집 완료: ${airdrops.length}개`);
  return { airdrops, logs };
}

// 수집된 Airdrop을 Supabase에 저장
async function saveAirdropsToSupabase(airdrops: CollectedAirdrop[], logs: string[]): Promise<void> {
  if (airdrops.length === 0) {
    logs.push('[Supabase] 저장할 airdrop이 없습니다.');
    return;
  }
  
  logs.push(`[Supabase] ${airdrops.length}개의 airdrop 저장 시작`);

  try {
    // Supabase 테이블이 있어야 함 (airdrop_events 또는 similar)
    // 테이블 구조:
    // - id (uuid, primary key)
    // - source (text)
    // - title (text)
    // - description (text)
    // - reward (text, nullable)
    // - link (text)
    // - start_date (timestamp, nullable)
    // - end_date (timestamp, nullable)
    // - requirements (jsonb, nullable)
    // - token (text, nullable)
    // - value (text, nullable)
    // - participants (integer, nullable)
    // - image_url (text, nullable)
    // - is_active (boolean, default true)
    // - priority (integer, default 0)
    // - created_at (timestamp, default now)
    // - updated_at (timestamp, default now)
    // - unique constraint on (link, source) - 중복 방지

    for (const airdrop of airdrops) {
      try {
        // link가 비어있으면 스킵
        if (!airdrop.link || airdrop.link.trim() === '') {
          console.log(`[airdrop-collect] link가 없는 airdrop 스킵: ${airdrop.title}`);
          continue;
        }

        // 중복 체크: 동일한 link와 source가 이미 있으면 스킵
        const { data: existing, error: checkError } = await supabase
          .from('airdrop_events')
          .select('id')
          .eq('link', airdrop.link)
          .eq('source', airdrop.source)
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
          // PGRST116은 "not found" 에러이므로 정상. 다른 에러는 로그만 남기고 계속 진행
          console.error(`[airdrop-collect] 중복 체크 에러:`, checkError);
        }

        if (existing) {
          logs.push(`[Supabase] 중복 스킵: ${airdrop.title} (${airdrop.link})`);
          continue;
        }

        // 새로운 airdrop 삽입
        logs.push(`[Supabase] 새 항목 저장 시도: ${airdrop.title}`);
        const { error } = await supabase
          .from('airdrop_events')
          .insert({
            source: airdrop.source,
            title: airdrop.title,
            description: airdrop.description,
            reward: airdrop.reward || null,
            link: airdrop.link,
            start_date: airdrop.startDate ? new Date(airdrop.startDate).toISOString() : null,
            end_date: airdrop.endDate ? new Date(airdrop.endDate).toISOString() : null,
            requirements: airdrop.requirements || null,
            token: airdrop.token || null,
            value: airdrop.value || null,
            participants: airdrop.participants || null,
            image_url: airdrop.imageUrl || null,
            is_active: true,
            priority: 0, // 기본값, 나중에 수동 조정 가능
          });

        if (error) {
          logs.push(`[Supabase] 저장 실패: ${airdrop.title} - ${error.message || error.code || error}`);
          console.error(`[airdrop-collect] 저장 실패: ${airdrop.title}`, error);
        } else {
          logs.push(`[Supabase] 저장 성공: ${airdrop.title}`);
        }
      } catch (error: any) {
        logs.push(`[Supabase] 예외 발생: ${airdrop.title} - ${error.message || error}`);
        console.error(`[airdrop-collect] 개별 airdrop 저장 에러: ${airdrop.title}`, error);
      }
    }
  } catch (error: any) {
    logs.push(`[Supabase] 전체 저장 실패: ${error.message || error}`);
    console.error('[airdrop-collect] Supabase 저장 실패:', error);
    throw error;
  }
}

// 모든 소스에서 수집하는 메인 함수
async function collectAllAirdrops(): Promise<{ airdrops: CollectedAirdrop[], logs: string[] }> {
  const allLogs: string[] = [];
  allLogs.push('[전체] Airdrop 수집 시작...');
  
  const allAirdrops: CollectedAirdrop[] = [];
  
  // 여러 소스에서 병렬로 수집
  const [geckoResult, rankResult, webResult] = await Promise.all([
    collectFromCoinGecko(),
    collectFromCryptoRank(),
    collectFromWeb(),
  ]);
  
  // 로그 수집
  allLogs.push(...geckoResult.logs);
  allLogs.push(...rankResult.logs);
  allLogs.push(...webResult.logs);
  
  // Airdrop 수집
  allAirdrops.push(...geckoResult.airdrops, ...rankResult.airdrops, ...webResult.airdrops);
  
  allLogs.push(`[전체] 총 ${allAirdrops.length}개의 airdrop 수집 완료`);
  
  return { airdrops: allAirdrops, logs: allLogs };
}

// GET: Airdrop 수집 실행 (수동 또는 Cron)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === 'true';
    
    console.log('[airdrop-collect] GET 요청 수신');
    
    // Supabase 테이블 존재 여부 확인
    try {
      const { error: checkError } = await supabase
        .from('airdrop_events')
        .select('id')
        .limit(1);
      
      if (checkError && checkError.code === '42P01') {
        // 테이블이 없는 경우
        console.error('[airdrop-collect] airdrop_events 테이블이 없습니다. Supabase에서 테이블을 생성하세요.');
        return NextResponse.json(
          {
            success: false,
            error: 'airdrop_events 테이블이 없습니다. supabase-airdrop-table.sql을 실행하세요.',
            hint: 'Supabase Dashboard > SQL Editor에서 테이블 생성 SQL을 실행하세요.',
          },
          { status: 500 }
        );
      }
    } catch (checkErr) {
      console.error('[airdrop-collect] 테이블 체크 실패:', checkErr);
    }
    
    // 수집 실행
    const { airdrops, logs: collectLogs } = await collectAllAirdrops();
    
    // Supabase 저장 로그
    const saveLogs: string[] = [];
    saveLogs.push('[Supabase] 저장 시작');
    
    try {
      await saveAirdropsToSupabase(airdrops, saveLogs);
      saveLogs.push(`[Supabase] 저장 완료: ${airdrops.length}개 처리`);
    } catch (saveError: any) {
      saveLogs.push(`[Supabase] 저장 중 에러: ${saveError.message || saveError}`);
      throw saveError;
    }
    
    // 모든 로그 합치기
    const allLogs = [...collectLogs, ...saveLogs];
    
    // 콘솔에도 출력 (Vercel 로그에서 확인 가능)
    allLogs.forEach(log => console.log(log));
    
    return NextResponse.json({
      success: true,
      message: `Airdrop 수집 완료: ${airdrops.length}개`,
      collected: airdrops.length,
      details: airdrops.map(a => ({
        source: a.source,
        title: a.title,
        link: a.link,
      })),
      logs: allLogs, // 로그를 응답에 포함
    });
  } catch (error: any) {
    console.error('[airdrop-collect] GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

// POST: 수동으로 Airdrop 추가 (관리자용)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // 인증 체크 (실제로는 관리자 인증 필요)
    const { error } = await supabase
      .from('airdrop_events')
      .insert({
        source: 'manual',
        title: body.title,
        description: body.description,
        reward: body.reward || null,
        link: body.link || '',
        start_date: body.startDate ? new Date(body.startDate).toISOString() : null,
        end_date: body.endDate ? new Date(body.endDate).toISOString() : null,
        requirements: body.requirements || null,
        token: body.token || null,
        value: body.value || null,
        image_url: body.imageUrl || null,
        is_active: body.isActive !== undefined ? body.isActive : true,
        priority: body.priority || 0,
      });
    
    if (error) {
      throw error;
    }
    
    return NextResponse.json({
      success: true,
      message: 'Airdrop이 수동으로 추가되었습니다.',
    });
  } catch (error: any) {
    console.error('[airdrop-collect] POST 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}

