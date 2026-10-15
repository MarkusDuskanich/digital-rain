import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Frame, Run, Setting, SvgRain } from '../types'
import { BuildRainSvg, MAX_SVG_WIDTH, PIXELS_PER_COLUMN, ROW_HEIGHT, SVG_ROWS, SWITCH_OFF_MS, SwitchOffSvg } from './svg-rain'

const frame = atom({ plugin: 'digital-rain', key: 'frame' } as const, null)
const svgRain = atom({ plugin: 'digital-rain', key: 'svgRain' } as const, { mode: 'off', seed: 0, closed: 0 } as SvgRain)

const ROWS = 8
const FRAME_MS = 70
const DEFAULT_WIDTH = 80
// Chance per frame that a free column starts a new drop while working.
const SPAWN_CHANCE = 0.025
// Chance per frame that a lit glyph in a trail changes.
const MUTATE_CHANCE = 0.03

// From the head (index 0) down the trail; a trail's cells are spread over these.
const SHADES: string[] = ['#e8ffe8', '#5dff7a', '#00e03a', '#00b82f', '#008f24', '#00661a', '#00420f']

// Glyphs every code font has, so the columns stay aligned on every surface.
// Half-width katakana look closer to the film but most code fonts lack them,
// and a fallback font with other widths makes the columns wobble.
const GLYPHS: string = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*+=<>?:;|!^~'

type Drop = {
  column: number
  head: number // row the head is on; starts above the band
  framesPerRow: number // whole frames per step, so every drop falls evenly
  wait: number // frames left until the next step
  length: number // lit cells, the head included
}

function RandomGlyph(): string {
  return GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length))
}

function ShadeAt(distance: number, length: number): string {
  if (distance === 0) return SHADES[0]!
  const index: number = 1 + Math.floor(((distance - 1) / Math.max(1, length - 1)) * (SHADES.length - 1))
  return SHADES[Math.min(index, SHADES.length - 1)]!
}

let drops: Drop[] = []
let cells: string[][] = [] // the glyph each cell shows when lit; stays put as drops pass
let width: number = DEFAULT_WIDTH
let isWorking: boolean = false
// When it rains, set by `/digital-rain always | working | never` and kept across sessions:
// all the time, only while Claude works (the default), or never (no band at all).
let setting: Setting = 'working'
const SETTINGS: ReadonlyArray<Setting> = ['always', 'working', 'never']
const SETTING_KEY = 'setting'
// The setting of 0.4 and before: true was `always`.
const ALWAYS_ON_KEY = 'alwaysOn'
// `/digital-rain` alone rains this long, whatever the setting, then closes.
const PREVIEW_MS = 5000
let previewTimer: Timer | null = null

/** Whether the band rains now: by its setting, or a preview running. */
function ShouldRain(): boolean {
  return setting === 'always' || (setting === 'working' && isWorking) || previewTimer !== null
}

async function LoadSetting($: EngineInterface): Promise<Setting> {
  const stored: unknown = await $.store.get(SETTING_KEY)
  const known: Setting | undefined = SETTINGS.find(candidate => candidate === stored)
  if (known !== undefined) return known
  return (await $.store.get(ALWAYS_ON_KEY)) === true ? 'always' : 'working'
}
let workingSince: number = 0
let timer: Timer | null = null
// Set once the desktop has drawn its SVG rain: from then on the text rain, which only
// the terminal draws, is not computed at all.
let drawsSvg: boolean = false

function EnsureCells(): void {
  if (cells.length === ROWS && cells[0]!.length === width) return
  cells = Array.from({ length: ROWS }, () => Array.from({ length: width }, RandomGlyph))
  drops = drops.filter(drop => drop.column < width)
}

