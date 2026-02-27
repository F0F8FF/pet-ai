import { useState, useEffect } from 'react'

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    breakInterval: 90,
    startAtLogin: false,
    petSpeed: 1,
    petName: '뭉이',
    voiceEnabled: false,
    runInBackground: true,
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
  }, [])

  const save = async (newSettings: AppSettings) => {
    const updated = await window.electronAPI.saveSettings(newSettings)
    setSettings(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const update = (partial: Partial<AppSettings>) => {
    const next = { ...settings, ...partial }
    setSettings(next)
    save(next)
  }

  return (
    <div className="settings-panel">
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
