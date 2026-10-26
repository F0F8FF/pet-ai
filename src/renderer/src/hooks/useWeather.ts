import { useState, useEffect } from 'react'

export interface WeatherInfo {
  temp: number
  code: number
  emoji: string
  desc: string
  place: string
}

/** placeKey 가 바뀌면(설정에서 지역을 고르거나 지우면) 다시 불러온다. 지역이 없으면 null. */
export function useWeather(placeKey: string | null) {
  const [weather, setWeather] = useState<WeatherInfo | null>(null)

  useEffect(() => {
    if (!placeKey) { setWeather(null); return }
    const load = () => window.electronAPI.getWeather().then(setWeather)
    load()
    const t = setInterval(load, 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [placeKey])

  return weather
}
