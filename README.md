# 🐾 Pet AI 

데스크톱에 사는 귀여운 AI 펫. 채팅, 휴식 알림, 할일·포모도로까지 말로 부릅니다.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

---

## ✨ 기능

- **살아있는 픽셀 강아지** – 네 발로 걷고, 눈을 깜빡이고, 앉아서 꼬리를 흔듭니다.
  화면 아래쪽을 자유롭게 돌아다니고 드래그해서 옮길 수 있습니다.
- **AI 채팅** – Google Gemini 또는 로컬 Ollama(Qwen3.5 등) 선택 가능
- **휴식 알림** – 일정 시간마다 쉬라고 알림
- **할일** – 말로 "할일 추가해줘" 하면 리스트에 추가
- **포모도로** – 타이머 알람
- **날씨** – "오늘 날씨 어때?" 하면 간단 요약
- **가위바위보** – 채팅에서 가위/바위/보 입력하면 대결
- **TTS** – 설정에서 켜면 뭉이 답변을 음성으로 재생
- **트레이** – 창 닫아도 백그라운드 실행 (설정에서 끌 수 있음)
- **Python NLP 엔진** – 감정 분석, 키워드 추출, 기분 리포트 (kiwipiepy 기반 한국어 형태소 분석)

---

## 📋 요구 사항

