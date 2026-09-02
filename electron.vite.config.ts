import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      // 펫 스프라이트 시트를 번들에 data URI 로 넣기 위한 값(기본 4KB).
      // 별도 파일로 떨어지면 패키징 경로가 어긋날 때 펫이 통째로 안 보인다.
      assetsInlineLimit: 8192
    },
    plugins: [react()]
  }
})
