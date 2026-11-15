import core from '@spelling-creator/spellophone/espeak-ng-data/core.bin.gz?url'
import english from '@spelling-creator/spellophone/espeak-ng-data/en_dict.gz?url'
import manifest from '@spelling-creator/spellophone/espeak-ng-data/manifest.json?url'
import { createEspeak, encodeWav } from '@spelling-creator/spellophone/browser'

const assets: Record<string, string> = { 'core.bin.gz': core, 'en_dict.gz': english, 'manifest.json': manifest }
let ready: ReturnType<typeof createEspeak> | undefined

export async function englishAudio(text: string) {
  ready ??= createEspeak({
    dataUrl: new URL('/speech-assets/', window.location.origin),
    languages: ['en'],
    fetch: (request, init) => fetch(assets[String(request).split('/').pop() ?? ''] ?? request, init),
  }).catch((error) => {
    ready = undefined
    throw error
  })
  const engine = await ready
  engine.setVoice('en')
  const { samples, sampleRate } = engine.synthesize(text, { rate: 150 })
  return new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' })
}
