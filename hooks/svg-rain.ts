// The desktop's rain: one SVG the browser animates by itself, so the mod
// redraws nothing per frame. Every glyph sits at a fixed pixel position (no
// font-width wobble).
//
// Smoothness comes first: each column's glyphs are static text painted with one
// gradient (cream head, green trail fading upward) that steps down a row at a
// time. So a column is one animation that changes only when its head moves on,
// not hundreds of per-glyph animations recomputed every frame. Variety comes
// from each column's own trail, tint, speeds and pauses, and from its glyphs
// swapping now and then.
//
// As in the film (and its faithful recreations): the glyphs stay put and only
// the light moves, they are mirrored, the head is a pale cream and the tail is
// long and uneven. The film's bloom is left out: a blur over the whole band
// cost the most frame time of everything tried.

export const SVG_ROWS = 8
export const ROW_HEIGHT = 20
const COLUMN_WIDTH = 14
const MAX_COLUMNS = 100
// Past this the desktop stretches the SVG to the band, glyphs a little larger.
export const MAX_SVG_WIDTH = MAX_COLUMNS * COLUMN_WIDTH
// The desktop measures the band in cells of its code font, about this many CSS
// pixels each (95 cells over an 820 px band). It stretches the SVG to the band's
// width either way, so this only keeps the glyphs at their own size.
export const PIXELS_PER_COLUMN = 8.6

// The Svg element takes at most 131072 characters; a wide band gets less detail.
const SIZE_LIMIT = 128000
// From the richest to the leanest: drops per loop (each at its own speed), glyph sets per column.
const DETAIL_LEVELS: ReadonlyArray<{ passes: number; sets: number }> = [
  { passes: 2, sets: 2 },
  { passes: 1, sets: 2 },
  { passes: 1, sets: 1 },
]
// The odd cell that flickers through two glyphs of its own, as in the film.
const FLICKER_CHANCE = 0.025
// Glyphs drawn a little dimmer than their neighbours, so a trail is uneven.
const DIM_CHANCE = 0.22
// Rows lit behind a drop's head; long tails, as in the film, fading slowly.
const TRAIL_MIN = 4
const TRAIL_MAX = 12
// The head's pale cream, the film's brightest glyph.
const HEAD_COLOR = '#e8ffd8'

// Half-width katakana, digits and a few symbols.
const GLYPHS: string = 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:."=*+-<>¦|'

