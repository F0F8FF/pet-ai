import { useState, useRef, useEffect } from 'react'

export interface ChatMessage {
  role: 'user' | 'pet'
  text: string
}

interface ChatBubbleProps {
  messages: ChatMessage[]
  onSend: (text: string) => void
  isLoading: boolean
  petName?: string
  /** 입력창 위에 띄울 빠른 질문 */
  chips?: string[]
}

export function ChatBubble({ messages, onSend, isLoading, petName = '뭉이', chips = [] }: ChatBubbleProps) {
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isComposing && input.trim() && !isLoading) {
      e.preventDefault()
      onSend(input.trim())
      setInput('')
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>
            {msg.role === 'pet' && <span className="pet-avatar">🐾</span>}
            <div className="chat-bubble-text">{msg.text}</div>
          </div>
        ))}
        {isLoading && (
          <div className="chat-msg pet">
            <span className="pet-avatar">🐾</span>
            <div className="chat-bubble-text typing">
              <span>.</span><span>.</span><span>.</span>
            </div>
          </div>
        )}
      </div>

      {chips.length > 0 && (
        <div className="talk-chips chat-chips">
          {chips.map((c) => (
            <button key={c} className="talk-chip" disabled={isLoading} onClick={() => onSend(c)}>{c}</button>
          ))}
        </div>
      )}

      <div className="chat-input-area">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={handleKeyDown}
          placeholder={isLoading ? `${petName?.trim() || '뭉이'}가 생각 중...` : '메시지 입력 (Enter)'}
          disabled={isLoading}
          className="chat-input"
        />
        <button
          className="send-btn"
          onClick={() => { if (input.trim() && !isLoading) { onSend(input.trim()); setInput('') } }}
          disabled={isLoading || !input.trim()}
        >↑</button>
      </div>
    </div>
  )
}
