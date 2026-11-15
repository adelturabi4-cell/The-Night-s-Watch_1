import { useEffect, useRef, useState } from 'react'

export default function ReportVoice({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const active = useRef<{ audio: HTMLAudioElement; url?: string } | null>(null)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = () => {
    if (utterance.current) {
      utterance.current = null
      window.speechSynthesis.cancel()
    }
    if (active.current) {
      active.current.audio.pause()
      if (active.current.url) URL.revokeObjectURL(active.current.url)
      active.current = null
    }
  }

  useEffect(() => stop, [])

  const play = async () => {
    stop()
    setStatus('loading')
    const audio = new Audio()
    const session = { audio, url: undefined as string | undefined }
    active.current = session
    const finished = () => {
      stop()
      setStatus('idle')
    }
    const fallback = async () => {
      try {
        const { englishAudio } = await import('./voice')
        const wav = await englishAudio(text)
        if (active.current !== session) return
        session.url = URL.createObjectURL(wav)
        audio.src = session.url
        audio.onended = finished
        await audio.play()
        if (active.current === session) setStatus('playing')
      } catch {
        if (active.current === session) {
          stop()
          setStatus('error')
        }
      }
    }
    const synth = window.speechSynthesis
    const voice = synth?.getVoices().find((option) => option.localService && /^en(?:-|_|$)/i.test(option.lang))
    if (!voice) {
      await fallback()
      return
    }
    const speech = new SpeechSynthesisUtterance(text)
    utterance.current = speech
    speech.voice = voice
    speech.lang = voice.lang
    speech.rate = 0.9
    speech.onstart = () => { if (utterance.current === speech) setStatus('playing') }
    speech.onend = () => { if (utterance.current === speech) finished() }
    speech.onerror = () => {
      if (utterance.current !== speech) return
      utterance.current = null
      void fallback()
    }
    synth.speak(speech)
  }

  return (
    <div className="mars-voice" lang="en" dir="ltr">
      {status === 'loading' || status === 'playing'
        ? <button type="button" onClick={() => { stop(); setStatus('idle') }}>Stop reading</button>
        : <button type="button" onClick={play}>Listen to report</button>}
      {status === 'loading' && <small role="status">Preparing audio…</small>}
      {status === 'playing' && <small role="status">Reading report</small>}
      {status === 'error' && <small role="alert">Audio unavailable. Try again.</small>}
    </div>
  )
}