/** Seeded so the same seed always draws the same SVG (a redraw keeps the picture). */
function Mulberry32(seed: number): () => number {
  let a: number = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t: number = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const Round = (n: number): string => n.toFixed(3).replace(/\.?0+$/, '')
const Short = (n: number): string => n.toFixed(2).replace(/\.?0+$/, '')

/** `#rrggbb` for a hue in degrees and saturation and lightness in percent. */
function Hex(hue: number, saturation: number, lightness: number): string {
  const s: number = saturation / 100
  const l: number = Math.min(100, Math.max(0, lightness)) / 100
  const a: number = s * Math.min(l, 1 - l)
  const channel = (n: number): string => {
    const k: number = (n + hue / 30) % 12
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Two values taking turns every `seconds`, from `begin` on (negative: already under way). */
function Alternate(attribute: string, first: string, second: string, seconds: number, begin: number): string {
  return (
    `<animate attributeName="${attribute}" values="${first};${second}" calcMode="discrete" ` +
    `dur="${Round(seconds * 2)}s" begin="${Short(begin)}s" repeatCount="indefinite"/>`
  )
}

// How long the switch-off plays, before the band slides closed.
export const SWITCH_OFF_MS = 600

/**
 * The band switching off like an old CRT television when a turn ends: a still frame of
 * rain squashes into a bright line, the line pinches into a dot in the centre, the dot
 * lingers for a blink and fades. It plays once by itself, in the rain's own greens.
 * (The desktop reloads an Svg whose source changes, so the rain can't simply carry on
 * into it; this starts from a frame of the same seed's glyphs.)
 */
export function SwitchOffSvg(seed: number, width: number): string {
  const random: () => number = Mulberry32(seed ^ 0x5eed)
  const Pick = (count: number): number => Math.floor(random() * count)
  const columnCount: number = Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(width / COLUMN_WIDTH)))
  const drawn: number = columnCount * COLUMN_WIDTH
  const height: number = SVG_ROWS * ROW_HEIGHT
  const cx: number = drawn / 2
  const cy: number = height / 2
  const baseline = (row: number): number => (row + 1) * ROW_HEIGHT - 4

  // The still frame: about half the columns caught mid-drop, a cream head over a fading tail.
  const columns: string[] = []
  for (let column = 0; column < columnCount; column++) {
    if (random() < 0.45) continue
    const head: number = Pick(SVG_ROWS + 3)
    const trail: number = TRAIL_MIN + Pick(TRAIL_MAX - TRAIL_MIN + 1)
    const hue: number = 116 + random() * 26
    const rows: number[] = []
    const glyphs: string[] = []
    for (let row = Math.max(0, head - trail); row <= Math.min(head, SVG_ROWS - 1); row++) {
      const distance: number = head - row
      const glyph: string = GLYPHS.charAt(Pick(GLYPHS.length))
      const color: string = distance === 0 ? HEAD_COLOR : Hex(hue, 90, 58 - (distance / trail) * 30)
      const opacity: number = distance === 0 ? 1 : 1 - (distance / (trail + 1)) * 0.85
      rows.push(row)
      glyphs.push(`<tspan fill="${color}" fill-opacity="${Short(opacity)}">${glyph}</tspan>`)
    }
    if (rows.length === 0) continue
    columns.push(
      `<g transform="translate(${column * COLUMN_WIDTH + COLUMN_WIDTH / 2} 0) scale(-1 1)">` +
        `<text x="${rows.map(() => 0).join(' ')}" y="${rows.map(baseline).join(' ')}">${glyphs.join('')}</text></g>`,
    )
  }

  const seconds: number = SWITCH_OFF_MS / 1000 - 0.05
  // The picture: squashed to a line, quickly (0 to 0.28), the line pinched to a point (to 0.52).
  const squash: string =
    `<animateTransform attributeName="transform" type="scale" values="1 1;1 0.02;0.002 0.02;0.002 0.02" ` +
    `keyTimes="0;0.28;0.52;1" calcMode="spline" keySplines="0.5 0 1 1;0.6 0 0.4 1;0 0 1 1" dur="${Round(seconds)}s" fill="freeze"/>`
  // As it squashes it lights up: a pale mint wash over the picture, which becomes the bright line.
  const glow: string =
    `<rect width="${drawn}" height="${height}" fill="#dcffe0" opacity="0">` +
    `<animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.22;0.52;0.53;1" dur="${Round(seconds)}s" fill="freeze"/></rect>`
  // The dot left in the centre: it lingers for a blink, then fades.
  const dot: string =
    `<circle r="5" fill="url(#dot)" opacity="0">` +
    `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.48;0.52;0.76;1" dur="${Round(seconds)}s" fill="freeze"/>` +
    `<animate attributeName="r" values="5;5;3.5;1" keyTimes="0;0.52;0.76;1" dur="${Round(seconds)}s" fill="freeze"/></circle>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${drawn} ${height}" preserveAspectRatio="xMidYMid meet">` +
    `<style>text{font:bold 16px 'MS Gothic','Yu Gothic','Consolas',monospace;text-anchor:middle}</style>` +
    `<defs><radialGradient id="dot"><stop offset="0" stop-color="#f4fff0"/><stop offset="0.3" stop-color="${HEAD_COLOR}"/>` +
    `<stop offset="0.6" stop-color="#5dff7a" stop-opacity="0.6"/><stop offset="1" stop-color="#22ee55" stop-opacity="0"/></radialGradient></defs>` +
    `<g transform="translate(${cx} ${cy})"><g>${squash}<g transform="translate(${-cx} ${-cy})">${columns.join('')}${glow}</g></g>${dot}</g></svg>`
  )
}

/**
 * The rain as SVG markup for a band `width` CSS pixels wide; it loops forever,
 * every column dark until its first drop, so the band rains in from the top.
 */
export function BuildRainSvg(seed: number, width: number): string {
  const columnCount: number = Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(width / COLUMN_WIDTH)))
  for (const level of DETAIL_LEVELS) {
    const source: string = BuildAt(seed, columnCount, level.passes, level.sets)
    if (source.length <= SIZE_LIMIT) return source
  }
  return BuildAt(seed, Math.floor(columnCount / 2), 1, 1)
}

