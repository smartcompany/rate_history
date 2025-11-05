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
async function collectFromCoinGecko(): Promise<CollectedAirdrop[]> {
  const airdrops: CollectedAirdrop[] = [];
  
  try {
    // CoinGecko에는 직접 airdrop API가 없으므로, 
    // 대신 최신 토큰/프로젝트 정보를 기반으로 추론하거나
    // 다른 소스와 조합하여 사용
    
    // 예시: 최신 토큰 리스트에서 신규 프로젝트 찾기
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=id_asc&per_page=50&page=1',
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      // 신규 토큰이 있을 경우 airdrop 가능성 체크
      // 실제로는 더 정교한 로직이 필요
      console.log('[airdrop-collect] CoinGecko에서 토큰 정보 수집:', data.length);
    }
  } catch (error) {
    console.error('[airdrop-collect] CoinGecko 수집 실패:', error);
  }
  
  return airdrops;
}

// CryptoRank나 다른 소스에서 수집
async function collectFromCryptoRank(): Promise<CollectedAirdrop[]> {
  const airdrops: CollectedAirdrop[] = [];
  
  try {
    // CryptoRank API 사용 (API 키 필요할 수 있음)
    // 또는 웹 크롤링
    const response = await fetch(
      'https://api.cryptorank.io/v1/airdrops?api_key=YOUR_API_KEY',
    );
    
    if (response.ok) {
      const data = await response.json();
      console.log('[airdrop-collect] CryptoRank에서 수집:', data);
      
      // 데이터 파싱 및 변환
      if (data.data && Array.isArray(data.data)) {
        for (const item of data.data) {
          airdrops.push({
            source: 'cryptorank',
            title: item.name || item.title || 'Airdrop',
            description: item.description || '',
            link: item.url || item.website || '',
            reward: item.reward || item.amount,
            startDate: item.startDate,
            endDate: item.endDate,
            token: item.token || item.symbol,
            imageUrl: item.image || item.logo,
          });
        }
      }
    }
  } catch (error) {
    console.error('[airdrop-collect] CryptoRank 수집 실패:', error);
  }
  
  return airdrops;
}

// 웹 크롤링을 통한 수집 (예시: airdropalert.com 같은 사이트)
async function collectFromWeb(): Promise<CollectedAirdrop[]> {
  const airdrops: CollectedAirdrop[] = [];
  
  try {
    // 실제 웹 크롤링은 더 복잡하지만, 여기서는 예시만 제공
    // 실제 구현 시 cheerio나 puppeteer 사용 고려
    
    // 예시: RSS 피드나 API 엔드포인트가 있다면 사용
    // const response = await fetch('https://airdropalert.com/api/airdrops');
    
    console.log('[airdrop-collect] 웹 크롤링 수집 (구현 필요)');
  } catch (error) {
    console.error('[airdrop-collect] 웹 크롤링 실패:', error);
  }
  
  return airdrops;
}

// 수집된 Airdrop을 Supabase에 저장
async function saveAirdropsToSupabase(airdrops: CollectedAirdrop[]): Promise<void> {
  if (airdrops.length === 0) {
    console.log('[airdrop-collect] 저장할 airdrop이 없습니다.');
    return;
  }

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
        // 중복 체크: 동일한 link와 source가 이미 있으면 스킵
        const { data: existing } = await supabase
          .from('airdrop_events')
          .select('id')
          .eq('link', airdrop.link)
          .eq('source', airdrop.source)
          .single();

        if (existing) {
          console.log(`[airdrop-collect] 중복 airdrop 스킵: ${airdrop.title} (${airdrop.link})`);
          continue;
        }

        // 새로운 airdrop 삽입
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
          console.error(`[airdrop-collect] 저장 실패: ${airdrop.title}`, error);
        } else {
          console.log(`[airdrop-collect] 저장 성공: ${airdrop.title}`);
        }
      } catch (error) {
        console.error(`[airdrop-collect] 개별 airdrop 저장 에러: ${airdrop.title}`, error);
      }
    }
  } catch (error) {
    console.error('[airdrop-collect] Supabase 저장 실패:', error);
    throw error;
  }
}

// 모든 소스에서 수집하는 메인 함수
async function collectAllAirdrops(): Promise<CollectedAirdrop[]> {
  console.log('[airdrop-collect] Airdrop 수집 시작...');
  
  const allAirdrops: CollectedAirdrop[] = [];
  
  // 여러 소스에서 병렬로 수집
  const [geckoAirdrops, rankAirdrops, webAirdrops] = await Promise.all([
    collectFromCoinGecko(),
    collectFromCryptoRank(),
    collectFromWeb(),
  ]);
  
  allAirdrops.push(...geckoAirdrops, ...rankAirdrops, ...webAirdrops);
  
  console.log(`[airdrop-collect] 총 ${allAirdrops.length}개의 airdrop 수집 완료`);
  
  return allAirdrops;
}

// GET: Airdrop 수집 실행 (수동 또는 Cron)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === 'true';
    
    console.log('[airdrop-collect] GET 요청 수신');
    
    // 수집 실행
    const airdrops = await collectAllAirdrops();
    
    // Supabase에 저장
    await saveAirdropsToSupabase(airdrops);
    
    return NextResponse.json({
      success: true,
      message: `Airdrop 수집 완료: ${airdrops.length}개`,
      collected: airdrops.length,
      details: airdrops.map(a => ({
        source: a.source,
        title: a.title,
        link: a.link,
      })),
    });
  } catch (error: any) {
    console.error('[airdrop-collect] GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
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

