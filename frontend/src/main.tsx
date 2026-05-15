import { StrictMode, useEffect, useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { PlatformLoginPage } from './components/auth/platform-login-page'
import { ForceDefaultPasswordChangePage } from './components/auth/force-default-password-change-page'
import { isSessionExpired, onSessionChange, readSession } from './auth/session'

function hasValidSession(): boolean {
  const s = readSession()
  if (!s) return false
  return !isSessionExpired()
}

function sessionRequiresPasswordChange(): boolean {
  const s = readSession()
  if (!s || isSessionExpired()) return false
  return s.user.must_change_password === true
}

function PlatformSessionRoot() {
  const [, rerender] = useReducer((c: number) => c + 1, 0)
  const bump = () => rerender()

  useEffect(() => {
    const unsubA = onSessionChange(() => bump())
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'gdc_platform_session_v1') bump()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      unsubA()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!hasValidSession()) bump()
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  if (!hasValidSession()) {
    return (
      <div className="dark">
        <PlatformLoginPage onAuthenticated={bump} />
      </div>
    )
  }

  if (sessionRequiresPasswordChange()) {
    return (
      <div className="dark">
        <ForceDefaultPasswordChangePage onCompleted={bump} />
      </div>
    )
  }

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PlatformSessionRoot />
    </BrowserRouter>
  </StrictMode>,
)
