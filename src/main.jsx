import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import App from './App.jsx'
import posthog from 'posthog-js'
posthog.init('phc_qmLvjZawzLuEnR5ns5eFKXSFiSD5AX4y87LvELP9nqB5', { api_host: 'https://us.i.posthog.com' })
posthog.register({ $host: 'velyr.io' })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <Analytics />
    <SpeedInsights />
  </StrictMode>,
)
