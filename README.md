# 🐾 Pet AI 

데스크톱에 사는 귀여운 AI 펫. 채팅, 휴식 알림, 할일·포모도로까지 말로 부릅니다.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

---

## ✨ 기능

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
VITE_LLM_PROVIDER=gemini
VITE_GEMINI_API_KEY=여기에_발급받은_API_키
VITE_GEMINI_MODEL=gemini-2.5-flash
```

#### 방법 B: Ollama (로컬 LLM, 무료, 오프라인 가능)

```bash
# 먼저 Ollama 설치 후 모델 다운로드
brew install ollama
ollama serve          # 서버 실행 (별도 터미널)
ollama pull qwen3.5   # 모델 다운로드 (약 6.6GB)
```

```env
VITE_LLM_PROVIDER=ollama
VITE_OLLAMA_MODEL=qwen3.5
VITE_OLLAMA_URL=http://localhost:11434
```

> ⚠️ `.env`는 Git에 올라가지 않습니다. `.env.example`을 참고해 직접 만드세요.

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
├── python/
│   ├── main.py         # Python NLP 엔진 (감정분석, 키워드, 기분리포트)
│   └── requirements.txt
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

## 📄 라이선스

MIT
