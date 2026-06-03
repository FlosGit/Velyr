import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import blog from './scripts/vite-plugin-blog.mjs'

export default defineConfig({
  plugins: [react(), blog()],
})
