# Synapse Canvas 배포·설치 안내

계정 로그인, 결제, 스토어 제출은 직접 하셔야 합니다. 이 문서는 어디서 무엇을 누르면 되는지 순서대로 정리한 안내입니다.
대시보드 메뉴 이름은 서비스 쪽에서 바뀔 수 있으니, 비슷한 이름을 찾아 진행해 주세요.

웹 배포와 CAPTCHA(Turnstile)는 **Cloudflare 계정 하나**로 처리합니다. 서버(동기화)는 Supabase를 씁니다.

---

## 0. 한눈에 보기

| 할 일 | 필수? | 결과 |
|---|---|---|
| 1. Supabase 프로젝트 + `schema.sql` | 동기화를 쓸 때만 | 서버 준비 |
| 2. Supabase 인증 설정 (이메일 확인 끄기·익명 로그인 켜기) | 동기화를 쓸 때만 | 아이디·기기 열쇠 동작 |
| 3. `.env` 작성 (로컬 개발용) | 동기화를 쓸 때만 | 로컬에서 서버 연결 |
| 4. Cloudflare Pages 배포 (GitHub 연결) | 필수 | `https://프로젝트.pages.dev` 주소 |
| 5. Cloudflare Turnstile (같은 계정) → Supabase CAPTCHA 켜기 | 권장 | 스팸 가입 방지 |
| 6. Windows 스토어 (PWABuilder → Partner Center) | 선택 | Microsoft Store 앱 |
| 7. 각 기기 설치 | — | 홈 화면/시작 메뉴 앱 |

- 동기화를 쓰지 않으면 1~3단계와 5단계는 건너뛰어도 됩니다. 그러면 앱은 기기에만 저장합니다.
- Turnstile은 배포 주소(`*.pages.dev`)가 정해진 뒤에 만들어야 해서 4단계 다음에 둡니다.

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에 로그인합니다. **New project**를 누릅니다.
   - Region: 가까운 곳(예: Northeast Asia (Seoul))
   - Database Password: 아무 강한 값 (앱에서는 쓰지 않음)
2. 프로젝트가 만들어지면 왼쪽 메뉴에서 **SQL Editor**를 엽니다.
   1. 이 저장소의 `supabase/schema.sql` 내용을 전부 붙여넣고 **Run**을 누릅니다. "Success"가 나오면 끝입니다.
      테이블, RLS, 함수, 사진 버킷(`images`, 비공개)과 Storage 정책이 한 번에 만들어집니다. 여러 번 실행해도 안전합니다.
   2. (선택) 새 쿼리에 `supabase/rls_test.sql`을 붙여넣고 Run합니다. 결과에 **`RLS OK`**가 보이면 다른 보관함의 데이터에 접근할 수 없다는 것이 확인된 것입니다. 테스트 데이터는 자동으로 되돌려집니다.

## 2. 인증 설정

왼쪽 메뉴 **Authentication**에서 진행합니다.

1. **Sign In / Providers**(또는 Providers) 화면
   - **Allow new users to sign up**: 켬
   - **Allow anonymous sign-ins**: **켬**. 기기마다 "기기 열쇠"로 씁니다.
   - **Email** 공급자: 켬
     - **Confirm email**: **끔**. 아이디는 `아이디@users.synapse.invalid` 형태의 가짜 주소라 확인 메일을 받을 수 없습니다. 켜 두면 아이디 만들기가 "이메일 확인 필요" 오류로 멈춥니다.
     - (선택) Minimum password length: 8
2. **Emails / SMTP**는 설정하지 않아도 됩니다(메일을 보내지 않음).
3. (선택) **Rate Limits**: 익명 로그인 한도(기본값 시간당 IP별 30회 정도)는 개인 사용에 충분합니다.
4. **CAPTCHA(Attack Protection)는 아직 켜지 마세요.** 5단계에서 앱에 Site Key를 넣은 뒤에 켭니다. 먼저 켜면 배포된 앱에서 가입·로그인·기기 연결이 모두 실패합니다.

## 3. `.env` 작성 (로컬 개발용)

배포된 사이트는 이 파일을 쓰지 않습니다. 배포용 값은 4단계에서 Cloudflare Pages에 따로 넣습니다.

