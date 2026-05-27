# VN KPI 배포 가이드

전체 소요 시간: 약 30분

## 1. Supabase 프로젝트 생성 (5분)

1. https://supabase.com 접속 → "Start your project" → GitHub로 가입
2. 새 프로젝트 만들기:
   - Name: `vn-kpi`
   - Database Password: 안전한 비밀번호 (저장해둘 것)
   - Region: `Northeast Asia (Seoul)` 선택
3. 프로젝트 생성 대기 (~2분)

## 2. 데이터베이스 스키마 생성 (2분)

1. 좌측 메뉴 → SQL Editor → New query
2. `schema.sql` 파일 내용 전체 복사 → 붙여넣기
3. 우측 하단 RUN 클릭
4. "Success. No rows returned" 메시지 확인

## 3. 인증 설정 (3분)

1. 좌측 메뉴 → Authentication → Providers
2. **Email** provider:
   - Enable email confirmations: **OFF** (팀 내부용이라 즉시 사용)
   - Save

## 4. 사용자 등록 (5분)

1. Authentication → Users → "Add user" → "Create new user"
2. 팀원 이메일 + 임시 비밀번호로 각각 추가:
   - ceo_office@likelion.net (김슬기)
   - 남영훈 이메일
   - 김호현 이메일
   - 튀띤 이메일
   - 이정애 이메일
3. 각 팀원에게 본인 이메일 + 임시 비밀번호 공유 (로그인 후 비번 변경 안내)

## 5. 어드민 권한 부여 (2분)

SQL Editor에서:
```sql
-- 김슬기 = admin
UPDATE profiles SET role = 'admin', name = '김슬기'
WHERE email = 'ceo_office@likelion.net';

-- 남영훈 = manager (목표 편집 가능)
UPDATE profiles SET role = 'manager', name = '남영훈'
WHERE email = '남영훈_이메일@...';

-- 나머지는 기본 'member' (매칭/프로젝트 추가만 가능)
```

## 6. API 키 가져오기 (1분)

1. 좌측 메뉴 → Settings (⚙️) → API
2. 두 값 복사:
   - **Project URL**: `https://xxxxxxxx.supabase.co`
   - **anon public key**: `eyJhbGc...` (긴 토큰)

## 7. index.html 에 키 입력 (1분)

`index.html` 상단의 `<script>` 부분에서 두 줄 찾아 교체:

```js
const SUPABASE_URL = 'PASTE_YOUR_PROJECT_URL';
const SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_KEY';
```

## 8. Vercel 배포 (5분)

### 옵션 A: Vercel CLI (가장 빠름)

```bash
npm i -g vercel
cd /Users/kee/Documents/pmtool
vercel
```
→ 질문에 모두 Enter (기본값) → 배포 URL 받음

### 옵션 B: GitHub 연동 (권장 - 자동 배포)

1. GitHub에 새 repo 만들기 (private)
2. 로컬에서:
```bash
cd /Users/kee/Documents/pmtool
git init
git add .
git commit -m "Initial deploy"
git branch -M main
git remote add origin https://github.com/USERNAME/vn-kpi.git
git push -u origin main
```
3. https://vercel.com → "Add New Project" → GitHub repo 선택 → Deploy
4. 배포 완료 (~30초). URL 받음 (e.g., `vn-kpi.vercel.app`)

### 도메인 (선택)

Vercel 프로젝트 → Settings → Domains → `kpi.likelion.net` 등 추가 가능

## 9. 팀에 공유

배포된 URL + 각자의 임시 비밀번호 공유 (Slack DM)

```
🚀 VN KPI 대시보드 오픈

URL: https://vn-kpi.vercel.app
이메일: 본인 회사 이메일
임시 비밀번호: (개별 DM)

로그인 후 우측 상단에서 비밀번호 변경 부탁드립니다.
어드민(김슬기)·매니저(남영훈)는 주간 목표 설정 가능,
팀원은 매칭 추가/수정 가능합니다.
```

## 비용

- Supabase Free Tier: 500MB DB, 50,000 MAU, 2GB 대역폭/월 → 10명 팀에 평생 무료
- Vercel Hobby: 100GB 대역폭/월 → 충분
- **합계: ₩0/월**

## 데이터 백업

Supabase에서 자동으로 7일 PITR (Point-in-Time Recovery). 
수동 백업: Settings → Database → Backups → Download.

## 문제 발생 시

- 로그인 안됨 → Authentication → Users 에서 사용자 확인
- 데이터 안 보임 → SQL Editor 에서 `SELECT * FROM matches` 직접 조회
- 권한 없음 에러 → `profiles` 테이블에서 role 확인
