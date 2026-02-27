import { useState, useCallback, useRef } from 'react'

export type PetEmotion = 'idle' | 'happy' | 'thinking' | 'sleepy' | 'excited' | 'love' | 'hot'

const SESSION_ID = `session_${Date.now()}`

function detectEmotion(text: string): PetEmotion {
  if (/사랑|좋아|최고|행복/.test(text)) return 'love'
  if (/졸려|피곤|자고싶/.test(text)) return 'sleepy'
  if (/신나|대박|야호|완전|알람|완료/.test(text)) return 'excited'
  if (/음|글쎄|흠|생각/.test(text)) return 'thinking'
  return 'happy'
}

export function useGemini() {
  const [isLoading, setIsLoading] = useState(false)
  const [emotion, setEmotion] = useState<PetEmotion>('idle')
  const emotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const chat = useCallback(async (userMessage: string): Promise<{ text: string; actions: Action[] }> => {
    setIsLoading(true)
    setEmotion('thinking')

    try {
      const result = await window.electronAPI.geminiChat(SESSION_ID, userMessage)

      if (result.error) {
        setEmotion('idle')
        return { text: result.error, actions: [] }
      }

      const text = result.text || ''
      const actions = result.actions || []
      setEmotion(detectEmotion(text))

      if (emotionTimerRef.current) clearTimeout(emotionTimerRef.current)
      emotionTimerRef.current = setTimeout(() => setEmotion('idle'), 3000)

      return { text, actions }
    } catch {
      setEmotion('idle')
      return { text: '앗, 오류가 났어요 주인님~ 다시 시도해줘요! 😢', actions: [] }
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { chat, isLoading, emotion, setEmotion }
}