function Step(): Frame | null {
  EnsureCells()

  for (const drop of drops) {
    drop.wait -= 1
    if (drop.wait > 0) continue
    drop.wait = drop.framesPerRow
    drop.head += 1
    // The head writes a fresh glyph into the cell it enters.
    if (drop.head >= 0 && drop.head < ROWS) cells[drop.head]![drop.column] = RandomGlyph()
  }
  // A drop leaves once its tail has fallen out of the bottom.
  drops = drops.filter(drop => drop.head - drop.length + 1 < ROWS)

  if (ShouldRain()) {
    const busy: Set<number> = new Set(drops.filter(d => d.head - d.length < 1).map(d => d.column))
    for (let column = 0; column < width; column++) {
      if (busy.has(column) || Math.random() >= SPAWN_CHANCE) continue
      const framesPerRow: number = 1 + Math.floor(Math.random() * 3)
      drops.push({
        column,
        head: -1,
        framesPerRow,
        wait: 1 + Math.floor(Math.random() * framesPerRow),
        length: 3 + Math.floor(Math.random() * 7),
      })
    }
  }

  if (!ShouldRain() && drops.length === 0) return null

  const shades: string[][] = Array.from({ length: ROWS }, () => Array(width).fill(''))
  for (const drop of drops) {
    for (let distance = 0; distance < drop.length; distance++) {
      const row: number = drop.head - distance
      if (row < 0 || row >= ROWS) continue
      const shade: string = ShadeAt(distance, drop.length)
      // Where two trails overlap, the brighter wins.
      const current: string = shades[row]![drop.column]!
      if (current === '' || SHADES.indexOf(shade) < SHADES.indexOf(current)) shades[row]![drop.column] = shade
      // The film's flicker: now and then a lit glyph changes in place.
      if (distance > 0 && Math.random() < MUTATE_CHANCE) cells[row]![drop.column] = RandomGlyph()
    }
  }

  return shades.map((rowShades, row) => {
    const runs: Run[] = []
    for (let column = 0; column < width; column++) {
      const color: string = rowShades[column]!
      const glyph: string = color === '' ? ' ' : cells[row]![column]!
      const last: Run | undefined = runs[runs.length - 1]
      if (last !== undefined && last.color === color) {
        last.text += glyph
      } else {
        runs.push({ text: glyph, color, bold: color === SHADES[0] })
      }
    }
    return runs
  })
}

function Start($: EngineInterface): void {
  if (timer !== null || drawsSvg) return
  timer = $.clock.every(FRAME_MS, () => {
    const next: Frame | null = Step()
    void update($, frame, () => next)
    if (next === null && timer !== null) {
      timer.cancel()
      timer = null
    }
  })
}

let svgCache: { key: string; source: string } | null = null

let switchOffCache: { key: string; source: string } | null = null

function SwitchOffSource(seed: number, pixels: number): string {
  const key: string = `${seed}:${pixels}`
  if (switchOffCache === null || switchOffCache.key !== key) {
    switchOffCache = { key, source: SwitchOffSvg(seed, pixels) }
  }
  return switchOffCache.source
}

// The same source for the whole turn: a new one reloads the frame, which flickers.
function RainSource(seed: number, pixels: number): string {
  const key: string = `${seed}:${pixels}`
  if (svgCache === null || svgCache.key !== key) {
    svgCache = { key, source: BuildRainSvg(seed, pixels) }
  }
  return svgCache.source
}

// The desktop band ends in two parts. First it switches off like an old TV (one new
// source, which plays by itself at full height). Then its height shrinks to nothing,
// eased, so the chat above settles instead of jumping. The desktop reloads an Svg's
// frame on every size change, so the shrinking is done to an empty drawing.
const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"></svg>'
const CLOSE_STEPS = 15
const CLOSE_STEP_MS = 40

/** The rain's height `closed` steps into the close, eased in and out. */
function ClosingHeight(closed: number): number {
  const full: number = SVG_ROWS * ROW_HEIGHT
  const eased: number = (1 - Math.cos((Math.PI * closed) / CLOSE_STEPS)) / 2
  return Math.max(1, Math.round(full * (1 - eased)))
}
let closeTimer: Timer | null = null

function StopClosing(): void {
  if (closeTimer !== null) {
    closeTimer.cancel()
    closeTimer = null
  }
}

// After the switch-off has played, the band slides closed (unless a new turn started).
function CloseAfterSwitchOff($: EngineInterface, seed: number): void {
  StopClosing()
  closeTimer = $.clock.after(SWITCH_OFF_MS, () => {
    closeTimer = null
    void update($, svgRain, (rain: SvgRain): SvgRain =>
      rain.mode === 'switchingOff' && rain.seed === seed ? { ...rain, mode: 'closing', closed: 0 } : rain,
    ).then(rain => {
      if (rain.mode === 'closing') CloseSoftly($)
    })
  })
}

function CloseSoftly($: EngineInterface): void {
  StopClosing()
  closeTimer = $.clock.every(CLOSE_STEP_MS, () => {
    void update($, svgRain, (rain: SvgRain): SvgRain => {
      if (rain.mode !== 'closing') return rain
      return rain.closed + 1 >= CLOSE_STEPS ? { ...rain, mode: 'off', closed: 0 } : { ...rain, closed: rain.closed + 1 }
    }).then(rain => {
      if (rain.mode !== 'closing') StopClosing()
    })
  })
}

// When the rain stops: the terminal's band at once, the desktop's softly (`softly`
// false, as after a reload, closes it at once too).
function StopTextRain(): void {
  drops = []
  if (timer !== null) {
    timer.cancel()
    timer = null
  }
}