1. `.env.example`을 `.env`로 복사합니다.
2. Supabase → **Project Settings → API**(또는 상단 **Connect**)에서:
   - `VITE_SUPABASE_URL` = Project URL (`https://xxxx.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY` = **anon public** 키 (새 대시보드의 **publishable** 키 `sb_publishable_…`도 됩니다)
3. `VITE_TURNSTILE_SITE_KEY`는 5단계에서 채웁니다. 지금은 비워 둡니다.

- `.env`는 `.gitignore`에 들어 있어 저장소에 올라가지 않습니다.
- anon/publishable 키는 원래 브라우저에 공개되는 키입니다. 데이터 보호는 RLS가 담당합니다.
- **service_role / secret 키는 절대 넣지 마세요.** Cloudflare 환경 변수에도 넣지 않습니다.
- 로컬 확인: `npm install` → `npm run dev` → 설정(⚙) 아래쪽 **SYNC / 동기화** 섹션

## 4. Cloudflare Pages 배포 (GitHub 연결)

### 4-1. GitHub에 올리기

GitHub에 새 저장소(비공개여도 됨)를 만들고 이 폴더를 올립니다. `.env`는 자동으로 제외됩니다.
```bash
git init
```
그다음 `git add .`, `git commit`, `git remote add origin …`, `git push -u origin main`

### 4-2. Pages 프로젝트 만들기

1. https://dash.cloudflare.com 에 로그인합니다(계정이 없으면 무료로 만듭니다).
2. 왼쪽 메뉴 **Workers & Pages** → **Create**(Create application) → **Pages** 탭 → **Import an existing Git repository**(Connect to Git)
   - 화면이 Workers 만들기로 열리면, 아래쪽의 "Pages로 배포" 같은 링크나 **Pages** 탭을 찾아 들어갑니다.
3. **GitHub 연결**: 처음이면 Cloudflare GitHub 앱 설치 화면이 뜹니다. **Only select repositories**에서 이 저장소만 골라 허용하는 것을 권장합니다.
4. 저장소를 고르고 **Begin setup**을 누릅니다.

| 항목 | 값 |
|---|---|
| Project name | 예: `synapse-canvas` → 주소가 `https://synapse-canvas.pages.dev`가 됩니다 (이미 쓰인 이름이면 뒤에 문자가 붙음) |
| Production branch | `main` |
| Framework preset | `None` (또는 `Vite`/`React (Vite)` — 아래 두 값만 맞으면 됩니다) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 비워 둠 |

5. 같은 화면의 **Environment variables (advanced)**를 펼쳐 다음을 추가합니다.

| 변수 | 값 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon public(또는 publishable) 키 |
| `NODE_VERSION` | `22` (저장소의 `.node-version`에도 적혀 있어 생략해도 됩니다) |

   - `VITE_TURNSTILE_SITE_KEY`는 5단계에서 추가합니다.
   - `BASE_PATH`는 **넣지 않습니다**. `*.pages.dev`는 루트(`/`)에서 서비스됩니다.
   - 동기화를 안 쓰면 Supabase 변수 두 개도 생략합니다.
   - `VITE_` 값은 **빌드할 때** 앱에 들어갑니다. 나중에 값을 바꾸면 반드시 다시 빌드해야 반영됩니다(5단계 참고).
6. **Save and Deploy**. 1~2분 뒤 `https://프로젝트이름.pages.dev`가 열립니다.

### 4-3. 이후 업데이트

- `main`에 push하면 Cloudflare가 자동으로 빌드·배포합니다. 설치된 앱은 다음 실행 때 새 버전으로 바뀝니다(서비스 워커 자동 업데이트).
- 다른 브랜치에 push하면 **미리보기 배포**(`https://브랜치별이름.프로젝트이름.pages.dev`)가 따로 만들어집니다. 미리보기에도 같은 변수를 쓰려면 환경 변수를 **Preview** 환경에도 넣으세요.
  - 미리보기 주소는 따로 설치되는 앱이고, 저장소도 운영 주소와 분리됩니다.
- 테스트(`npm test`)는 Cloudflare 빌드에서는 돌지 않습니다. GitHub에 push하면 `.github/workflows/ci.yml`이 GitHub Actions에서 테스트와 빌드를 확인합니다(배포는 하지 않음).
- (선택) 사용자 도메인: Pages 프로젝트 → **Custom domains → Set up a custom domain**. 도메인을 붙였다면 5단계의 Turnstile Hostnames에도 추가합니다.

### 4-4. 배포 후 확인할 것

- 주소창 오른쪽에 설치 아이콘이 나오는지 (Chrome/Edge)
- 개인정보처리방침이 열리는지: `https://…/privacy.html`. 문의 연락처 칸을 채워 두세요(`public/privacy.html`의 `id="contact"`).
- 빌드가 실패하면 Pages 프로젝트 → **Deployments** → 실패한 항목 → **View details**에서 로그를 봅니다. Node 버전 오류라면 `NODE_VERSION=22`를 확인합니다.

## 5. Cloudflare Turnstile (같은 계정) → Supabase CAPTCHA

아이디 만들기, 로그인, 기기 연결(익명 로그인) 때 사람 확인을 합니다. 4단계에서 쓴 Cloudflare 계정에서 그대로 만듭니다.
순서가 중요합니다: **위젯 만들기 → 앱에 Site Key 넣고 재배포 → 마지막에 Supabase에서 켜기.**

### 5-1. 위젯 만들기

1. https://dash.cloudflare.com 왼쪽 메뉴 **Turnstile**(메뉴가 안 보이면 상단 검색창에 "Turnstile") → **Add widget**
   - Widget name: `Synapse Canvas`
   - Hostnames (**Add hostnames**로 하나씩 추가):
     - `프로젝트이름.pages.dev` — 4단계 주소. 하위 도메인(미리보기 배포 주소)까지 함께 허용됩니다.
     - `localhost` — 로컬 개발용
     - 사용자 도메인을 붙였다면 그 도메인
   - Widget Mode: **Managed**
   - Pre-clearance: **No** (기본값)
2. **Create**를 누르면 **Site Key**와 **Secret Key**가 나옵니다.
   - Site Key → 앱(공개 값)
   - Secret Key → Supabase에만 넣습니다. Cloudflare Pages 환경 변수나 `.env`에는 넣지 않습니다.

### 5-2. 앱에 Site Key 넣고 재배포

1. Cloudflare → **Workers & Pages** → 4단계 프로젝트 → **Settings → Variables and Secrets**(또는 Environment variables)
   - **Production**에 `VITE_TURNSTILE_SITE_KEY` = Site Key 추가 (미리보기도 쓰면 **Preview**에도)
2. 재배포: **Deployments** → 맨 위 배포의 **⋯ → Retry deployment**(또는 아무 커밋이나 `main`에 push). 환경 변수는 새로 빌드해야 반영됩니다.
3. 로컬 `.env`의 `VITE_TURNSTILE_SITE_KEY`에도 같은 Site Key를 넣습니다.
4. 배포된 앱에서 설정 → SYNC → **동기화 켜기**를 열어 사람 확인 상자가 보이는지 확인합니다(아직 제출하지 않아도 됩니다).

### 5-3. Supabase에서 CAPTCHA 켜기

Supabase → **Authentication → Attack Protection**(또는 Bot and Abuse Protection)에서:
- **Enable Captcha protection**: 켬
- Provider: **Cloudflare Turnstile**
- Secret key: Turnstile의 **Secret Key**
- **Save**

Supabase에서 CAPTCHA를 켜면 회원 가입, 로그인, 익명 로그인 모두 토큰이 필요합니다. 앱은 세 경우 모두 토큰을 보냅니다.
그래서 Supabase에서 켰다면 앱에도 Site Key가 꼭 들어 있어야 합니다(5-2). 반대로 앱에 Site Key를 넣지 않을 거라면 Supabase에서도 꺼 두세요.

- 위젯에 "Invalid domain" 같은 오류가 뜨면: 지금 주소의 도메인이 Hostnames에 있는지 확인합니다.
- 이미 연결된 기기는 영향이 없습니다. 사람 확인은 새로 가입·로그인·연결할 때만 합니다.

## 6. Windows: PWABuilder → Microsoft Store

### 6-1. 개발자 계정 (Partner Center)
1. https://partner.microsoft.com/dashboard → **Windows & Xbox** 개발자 프로그램에 **개인(Individual)** 계정으로 등록합니다.
   - 본인 확인(신분증·셀카 등)을 요청할 수 있습니다. 등록비는 등록 화면의 안내를 따르세요. 개인 개발자 등록은 2025년부터 무료로 바뀌었다는 공지가 있었습니다.
2. **Apps and games → New product → MSIX or PWA app** → 앱 이름(예: Synapse Canvas)을 **예약**합니다.
3. 앱의 **Product management → Product identity**에서 다음 세 값을 메모합니다:
   - Package/Identity/Name
   - Package/Identity/Publisher (`CN=…`)
   - Publisher display name

### 6-2. 패키지 만들기
1. https://www.pwabuilder.com 에 배포 주소를 넣고 **Start**를 누릅니다. Manifest·Service Worker 점수를 확인합니다(아이콘·오프라인은 이미 갖춤).
2. **Package For Stores → Windows → Generate Package**
   - Package ID / Publisher ID / Publisher display name: 6-1에서 메모한 값
   - App version: 예 `1.0.0.0` (올릴 때마다 증가)
3. 받은 zip 안의 `.msixbundle`(스토어용)을 씁니다. 함께 들어 있는 안내문도 읽어 두세요.

### 6-3. 제출
Partner Center의 앱 → **Start your submission**에서:
1. **Pricing and availability**: 무료, 시장 선택
2. **Properties**: 카테고리(예: Productivity), 개인정보처리방침 URL = `https://…/privacy.html`
3. **Age ratings**: 설문 작성 (사용자 간 소통·결제 없음)
4. **Packages**: `.msixbundle` 업로드
5. **Store listings (한국어/영어)**: 설명 + **스크린샷 1장 이상** (1366×768 이상 권장)
   - 스크린샷: 설치한 앱을 1920×1080 창에서 캡처(Win+Shift+S)
6. **Submit to the Store**. 심사는 보통 수 일 걸립니다.

설치된 Windows 앱에서는 상단 바가 타이틀바 자리까지 올라갑니다(Window Controls Overlay). 창 버튼(최소화·닫기) 옆에 펼침 단추(⌃)가 보이면, 그 단추로 일반 타이틀바와 오가며 바꿀 수 있습니다.

## 7. 각 기기에 설치

| 기기 | 방법 |
|---|---|
| **iPhone / iPad** | **Safari**로 주소를 엽니다 → 하단(아이패드는 상단) **공유** 버튼 → **홈 화면에 추가**. 처음 Safari로 열면 앱 안에 이 안내가 한 번 뜹니다. |
| **Android** | **Chrome**으로 엽니다 → 주소창의 설치 아이콘, 또는 메뉴(⋮) → **앱 설치**(또는 홈 화면에 추가) |
| **Windows / Mac** | Chrome·Edge로 엽니다 → 주소창 오른쪽 설치 아이콘(⊕). Windows는 Microsoft Store로도 설치 가능 |

- **iOS 주의**: Safari 탭과 홈 화면 앱은 저장소가 **따로**입니다. Safari에서 쓰던 내용은 홈 화면 앱에 자동으로 보이지 않습니다. 동기화를 켜거나 EXPORT/IMPORT로 옮기세요.
- 홈 화면 앱으로 쓰면 iOS가 저장소를 임의로 비울 가능성이 줄어듭니다. 그래도 중요한 내용은 가끔 **EXPORT**로 백업하세요.
- 새 기기 연결: 쓰던 기기에서 **설정 → SYNC → 다른 기기 연결**을 누르면 코드와 QR이 나옵니다. 새 기기에서 **다른 기기로 연결**을 눌러 코드를 입력하거나 QR을 스캔합니다(휴대폰 기본 카메라로 찍어도 됨).

## 8. Supabase 무료 프로젝트가 일시정지됐을 때

무료 플랜은 약 1주일 동안 요청이 없으면 프로젝트가 **일시정지(Paused)**될 수 있습니다.

- 앱에는 **OFFLINE**으로 표시되지만, 기기 저장·편집은 그대로 됩니다. 바뀐 내용은 기기에 남아 있다가 서버가 돌아오면 자동으로 올라갑니다.
- **다시 켜기**: https://supabase.com/dashboard → 해당 프로젝트 → **Restore project**(또는 Resume) → 몇 분 기다립니다. 앱을 다시 열거나 설정 → SYNC → **지금 동기화**를 누릅니다.
- 오래(수십 일 이상) 정지된 프로젝트는 대시보드에서 바로 복구가 안 될 수 있습니다. 그런 경우에 대비해 각 기기의 EXPORT 백업을 가끔 받아 두세요. 기기 안 데이터는 서버와 상관없이 남아 있습니다.

## 9. 개발·점검

```bash
npm test
```
PGlite(WASM Postgres)에 `schema.sql`을 그대로 올려 RLS, 연결 코드, 두 기기 병합 시나리오를 검사합니다.

```bash
npm run build
```
빌드 결과는 `dist/`에 생깁니다. `npm run preview`로 확인할 수 있습니다.

- 열쇠 구조: 기기마다 익명 사용자 1개(기기 열쇠)가 있고, 아이디·비밀번호는 별도 사용자(아이디 열쇠)입니다. 아이디로 로그인할 때 아이디 열쇠는 잠깐만 쓰고 기기에 저장하지 않습니다. 그래서 기기별 연결 해제가 가능합니다.
- Supabase 대시보드 **Table Editor**에서 데이터를 직접 고칠 필요는 없습니다. 고친다면 `categories.version`도 1 올려야 기기들이 변경을 알아챕니다.
