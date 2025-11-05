-- Supabase에 airdrop_events 테이블 생성 SQL
-- Supabase Dashboard > SQL Editor에서 실행하세요

CREATE TABLE IF NOT EXISTS airdrop_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL, -- 'coingecko', 'cryptorank', 'manual', etc.
  title TEXT NOT NULL,
  description TEXT,
  reward TEXT,
  link TEXT NOT NULL,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  requirements JSONB, -- 참여 요구사항 배열
  token TEXT, -- 토큰 심볼 (예: 'USDT', 'BTC')
  value TEXT, -- 예상 가치
  participants INTEGER, -- 참여자 수
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 중복 방지를 위한 유니크 제약조건
-- (동일한 link와 source 조합은 중복 불가)
CREATE UNIQUE INDEX IF NOT EXISTS airdrop_events_link_source_unique 
ON airdrop_events(link, source);

-- 인덱스 추가 (조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_airdrop_events_active 
ON airdrop_events(is_active, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_airdrop_events_dates 
ON airdrop_events(start_date, end_date);

-- updated_at 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 트리거 생성
DROP TRIGGER IF EXISTS update_airdrop_events_updated_at ON airdrop_events;
CREATE TRIGGER update_airdrop_events_updated_at
  BEFORE UPDATE ON airdrop_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) 설정 (선택적)
-- 외부 접근을 허용하려면 아래 주석을 해제하세요
-- ALTER TABLE airdrop_events ENABLE ROW LEVEL SECURITY;

-- 공개 읽기 정책 (모든 사용자가 읽을 수 있도록)
-- CREATE POLICY "Allow public read access" ON airdrop_events
--   FOR SELECT
--   USING (true);

-- 관리자 쓰기 정책 (인증된 사용자만 쓸 수 있도록)
-- CREATE POLICY "Allow admin write access" ON airdrop_events
--   FOR INSERT, UPDATE, DELETE
--   USING (auth.role() = 'authenticated');

