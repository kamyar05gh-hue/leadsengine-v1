import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './app-scope.css'
import App from './App.tsx'

// Dark mode by default
document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