async function StopRain($: EngineInterface, softly: boolean): Promise<void> {
  StopTextRain()
  await update($, frame, () => null)
  const rain: SvgRain = await update($, svgRain, (current: SvgRain): SvgRain => {
    if (!softly) return { ...current, mode: 'off', closed: 0 }
    if (current.mode === 'working') return { ...current, mode: 'switchingOff', closed: 0 }
    return current // already switching off or closing, or off
  })
  if (rain.mode === 'off' || rain.mode === 'working') StopClosing()
  else if (closeTimer === null) {
    if (rain.mode === 'switchingOff') CloseAfterSwitchOff($, rain.seed)
    else CloseSoftly($)
  }
}

// Starts the rain, or keeps it as it is when it is already raining: a new seed would
// be a new source, which reloads the desktop's frame.
async function StartRain($: EngineInterface): Promise<void> {
  StopClosing()
  await update($, svgRain, (current: SvgRain): SvgRain =>
    current.mode === 'working' ? current : { mode: 'working', seed: Math.floor(Math.random() * 4294967296), closed: 0 },
  )
  Start($)
}

// `/digital-rain` alone: the rain for a few seconds, then it closes unless the setting
// keeps it (a turn running under `working`, or `always`).
async function Preview($: EngineInterface): Promise<void> {
  previewTimer?.cancel()
  previewTimer = $.clock.after(PREVIEW_MS, () => {
    previewTimer = null
    if (!ShouldRain()) void StopRain($, true)
  })
  await StartRain($)
}

const SETTING_TEXT: Record<Setting, string> = {
  always: 'Digital rain: always.',
  working: 'Digital rain: only while Claude works.',
  never: 'Digital rain: never.',
}

export const register: Register = on => {
  // A reload (an update, or an edit to the mod) forgets the turn in progress, so
  // clear any rain a previous load left showing, then rain at once if it is always on.
  on('session.start', async ($, e, next) => {
    setting = await LoadSetting($)
    await StopRain($, false)
    if (ShouldRain()) await StartRain($)
    await $.command.register({
      name: 'digital-rain',
      description: 'Digital rain: "always", "working" (only while Claude works) or "never"; alone, a few seconds of it',
      argumentHint: '[always|working|never]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'digital-rain' }, async ($, e) => {
    const argument: string = e.args.trim().toLowerCase()
    if (argument === '') {
      await Preview($)
      return { text: 'Digital rain: a few seconds of it.' }
    }
    const chosen: Setting | undefined = SETTINGS.find(candidate => candidate === argument)
    if (chosen === undefined) {
      return { text: 'Usage: /digital-rain always | working | never (no argument: a few seconds of it)' }
    }
    setting = chosen
    await $.store.set(SETTING_KEY, setting)
    if (ShouldRain()) await StartRain($)
    else await StopRain($, true)
    return { text: SETTING_TEXT[setting] }
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    workingSince = await $.clock.now()
    if (ShouldRain()) await StartRain($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    isWorking = false
    if (!ShouldRain()) await StopRain($, true)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    width = Math.max(1, e.props.bodyColumns)
    // Safety net should a turn end without turn.complete.
    if (!e.props.isWorking && isWorking && (await $.clock.now()) - workingSince > 1500) {
      isWorking = false
      if (!ShouldRain()) await StopRain($, true)
    }

    if (e.surface === 'desktop') {
      // The desktop draws text in a proportional font, so its rain is an SVG instead.
      if (!drawsSvg) {
        drawsSvg = true
        StopTextRain()
      }
      const rain: SvgRain = await read($, svgRain)
      if (e.props.hasSurvey || rain.mode === 'off') return next(e)
      const pixels: number = Math.min(MAX_SVG_WIDTH, Math.round(e.props.bodyColumns * PIXELS_PER_COLUMN))
      const { Svg } = $.ui.resolve(e)
      return (
        <Svg
          key="rain"
          source={
            rain.mode === 'closing'
              ? EMPTY_SVG
              : rain.mode === 'switchingOff'
                ? SwitchOffSource(rain.seed, pixels)
                : RainSource(rain.seed, pixels)
          }
          alt="Green code rain while Claude works"
          width={pixels}
          height={ClosingHeight(rain.closed)}
          isInteractive
        />
      )
    }

    const rows: Frame | null = await read($, frame)
    if (e.props.hasSurvey || rows === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rows.map((runs, row) => (
          <Text key={`row${row}`} wrap="truncate">
            {runs.map((run, i) =>
              run.color === '' ? (
                run.text
              ) : (
                <Text key={`r${row}-${i}`} color={run.color} bold={run.bold}>
                  {run.text}
                </Text>
              ),
            )}
          </Text>
        ))}
      </Box>
    )
  })
}
