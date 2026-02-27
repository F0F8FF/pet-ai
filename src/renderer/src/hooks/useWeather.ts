import { useState, useEffect } from 'react'

export interface WeatherInfo {
  temp: number
  code: number
  emoji: string
  desc: string
}

export function useWeather() {
  const [weather, setWeather] = useState<WeatherInfo | null>(null)

  useEffect(() => {
    const fetch_weather = async () => {
      const data = await window.electronAPI.getWeather()
      if (data) setWeather(data)
    }
    fetch_weather()
    const t = setInterval(fetch_weather, 30 * 60 * 1000) // 30분마다
    return () => clearInterval(t)
  }, [])

  return weather
}
