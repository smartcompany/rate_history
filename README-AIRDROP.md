# Airdrop 수집 시스템

코인 airdrop 이벤트를 자동으로 수집하고 관리하는 시스템입니다.

## 기능

1. **자동 수집**: 다양한 소스에서 airdrop 정보를 자동으로 수집
2. **Supabase 저장**: 수집된 데이터를 Supabase 데이터베이스에 저장
3. **중복 방지**: 동일한 link와 source 조합은 자동으로 필터링
4. **주기적 실행**: Cron job을 통해 정기적으로 수집 실행
5. **API 제공**: Flutter 앱에서 활성 airdrop 정보 조회 가능

## 설정 방법

### 1. Supabase 테이블 생성

Supabase Dashboard > SQL Editor에서 `supabase-airdrop-table.sql` 파일의 내용을 실행하세요.

```sql
-- 파일 내용 실행
```

### 2. 환경 변수 설정

`.env` 파일에 다음 환경 변수가 설정되어 있는지 확인하세요:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_KEY=your_supabase_key
```

### 3. API 키 설정 (선택적)

일부 소스(예: CryptoRank)에서는 API 키가 필요할 수 있습니다. `server/app/api/airdrop-collect/route.ts`에서 설정하세요.

## API 엔드포인트

### GET /api/airdrop-collect

Airdrop 수집을 실행합니다.

**사용 예시:**
```bash
curl https://your-domain.com/api/airdrop-collect
```

**응답:**
```json
{
  "success": true,
  "message": "Airdrop 수집 완료: 5개",
  "collected": 5,
  "details": [
    {
      "source": "cryptorank",
      "title": "Project A Airdrop",
      "link": "https://..."
    }
  ]
}
```

### GET /api/airdrop-info

활성화된 airdrop 정보를 조회합니다. (Flutter 앱에서 사용)

**응답:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "title": "...",
    "description": "...",
    "reward": "...",
    "link": "...",
    ...
  },
  "all": [...]
}
```

### POST /api/airdrop-info

수동으로 airdrop을 추가합니다. (관리자용)

**요청 본문:**
```json
{
  "title": "이벤트 제목",
  "description": "설명",
  "reward": "보상",
  "link": "https://...",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "priority": 10,
  "isActive": true
}
```

## Cron Job 설정

### Vercel Cron (자동)

`vercel.json`에 다음 설정이 포함되어 있습니다:

```json
{
  "crons": [
    {
      "path": "/api/airdrop-collect",
      "schedule": "0 */6 * * *"  // 6시간마다 실행
    }
  ]
}
```

### GitHub Actions (수동/백업)

`.github/workflows/cron.yml`에 추가되어 있어, GitHub Actions를 통해서도 실행할 수 있습니다.

## 수집 소스

현재 구현된 수집 소스:

1. **CoinGecko**: 최신 토큰 정보 수집 (기본 구조만 구현)
2. **CryptoRank**: Airdrop API 사용 (API 키 필요)
3. **웹 크롤링**: 추후 구현 예정

### 새로운 소스 추가 방법

`server/app/api/airdrop-collect/route.ts`의 `collectAllAirdrops()` 함수에 새로운 수집 함수를 추가하세요:

```typescript
async function collectFromNewSource(): Promise<CollectedAirdrop[]> {
  const airdrops: CollectedAirdrop[] = [];
  // 수집 로직 구현
  return airdrops;
}

// collectAllAirdrops()에서 호출
const [geckoAirdrops, rankAirdrops, webAirdrops, newAirdrops] = await Promise.all([
  collectFromCoinGecko(),
  collectFromCryptoRank(),
  collectFromWeb(),
  collectFromNewSource(), // 추가
]);
```

## 데이터 구조

### airdrop_events 테이블

| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | 고유 ID |
| source | TEXT | 수집 소스 |
| title | TEXT | 제목 |
| description | TEXT | 설명 |
| reward | TEXT | 보상 정보 |
| link | TEXT | 참여 링크 |
| start_date | TIMESTAMPTZ | 시작일 |
| end_date | TIMESTAMPTZ | 종료일 |
| requirements | JSONB | 참여 요구사항 |
| token | TEXT | 토큰 심볼 |
| value | TEXT | 예상 가치 |
| participants | INTEGER | 참여자 수 |
| image_url | TEXT | 이미지 URL |
| is_active | BOOLEAN | 활성화 여부 |
| priority | INTEGER | 우선순위 |
| created_at | TIMESTAMPTZ | 생성일 |
| updated_at | TIMESTAMPTZ | 수정일 |

## 문제 해결

### 테이블이 없는 경우

Supabase Dashboard에서 `supabase-airdrop-table.sql`의 내용을 실행하세요.

### 수집이 안 되는 경우

1. API 키가 올바른지 확인
2. 네트워크 연결 확인
3. Supabase 권한 확인
4. 로그 확인 (Vercel Dashboard 또는 콘솔)

### 중복 데이터

`link`와 `source` 조합이 동일하면 자동으로 스킵됩니다.

## 향후 개선 사항

- [ ] 더 많은 수집 소스 추가
- [ ] 웹 크롤링 구현 (Cheerio, Puppeteer)
- [ ] 텔레그램 봇 연동
- [ ] 이메일 알림 기능
- [ ] Airdrop 검증 및 필터링 개선
- [ ] 관리자 대시보드

