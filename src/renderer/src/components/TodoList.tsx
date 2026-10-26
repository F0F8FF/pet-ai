import { useState } from 'react'

export interface Todo {
  id: number // 만든 시각(ms)
  text: string
  done: boolean
  urgent: boolean
  /** "나중에" 묶음. 없으면 "오늘 꼭" 이다(예전 할 일도 오늘로 본다). */
  later?: boolean
  /** 끝낸 시각(ms). 오늘 몇 개 끝냈는지 셀 때 쓴다. */
  doneAt?: number
}

interface TodoListProps {
  todos: Todo[]
  setTodos: React.Dispatch<React.SetStateAction<Todo[]>>
}

const byUrgent = (a: Todo, b: Todo) => Number(b.urgent) - Number(a.urgent)

export function TodoList({ todos, setTodos }: TodoListProps) {
  const [input, setInput] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [later, setLater] = useState(false)

  const add = () => {
    if (!input.trim()) return
    setTodos((prev) => [...prev, { id: Date.now(), text: input.trim(), done: false, urgent, later }])
    setInput('')
    setUrgent(false)
  }

  const toggle = (id: number) =>
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? undefined : Date.now() } : t)))

  const move = (id: number) =>
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, later: !t.later } : t)))

  const remove = (id: number) =>
    setTodos((prev) => prev.filter((t) => t.id !== id))

  const today = todos.filter((t) => !t.done && !t.later).sort(byUrgent)
  const someday = todos.filter((t) => !t.done && t.later).sort(byUrgent)
  const done = todos.filter((t) => t.done)

  const item = (t: Todo) => (
    <div key={t.id} className={`todo-item ${t.urgent ? 'urgent' : ''}`}>
      <input type="checkbox" checked={false} onChange={() => toggle(t.id)} />
      <span className="todo-text">{t.urgent && '🔥 '}{t.text}</span>
      <button className="todo-move-btn" onClick={() => move(t.id)} title={t.later ? '오늘 꼭으로' : '나중으로'}>
        {t.later ? '오늘' : '나중'}
      </button>
      <button className="del-btn" onClick={() => remove(t.id)}>×</button>
    </div>
  )

  return (
    <div className="todo-list">
      <div className="todo-input-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          placeholder={later ? '나중에 할 일…' : '오늘 할 일…'}
          className="todo-input"
        />
        <button className={`urgent-btn ${later ? 'on' : ''}`} onClick={() => setLater((l) => !l)} title="나중에 할 일로">⏳</button>
        <button className={`urgent-btn ${urgent ? 'on' : ''}`} onClick={() => setUrgent((u) => !u)} title="급함">🔥</button>
        <button className="add-btn" onClick={add}>+</button>
      </div>

      <div className="todo-items">
        <div className="done-label">📌 오늘 꼭 {today.length}개</div>
        {today.map(item)}
        {today.length === 0 && <div className="todo-empty">오늘 할 일이 없어요~ 여유롭네요 ☁️</div>}

        {someday.length > 0 && (
          <div className="done-section">
            <div className="done-label">⏳ 나중에 {someday.length}개</div>
            {someday.map(item)}
          </div>
        )}

        {done.length > 0 && (
          <div className="done-section">
            <div className="done-label">완료 {done.length}개</div>
            {done.map((t) => (
              <div key={t.id} className="todo-item done">
                <input type="checkbox" checked={true} onChange={() => toggle(t.id)} />
                <span className="todo-text">{t.text}</span>
                <button className="del-btn" onClick={() => remove(t.id)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