function BuildAt(seed: number, columnCount: number, passes: number, sets: number): string {
  const random: () => number = Mulberry32(seed)
  const Pick = (count: number): number => Math.floor(random() * count)
  const Glyph = (): string => GLYPHS.charAt(Pick(GLYPHS.length))
  const baseline = (row: number): number => (row + 1) * ROW_HEIGHT - 4
  const defs: string[] = []
  const columns: string[] = []

  for (let column = 0; column < columnCount; column++) {
    // The trail: how many cells glow behind the head, in a tint of the column's own.
    const trail: number = TRAIL_MIN + Pick(TRAIL_MAX - TRAIL_MIN + 1)
    const hue: number = 116 + random() * 26
    const saturation: number = 78 + random() * 22
    const tint: number = -7 + random() * 12

    // The gradient in the head's own frame: the trail above, the head cell at 0..ROW_HEIGHT, dark below.
    const top: number = -trail * ROW_HEIGHT
    const span: number = (trail + 2) * ROW_HEIGHT
    const stop = (y: number, color: string, opacity: number): string =>
      `<stop offset="${Round((y - top) / span)}" stop-color="${color}"${opacity < 1 ? ` stop-opacity="${Short(opacity)}"` : ''}/>`

    // The head's path, a row per step: down through the band until the trail is out, then away for a pause.
    const values: string[] = []
    const times: number[] = []
    let clock: number = 0
    for (let pass = 0; pass < passes; pass++) {
      const step: number = 0.07 + random() * 0.14 // seconds per row; every pass its own speed
      for (let row = 0; row < SVG_ROWS + trail; row++) {
        values.push(`0 ${row * ROW_HEIGHT}`)
        times.push(clock)
        clock += step
      }
      values.push('0 -999')
      times.push(clock)
      clock += 0.2 + random() * 1.8
    }
    const begin: number = random() * 2.5 // its first drop, so the band fills over the first seconds

    defs.push(
      `<linearGradient id="g${column}" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${top + span}" ` +
        `gradientTransform="translate(0 -999)">` +
        // A long, soft tail: bright just behind the head, dimming slowly to nothing.
        stop(top, Hex(hue, saturation, 12), 0) +
        stop(top * 0.7, Hex(hue, saturation, 26 + tint), 0.45) +
        stop(top * 0.35, Hex(hue, saturation, 40 + tint), 0.8) +
        stop(-ROW_HEIGHT, Hex(hue, saturation, 52 + tint), 1) +
        stop(0, Hex(hue, 95, 66 + tint), 1) +
        // The head: one cell of pale cream, as in the film.
        stop(0, HEAD_COLOR, 1) +
        stop(ROW_HEIGHT, HEAD_COLOR, 1) +
        stop(ROW_HEIGHT, HEAD_COLOR, 0) +
        `<animateTransform attributeName="gradientTransform" type="translate" calcMode="discrete" ` +
        `values="${values.join(';')}" keyTimes="${times.map(time => Round(time / clock)).join(';')}" ` +
        `dur="${Round(clock)}s" begin="${Short(begin)}s" repeatCount="indefinite"/></linearGradient>`,
    )

    // The column's glyphs: a set or two taking turns every 6 to 14 seconds.
    const swap: number = 6 + random() * 8
    const swapBegin: number = -random() * swap * 2
    const groups: string[] = []
    for (let set = 0; set < sets; set++) {
      // One text element holds the set, each glyph placed in its row; a few glyphs dimmer
      // than their neighbours, as the film's trails are uneven.
      const rows: number[] = []
      const glyphs: string[] = []
      const flickers: string[] = []
      for (let row = 0; row < SVG_ROWS; row++) {
        if (random() < FLICKER_CHANCE) {
          // A flickering cell: two glyphs of its own taking turns every second or two.
          const every: number = 1 + random()
          flickers.push(
            `<text y="${baseline(row)}">${Glyph()}${Alternate('visibility', 'visible', 'hidden', every, 0)}</text>` +
              `<text y="${baseline(row)}" visibility="hidden">${Glyph()}${Alternate('visibility', 'hidden', 'visible', every, 0)}</text>`,
          )
          continue
        }
        rows.push(row)
        const glyph: string = Glyph()
        glyphs.push(random() < DIM_CHANCE ? `<tspan fill-opacity="${Short(0.45 + random() * 0.35)}">${glyph}</tspan>` : glyph)
      }
      const text: string =
        rows.length === 0
          ? ''
          : `<text x="${rows.map(() => 0).join(' ')}" y="${rows.map(baseline).join(' ')}">${glyphs.join('')}</text>`
      const toggle: string =
        sets > 1 ? Alternate('visibility', set === 0 ? 'visible' : 'hidden', set === 0 ? 'hidden' : 'visible', swap, swapBegin) : ''
      groups.push(`<g${set > 0 ? ' visibility="hidden"' : ''}>${toggle}${text}${flickers.join('')}</g>`)
    }
    // Mirrored, as the film's glyphs are; the column's centre stays put.
    columns.push(
      `<g transform="translate(${column * COLUMN_WIDTH + COLUMN_WIDTH / 2} 0) scale(-1 1)" fill="url(#g${column})">${groups.join('')}</g>`,
    )
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
    `<style>text{font:bold 16px 'MS Gothic','Yu Gothic','Consolas',monospace;text-anchor:middle}</style>` +
    `<defs>${defs.join('')}</defs>${columns.join('')}</svg>`
  )
}
