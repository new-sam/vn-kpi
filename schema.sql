-- VN KPI 데이터베이스 스키마
-- Supabase SQL Editor에 그대로 붙여넣고 RUN

-- =====================================================
-- 1. PROFILES (사용자 + 권한)
-- =====================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 회원가입 시 자동으로 profiles row 생성
-- search_path 명시 + 예외 처리로 trigger 실패해도 가입은 성공하게
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'member')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 권한 보장
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated, service_role;

-- =====================================================
-- 2. SETTINGS (단일 row, 어드민만 수정)
-- =====================================================
CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  annual_match_target INT DEFAULT 200,
  month_target BIGINT DEFAULT 5000000,
  project_start DATE DEFAULT '2026-04-01',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 3. MATCHES (KTC 인재 매칭)
-- =====================================================
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT,
  source TEXT NOT NULL CHECK (source IN ('웍스피어', '자체발굴')),
  stage TEXT NOT NULL CHECK (stage IN ('lead', 'submitted', 'interview', 'confirmed', 'dropped')),
  satisfaction NUMERIC(2,1),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
CREATE INDEX IF NOT EXISTS idx_matches_stage ON matches(stage);

-- =====================================================
-- 4. PROJECTS (신사업)
-- =====================================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icon TEXT DEFAULT '✨',
  name TEXT NOT NULL,
  owner TEXT,
  hypothesis TEXT,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  deadline DATE,
  target_revenue BIGINT DEFAULT 1000000,
  actual_revenue BIGINT DEFAULT 0,
  status TEXT DEFAULT 'normal' CHECK (status IN ('normal', 'review', 'danger', 'delayed')),
  subtasks JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_projects_year_month ON projects(year, month);

-- =====================================================
-- 5. WEEK_TARGETS (어드민이 설정하는 주차별 목표)
-- =====================================================
CREATE TABLE IF NOT EXISTS week_targets (
  year INT NOT NULL,
  week INT NOT NULL CHECK (week BETWEEN 1 AND 53),
  target INT DEFAULT 0,
  PRIMARY KEY (year, week)
);

-- =====================================================
-- 6. MONTH_ARCHIVE (지난달 매출 기록)
-- =====================================================
CREATE TABLE IF NOT EXISTS month_archive (
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  revenue BIGINT DEFAULT 0,
  PRIMARY KEY (year, month)
);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE month_archive ENABLE ROW LEVEL SECURITY;

-- Helper: is current user admin?
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'manager')
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- profiles: 모두 read, 본인 update, admin은 권한 변경 가능
CREATE POLICY "auth users read profiles" ON profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "admin update any profile" ON profiles FOR UPDATE USING (is_admin());

-- settings: 모두 read, admin/manager만 update
CREATE POLICY "auth users read settings" ON settings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin update settings" ON settings FOR UPDATE USING (is_admin());

-- matches: 모두 read/insert, 본인이 만든 것만 update/delete (admin은 전체)
CREATE POLICY "auth users read matches" ON matches FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth users insert matches" ON matches FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "owner or admin update matches" ON matches FOR UPDATE
  USING (created_by = auth.uid() OR is_admin());
CREATE POLICY "owner or admin delete matches" ON matches FOR DELETE
  USING (created_by = auth.uid() OR is_admin());

-- projects: 모두 read/insert, 본인 또는 admin만 update/delete
CREATE POLICY "auth users read projects" ON projects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth users insert projects" ON projects FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "owner or admin update projects" ON projects FOR UPDATE
  USING (created_by = auth.uid() OR is_admin());
CREATE POLICY "owner or admin delete projects" ON projects FOR DELETE
  USING (created_by = auth.uid() OR is_admin());

-- week_targets: 모두 read, admin/manager만 write
CREATE POLICY "auth users read week_targets" ON week_targets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin write week_targets" ON week_targets FOR ALL USING (is_admin());

-- month_archive: 모두 read, admin/manager만 write
CREATE POLICY "auth users read month_archive" ON month_archive FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin write month_archive" ON month_archive FOR ALL USING (is_admin());

-- =====================================================
-- REALTIME 활성화
-- =====================================================
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE week_targets;
ALTER PUBLICATION supabase_realtime ADD TABLE month_archive;
ALTER PUBLICATION supabase_realtime ADD TABLE settings;

-- =====================================================
-- 초기 어드민 지정 (가입 후 실행)
-- 김슬기·남영훈을 admin으로 만드려면 가입 후 이메일 넣고 실행:
-- UPDATE profiles SET role = 'admin' WHERE email = 'ceo_office@likelion.net';
-- UPDATE profiles SET role = 'manager' WHERE email = '남영훈@...';
-- =====================================================