- **Node.js** 18+
- **Python** 3.9+ (NLP 기능 사용 시)
- LLM 중 하나:
  - **Google Gemini API 키** ([Google AI Studio](https://aistudio.google.com)에서 발급) 또는
  - **Ollama** ([ollama.com](https://ollama.com)에서 설치) + 원하는 모델

---

## 🚀 실행 방법

### 1. 저장소 클론

```bash
git clone https://github.com/F0F8FF/pet-ai.git
cd pet-ai
```

### 2. 의존성 설치

```bash
npm install
```

### 3. LLM 설정

프로젝트 루트에 `.env` 파일을 만들고, 아래 중 원하는 방식을 설정합니다.

#### 방법 A: Google Gemini (클라우드)

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=여기에_발급받은_API_키
GEMINI_MODEL=gemini-2.5-flash
```

#### 방법 B: Ollama (로컬 LLM, 무료, 오프라인 가능)

```bash
# 먼저 Ollama 설치 후 모델 다운로드
brew install ollama
ollama serve          # 서버 실행 (별도 터미널)
ollama pull qwen3.5   # 모델 다운로드 (약 6.6GB)
```

```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen3.5
OLLAMA_URL=http://localhost:11434
```

> ⚠️ `.env`는 Git에 올라가지 않습니다. `.env.example`을 참고해 직접 만드세요.
>
> 환경변수에 `VITE_` 접두사를 붙이지 마세요. electron-vite가 `VITE_`로 시작하는 값을
> 렌더러 번들에 인라인하기 때문에, API 키가 배포 파일에 평문으로 포함될 수 있습니다.
> 이 값들은 메인 프로세스에서만 `process.env`로 읽습니다.

### 4. Python NLP 엔진 설치 (선택)

```bash
pip3 install -r python/requirements.txt
```

채팅에서 `기분 분석`, `키워드`, `감정 분석 <텍스트>` 명령어를 사용할 수 있습니다.

### 5. 개발 모드로 실행

```bash
npm run dev
```

### 6. 패키징 (배포용 앱 만들기)

**macOS (Apple Silicon):**

```bash
npm run dist:mac
```

생성 파일: `release/Pet AI-0.1.0.dmg`, `release/mac-arm64/Pet AI.app`

**Windows:**

```bash
npm run dist:win
```

---

## 📁 프로젝트 구조

```
├── src/
│   ├── main/           # Electron 메인 (Gemini/Ollama 분기, Python spawn, 트레이)
│   ├── preload/        # preload 스크립트 (IPC 노출)
│   └── renderer/       # React UI (채팅, 설정, 포모도로, 할일)
│       └── src/
│           ├── assets/pet/          # 강아지 스프라이트 시트 (dog.png, dog-blink.png)
│           ├── hooks/usePetMotion.ts # 강아지 물리·걸음 시뮬레이션
│           └── components/Pet.tsx    # 행동 상태머신 (걷기/서기/앉기)
├── python/
│   ├── main.py         # Python NLP 엔진 (감정분석, 키워드, 기분리포트)
│   └── requirements.txt
├── scripts/            # 스프라이트 제작 도구 (개발용, 앱 실행에는 불필요)
├── build/              # 앱 아이콘 (icon.png 512×512)
├── .env                # LLM 설정 (직접 생성, Git 제외)
├── .env.example        # .env 작성 예시
├── electron-builder.yml # 패키징 설정
└── package.json
```

---

## 🧠 아키텍처

```
┌─────────────────────────────────────────────┐
│  Renderer (React + TypeScript)              │
│  채팅 UI · 포모도로 · 할일 · 설정            │
└──────────────┬──────────────────────────────┘
               │ IPC (contextBridge)
┌──────────────▼──────────────────────────────┐
│  Main Process (Electron + Node.js)          │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ LLM Router  │  │ Python NLP (spawn)   │  │
│  │ Gemini /    │  │ 감정분석 · 키워드 ·  │  │
│  │ Ollama      │  │ 기분리포트           │  │
│  └─────────────┘  └──────────────────────┘  │
│  트레이 · 알림 · 시스템모니터 · 설정저장     │
└─────────────────────────────────────────────┘
```

## 🤖 LLM 제공자 비교

| 항목 | Gemini (클라우드) | Ollama (로컬) |
|------|-----------------|--------------|
| 비용 | 무료 티어 (일일 한도 있음) | 완전 무료 |
| 인터넷 | 필요 | 불필요 (오프라인 가능) |
| 속도 | 빠름 | Mac 사양에 따라 다름 |
| API 키 | 필요 | 불필요 |
| 추천 모델 | gemini-2.5-flash | qwen3.5 (RAM 16GB+ 권장) |

---

## ⚙️ 설정

앱 실행 후 **⚙️ 설정** 탭에서 변경할 수 있습니다.

| 항목 | 설명 |
|------|------|
| 휴식 알림 | 일정 시간마다 휴식 알림 (끄기 ~ 120분) |
| 펫 이름 | 채팅에서 쓰는 이름 (기본: 뭉이) |
| 뭉이 말하기 (TTS) | 답변 음성 재생 on/off |
| 이동 속도 | 펫 움직임 속도 |
| 로그인 시 자동 실행 | Mac 부팅 시 앱 자동 실행 (권한 필요) |
| 백그라운드 실행 | 창 닫을 때 트레이로 숨길지, 완전 종료할지 |

---

## 🐕 강아지 움직임은 어떻게 만들었나

**스프라이트 시트 + 절차적 애니메이션**을 섞었습니다. 프레임을 미리 다 그려두는
방식은 움직임이 기계처럼 보여서, 그림은 시트에서 가져오고 몸의 흔들림은 매 프레임
계산합니다.

- `assets/pet/dog.png` – 8프레임 시트 (걷기 4 + 서기 1 + 앉기 3)
- `assets/pet/dog-blink.png` – 같은 8프레임의 눈 감은 버전. 눈 깜빡임에 씁니다.
- `hooks/usePetMotion.ts` – `requestAnimationFrame`으로 위치 보간(easing), 이동
  거리에 비례한 걸음 주기, 상하 바운스, 가속 시 기울기, 숨쉬기, 착지 시 스쿼시를
  계산해 DOM에 직접 씁니다. React 리렌더를 타지 않아 60fps가 유지됩니다.
- `components/Pet.tsx` – 걷기/서기/앉기를 확률적으로 고르는 행동 상태머신.
  화면 하단(`floorY`)에만 머물고, 앉을 때는 정면을 봅니다.

`scripts/`는 시트를 만들 때 쓴 도구입니다. 앱을 실행하는 데는 필요 없고,
스프라이트를 새로 만들 때만 씁니다.

```bash
pip3 install pillow
```

| 스크립트 | 역할 |
|---------|------|
| `prepare_pixel_sprite.py` | 생성한 이미지에서 픽셀 격자를 찾아 다운샘플·배경제거·팔레트 축소 |
| `pack_pet_sheet.py` | 여러 시트를 발바닥선·몸통 중심으로 정렬해 한 장으로 합침 |
| `make_wag_frames.py` | 기준 프레임의 몸통을 고정하고 꼬리만 갈아끼워 떨림 제거 |
| `make_blink_frame.py` | 눈 위치를 찾아 감은 눈 버전 시트 생성 |
| `measure_head.py` | 목걸이 기준으로 머리 크기를 재서 프레임 간 배율 검증 |

---

## 📄 라이선스

MIT
