import { useState, useEffect } from 'react'

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    breakInterval: 90,
    startAtLogin: false,
    petSpeed: 1,
    petName: '뭉이',
    voiceEnabled: false,
    runInBackground: true,
    geminiModel: 'gemini-2.5-flash',
    geminiApiKeySet: false,
    petSize: 1,
    aiReady: false,
    clickTalk: false,
    workHours: { enabled: true, start: '09:00', lunch: '12:00', end: '18:00', days: [1, 2, 3, 4, 5], startAlert: true, lunchAlert: true, leaveAlert: true },
    calendars: [],
    calendarAlertMinutes: [10],
  })
  const [saved, setSaved] = useState(false)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [placeQuery, setPlaceQuery] = useState('')
  const [places, setPlaces] = useState<WeatherPlace[]>([])
  const [placeEditing, setPlaceEditing] = useState(false)
  // 키 입력값은 따로 둔다. 한 글자씩 저장하면 잘린 키가 저장되기 때문이다.
  const [keyInput, setKeyInput] = useState('')

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
  }, [])

  const save = async (patch: SettingsPatch) => {
    const updated = await window.electronAPI.saveSettings(patch)
    setSettings(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const update = (partial: Partial<AppSettings>) => {
    const next = { ...settings, ...partial }
    setSettings(next)
    save(next)
  }

  // geminiApiKey를 담아 보내면 그 값으로 바뀌고, 빈 문자열이면 지워진다.
  // 아예 담지 않으면(update 경로) 저장된 키는 그대로 남는다.
  const saveApiKey = async () => {
    const key = keyInput.trim()
    if (!key) return
    setKeyInput('')
    await save({ ...settings, geminiApiKey: key })
  }

  const clearApiKey = async () => {
    setKeyInput('')
    await save({ ...settings, geminiApiKey: '' })
  }

  const importSheet = async () => {
    setSheetError(null)
    const res = await window.electronAPI.importCharacter()
    if (res.error) setSheetError(res.error)
    if (res.settings) setSettings(res.settings)
  }

  const removeSheet = async () => {
    setSheetError(null)
    setSettings(await window.electronAPI.removeCharacter())
  }

  const sheet = settings.character
  const work = settings.workHours
  const updateWork = (partial: Partial<WorkHours>) => update({ workHours: { ...work, ...partial } })

  // 지역 이름을 칠 때마다 묻지 않고 잠깐 멈췄을 때만 찾는다.
  useEffect(() => {
    if (!placeQuery.trim()) { setPlaces([]); return }
    const t = setTimeout(() => window.electronAPI.searchPlace(placeQuery).then(setPlaces), 350)
    return () => clearTimeout(t)
  }, [placeQuery])

  const choosePlace = (p: WeatherPlace | undefined) => {
    update({ weatherPlace: p })
    setPlaceQuery('')
    setPlaces([])
    setPlaceEditing(false)
  }

  return (
    <div className="settings-panel">
      <div className="settings-section">
        <div className="settings-label">🎨 캐릭터</div>
        <div className="settings-desc">
          ChatGPT Pets로 만든 시트(배경 투명 PNG)를 넣으면 그 캐릭터로 바뀌어요.
          그림은 이 컴퓨터에만 저장돼요.
        </div>
        <div className="settings-key-row">
          <button className="opt-btn" onClick={importSheet}>{sheet ? '다른 시트 넣기' : '시트 넣기'}</button>
          {sheet && <button className="opt-btn" onClick={removeSheet}>기본 강아지로</button>}
        </div>
        <div className="settings-desc">
          {sheet
            ? `✅ ${sheet.rows}가지 동작을 찾았어요 (${sheet.counts.join('·')}칸)`
            : '지금은 기본 강아지예요.'}
        </div>
        {sheetError && <div className="settings-desc settings-error">⚠️ {sheetError}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-label">📏 크기</div>
        <div className="settings-options">
          {[{ v: 0.75, l: '작게' }, { v: 1, l: '보통' }, { v: 1.5, l: '크게' }].map(({ v, l }) => (
            <button
              key={v}
              className={`opt-btn ${settings.petSize === v ? 'active' : ''}`}
              onClick={() => update({ petSize: v })}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">👆 클릭 방식</div>
        <div className="settings-options">
          <button className={`opt-btn ${!settings.clickTalk ? 'active' : ''}`} onClick={() => update({ clickTalk: false })}>
            한 번: 패널 · 두 번: 말 걸기
          </button>
          <button className={`opt-btn ${settings.clickTalk ? 'active' : ''}`} onClick={() => update({ clickTalk: true })}>
            한 번: 말 걸기 · 두 번: 패널
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-label">🏢 근무 시간 인사</div>
            <div className="settings-desc">출근·점심·퇴근 10분 전에 하루 한 번씩 인사해요</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={work.enabled} onChange={(e) => updateWork({ enabled: e.target.checked })} />
            <span className="toggle-slider" />
          </label>
        </div>
        {work.enabled && (
          <>
            <div className="settings-time-row">
              {([['start', '출근', 'startAlert'], ['lunch', '점심', 'lunchAlert'], ['end', '퇴근', 'leaveAlert']] as const).map(([k, l, alert]) => (
                <label key={k} className="settings-time">
                  <span>
                    <input type="checkbox" checked={work[alert]} onChange={(e) => updateWork({ [alert]: e.target.checked })} />
                    {l}
                  </span>
                  <input type="time" className="settings-input" value={work[k]} onChange={(e) => e.target.value && updateWork({ [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="settings-options">
              {['일', '월', '화', '수', '목', '금', '토'].map((l, d) => (
                <button
                  key={d}
                  className={`opt-btn day-btn ${work.days.includes(d) ? 'active' : ''}`}
                  onClick={() => updateWork({ days: work.days.includes(d) ? work.days.filter((x) => x !== d) : [...work.days, d].sort() })}
                >
                  {l}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-label">🌤️ 날씨</div>
        <div className="settings-desc">
          고른 지역의 날씨를 알려줘요. 지역의 위도·경도만 Open-Meteo에 보내고, 이 맥의 위치는 쓰지 않아요.
        </div>
        {settings.weatherPlace && !placeEditing ? (
          <div className="settings-key-row">
            <span className="settings-place">📍 {settings.weatherPlace.label}</span>
            <button className="opt-btn" onClick={() => setPlaceEditing(true)}>바꾸기</button>
            <button className="opt-btn" onClick={() => choosePlace(undefined)}>지우기</button>
          </div>
        ) : (
          <>
            <input
              className="settings-input"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              placeholder="서울, 성남시처럼 지역 이름"
            />
            {places.length > 0 && (
              <div className="settings-place-list">
                {places.map((p) => (
                  <button key={`${p.latitude},${p.longitude}`} className="settings-place-item" onClick={() => choosePlace(p)}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            {!settings.weatherPlace && <div className="settings-desc">지역을 고르기 전에는 날씨를 묻지 않아요.</div>}
          </>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-label">🔑 Gemini API 키</div>
        <div className="settings-desc">
          채팅을 쓰려면 키가 필요해요.{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          에서 무료로 받을 수 있어요.
        </div>
        <div className="settings-key-row">
          <input
            type="password"
            className="settings-input"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveApiKey() }}
            placeholder={settings.geminiApiKeySet ? '저장된 키를 쓰고 있어요' : 'AIza... 로 시작하는 키'}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="opt-btn" onClick={saveApiKey} disabled={!keyInput.trim()}>
            저장
          </button>
          {settings.geminiApiKeySet && (
            <button className="opt-btn" onClick={clearApiKey}>
              지우기
            </button>
          )}
        </div>
        <div className="settings-desc">
          {settings.geminiApiKeySet
            ? '✅ 키가 저장돼 있어요. 바꾸려면 새 키를 넣고 저장을 누르세요.'
            : '키가 없어도 빠른 질문(할 일·집중·날씨·응원)과 나머지 기능은 그대로 돼요.'}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">🤖 모델</div>
        <div className="settings-desc">빠른 쪽이 무료 한도에 여유로워요</div>
        <div className="settings-options">
          {[
            { v: 'gemini-2.5-flash', l: '빠름 (추천)' },
            { v: 'gemini-2.5-pro', l: '똑똑함' },
          ].map(({ v, l }) => (
            <button
              key={v}
              className={`opt-btn ${settings.geminiModel === v ? 'active' : ''}`}
              onClick={() => update({ geminiModel: v })}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">⏰ 휴식 알림</div>
        <div className="settings-desc">일정 시간마다 뭉이가 휴식을 알려줘요</div>
        <div className="settings-options">
          {[0, 30, 60, 90, 120].map((min) => (
            <button
              key={min}
              className={`opt-btn ${settings.breakInterval === min ? 'active' : ''}`}
              onClick={() => update({ breakInterval: min })}
            >
              {min === 0 ? '끄기' : `${min}분`}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">🐾 펫 이름</div>
        <div className="settings-desc">캐릭터 이름을 바꿀 수 있어요</div>
        <input
          type="text"
          className="settings-input"
          value={settings.petName ?? ''}
          onChange={(e) => update({ petName: e.target.value })}
          placeholder="뭉이"
          maxLength={10}
        />
      </div>

      <div className="settings-section">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-label">🔊 뭉이 말하기 (TTS)</div>
            <div className="settings-desc">답변을 음성으로 읽어줘요</div>
          </div>
          <div className="settings-row-control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="settings-option-label">{settings.voiceEnabled ? '켜짐' : '꺼짐'}</span>
            <label className="toggle">
            <input
              type="checkbox"
              checked={settings.voiceEnabled ?? false}
              onChange={(e) => update({ voiceEnabled: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">🐾 이동 속도</div>
        <div className="settings-options">
          {[{ v: 0.5, l: '느리게' }, { v: 1, l: '보통' }, { v: 2, l: '빠르게' }].map(({ v, l }) => (
            <button
              key={v}
              className={`opt-btn ${settings.petSpeed === v ? 'active' : ''}`}
              onClick={() => update({ petSpeed: v })}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-label">🚀 로그인 시 자동 실행</div>
            <div className="settings-desc">컴퓨터 켜면 펫이 자동으로 나타나요</div>
          </div>
          <div className="settings-row-control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="settings-option-label">{settings.startAtLogin ? '켜짐' : '꺼짐'}</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.startAtLogin}
                onChange={(e) => update({ startAtLogin: e.target.checked })}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-label">🔄 백그라운드 실행</div>
            <div className="settings-desc">창을 닫아도 트레이에서 계속 실행할지 정해요</div>
          </div>
          <div className="settings-row-control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="settings-option-label">{settings.runInBackground !== false ? '켜짐' : '꺼짐'}</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.runInBackground !== false}
                onChange={(e) => update({ runInBackground: e.target.checked })}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>

      {saved && <div className="settings-saved">✅ 저장됐어요!</div>}
    </div>
  )
}
