# 🐾 Pet AI (뭉이)

데스크톱에 사는 귀여운 AI 펫. 채팅, 휴식 알림, 할일·포모도로까지 말로 부릅니다.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

---

## ✨ 기능

- **AI 채팅** – Google Gemini로 대화 (이름·말투 설정 가능)
- **휴식 알림** – 일정 시간마다 쉬라고 알림
- **할일** – 말로 “할일 추가해줘” 하면 리스트에 추가
- **포모도로** – 타이머 알람
- **날씨** – “오늘 날씨 어때?” 하면 간단 요약
- **가위바위보** – 채팅에서 가위/바위/보 입력하면 대결
- **TTS** – 설정에서 켜면 뭉이 답변을 음성으로 재생
- **트레이** – 창 닫아도 백그라운드 실행 (설정에서 끌 수 있음)

---

## 📋 요구 사항

- **Node.js** 18+
- **Google Gemini API 키** ([Google AI Studio](https://aistudio.google.com)에서 발급)

---

## 🚀 실행 방법

### 1. 저장소 클론

```bash
git clone https://github.com/내아이디/ai-desktop-pet.git
cd ai-desktop-pet
```

### 2. 의존성 설치

```bash
npm install
```

### 3. API 키 / 모델 설정

프로젝트 루트에 `.env` 파일을 만들고 다음 내용을 넣습니다.

```env
VITE_GEMINI_API_KEY=여기에_발급받은_API_키
VITE_GEMINI_MODEL=gemini-2.5-flash   # 예: gemini-2.0-flash, gemini-1.5-pro 등
```

> ⚠️ 두 값이 **둘 다 설정**돼 있어야 합니다. 하나라도 비어 있으면 앱에서 \"설정되지 않았다\"는 에러를 띄웁니다.  
> ⚠️ `.env`는 Git에 올라가지 않습니다. 각자 본인 키를 발급해 사용하세요.

### 4. 개발 모드로 실행

```bash
npm run dev
```

### 5. 패키징 (배포용 앱 만들기)

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
│   ├── main/           # Electron 메인 프로세스 (창, 트레이, IPC, Gemini)
│   ├── preload/        # preload 스크립트 (IPC 노출)
│   └── renderer/       # React UI (채팅, 설정, 포모도로, 할일)
├── build/              # 앱 아이콘 (icon.png 512×512)
├── .env                # API 키 (직접 생성, Git 제외)
├── electron-builder.yml # 패키징 설정
└── package.json
```

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

