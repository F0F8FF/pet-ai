import { useState } from 'react'

export interface Todo {
  id: number
  text: string
  done: boolean
  urgent: boolean
}

interface TodoListProps {
  todos: Todo[]
  setTodos: React.Dispatch<React.SetStateAction<Todo[]>>
}

export function TodoList({ todos, setTodos }: TodoListProps) {
  const [input, setInput] = useState('')
  const [urgent, setUrgent] = useState(false)

  const add = () => {
    if (!input.trim()) return
    setTodos((prev) => [...prev, { id: Date.now(), text: input.trim(), done: false, urgent }])
    setInput('')
    setUrgent(false)
  }

  const toggle = (id: number) =>
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))

  const remove = (id: number) =>
    setTodos((prev) => prev.filter((t) => t.id !== id))

  const undone = todos.filter((t) => !t.done).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))
  const done = todos.filter((t) => t.done)

  return (
    <div className="todo-list">
      <div className="todo-input-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="할일 추가..."
          className="todo-input"
        />
        <button className={`urgent-btn ${urgent ? 'on' : ''}`} onClick={() => setUrgent((u) => !u)} title="급함">🔥</button>
        <button className="add-btn" onClick={add}>+</button>
      </div>

      <div className="todo-items">
        {undone.map((t) => (
          <div key={t.id} className={`todo-item ${t.urgent ? 'urgent' : ''}`}>
            <input type="checkbox" checked={false} onChange={() => toggle(t.id)} />
            <span className="todo-text">{t.urgent && '🔥 '}{t.text}</span>
            <button className="del-btn" onClick={() => remove(t.id)}>×</button>
          </div>
        ))}
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
        {todos.length === 0 && (
          <div className="todo-empty">할일이 없어요~ 여유롭네요 ☁️</div>
        )}
      </div>
    </div>
  )
}
