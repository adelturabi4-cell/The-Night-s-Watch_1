import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import MissionShell from './MissionShell'
import { NavigationProvider } from './SurfaceNavigation'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavigationProvider><MissionShell /></NavigationProvider>
  </StrictMode>,
)
