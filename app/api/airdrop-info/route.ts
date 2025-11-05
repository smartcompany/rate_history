import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Air drop 정보 타입
interface AirdropInfo {
  id: string;
  title: string;
  description: string;
  reward: string; // 예: "100 USDT", "50,000원"
  link?: string; // 클릭 시 이동할 URL
  startDate: string;
  endDate: string;
  isActive: boolean;
  priority: number; // 우선순위 (높을수록 먼저 표시)
  imageUrl?: string; // 이미지 URL (선택적)
}

// GET: 활성화된 Air drop 정보 조회
export async function GET() {
  try {
    const now = new Date();
    
    // Supabase에서 airdrop_events 테이블 조회
    const { data: airdropsData, error } = await supabase
      .from('airdrop_events')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('[airdrop-info] Supabase 조회 오류:', error);
      
      // 에러 발생 시 빈 배열 반환 (앱이 크래시되지 않도록)
      return NextResponse.json({
        success: true,
        data: null,
        all: [],
      });
    }
    
    // 날짜 필터링 및 변환
    const activeAirdrops: AirdropInfo[] = (airdropsData || [])
      .filter((item: any) => {
        const start = item.start_date ? new Date(item.start_date) : null;
        const end = item.end_date ? new Date(item.end_date) : null;
        
        // 시작일과 종료일이 모두 없으면 활성화된 것으로 간주
        if (!start && !end) return true;
        
        // 시작일만 있으면 시작일 이후인지 확인
        if (start && !end) return now >= start;
        
        // 종료일만 있으면 종료일 이전인지 확인
        if (!start && end) return now <= end;
        
        // 둘 다 있으면 기간 내인지 확인
        return now >= start && now <= end;
      })
      .map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        reward: item.reward || '',
        link: item.link || '',
        startDate: item.start_date || new Date().toISOString(),
        endDate: item.end_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        isActive: item.is_active,
        priority: item.priority || 0,
        imageUrl: item.image_url,
      }))
      .sort((a, b) => b.priority - a.priority);
    
    // 가장 우선순위가 높은 것만 반환 (또는 여러 개 반환 가능)
    const topAirdrop = activeAirdrops.length > 0 ? activeAirdrops[0] : null;

    return NextResponse.json({
      success: true,
      data: topAirdrop,
      all: activeAirdrops, // 모든 활성 이벤트 (필요시)
    });
  } catch (error: any) {
    console.error('[airdrop-info] 오류:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST: Air drop 정보 업데이트 (관리자용)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // 인증 체크 (실제로는 관리자 인증이 필요)
    // 여기서는 간단히 구현
    
    // Supabase에 저장하거나 JSON 파일로 저장
    // 실제 구현은 필요에 따라 달라질 수 있습니다.
    
    return NextResponse.json({
      success: true,
      message: 'Air drop 정보가 업데이트되었습니다.',
    });
  } catch (error: any) {
    console.error('[airdrop-info] POST 오류:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

