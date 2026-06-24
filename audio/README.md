# /audio/ — El Sanatorio ambient sound

## Current state (2026-06-24 PM)

`ambient-asilo.mp3` + `.ogg` are a **procedurally-generated asylum drone placeholder**
(30s loopable, ~350 KB). Synthesized via FFmpeg with low sine waves (52 Hz / 76 Hz)
+ brown noise + tremolo. Feels right; not the canonical track.

## The canonical track (to commission)

Per Andrew 2026-06-24 PM: a crazy-lady recording of the Colombian nursery rhyme
**Arroz con Leche**, with the second line replaced for asylum-appropriate vibe:

> *Arroz con leche, me quiero casar
> con una viudita de la capital
> que sepa coser, que sepa bordar
> que ponga la mesa en su santo lugar.*

Voice direction: Colombian Spanish, female ~60s, slightly cracked, off-pitch, like
she hasn't slept in days. Reverb tail (tiled room). Two soft laughs before she
starts singing. 18-22s, seamless loop.

Three sourcing options being considered:
1. Andrew / Luz / colleague records personally (most authentic)
2. Gemini AI Studio TTS generation (variable quality for Spanish character voices)
3. Fiverr voice actress commission (~$20-50, 24h turnaround)

When the canonical track lands: drop the file as `ambient-asilo.mp3` + `.ogg`
in this folder (same filenames), bump the cache-bust query in `js/cinematic-v2.js`
src list, commit, push. The Howler.js handler in `cinematic-v2.js#initSound` already
expects these paths — no code changes needed.

## Wiring (already shipped earlier)

- Speaker icon top-right of homepage toggles play/pause
- Defaults to muted (browser autoplay policy)
- Once auto-start-on-first-interaction lands (pending), the track will play the
  moment user accepts cookies / clicks anywhere
- `onloaderror: silent fallback` — if the file ever 404s, the page doesn't error
