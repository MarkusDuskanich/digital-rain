// The desktop's rain: one SVG the browser animates by itself, so the mod
// redraws nothing per frame. Every glyph sits at a fixed pixel position (no
// font-width wobble).
//
// Cheap first: the browser repaints the band whenever any animation in it is
// running, every frame of the display (144 a second on a fast screen), and that
// repaint is what costs, not how much of the picture changes. So nothing here
// animates continuously. The picture changes only on the ticks of one shared
// clock (TICK_SECONDS), through SMIL <set> elements, which wake the browser only
// when they start or end; between ticks it repaints nothing.
//
// How the rain is drawn: the glyphs are a fixed mask, and the light behind them
// moves. The columns fall in a few speed groups; each group is one tall drawing
// of trails (a cream head over a long green tail fading upward) that a loop of
// <set>s moves down a row at a time. Variety comes from each column's own trail,
// tint and drops, its speed group, and its glyphs swapping now and then.
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
// The shared clock: every change in the picture lands on one of its ticks. The
// browser's cost grows with the number of ticks a second (each one is a repaint),
// and a tenth of a second is also exact in its microsecond timing, so the groups
// never drift apart.
export const TICK_SECONDS = 0.1
// The speed groups: a group's columns fall a row every this many ticks.
const TICKS_PER_ROW: ReadonlyArray<number> = [1, 1, 2, 2, 3, 3]
// Rows in one loop of a group's trails.
const PERIOD = 48
// Rows between two drops of one column, at the least.
const MIN_GAP = 2
// Distinct trail gradients, shared by the columns.
const TINTS = 12
// The odd cell that flickers between two glyphs, as in the film.
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
/** Seconds for a whole number of ticks, written exactly. */
const Ticks = (ticks: number): string => `${Round(ticks * TICK_SECONDS)}s`

/** A glyph as SVG text: the markup characters escaped. */
function Escape(glyph: string): string {
  return glyph === '<' ? '&lt;' : glyph === '>' ? '&gt;' : glyph
}

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

/** A grey for a mask: how much of the light a dimmed glyph lets through. */
function Grey(share: number): string {
  return `#${Math.round(share * 255).toString(16).padStart(2, '0').repeat(3)}`
}

/**
 * An element's visibility shown for `shown` ticks and hidden for `hidden`, from tick
 * `first` on: one <set> that starts itself again, so the loop needs no per-frame work.
 */
function Blink(id: string, first: number, shown: number, hidden: number): string {
  return `<set id="${id}" attributeName="visibility" to="visible" begin="${Ticks(first)};${id}.end+${Ticks(hidden)}" dur="${Ticks(shown)}"/>`
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
      const glyph: string = Escape(GLYPHS.charAt(Pick(GLYPHS.length)))
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
 * dark at first, so the band rains in from the top.
 */
export function BuildRainSvg(seed: number, width: number): string {
  const columnCount: number = Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(width / COLUMN_WIDTH)))
  // From the richest to the leanest: with the glyph swaps and flickers, without them.
  for (const swaps of [true, false]) {
    const source: string = BuildAt(seed, columnCount, swaps)
    if (source.length <= SIZE_LIMIT) return source
  }
  return BuildAt(seed, Math.floor(columnCount / 2), false)
}

/** Head rows for one column's drops in a loop of PERIOD rows, or none if they don't fit. */
function PlaceDrops(random: () => number, count: number, trail: number): number[] {
  const Pick = (n: number): number => Math.floor(random() * n)
  const spacing: number = trail + 1 + MIN_GAP
  for (let attempt = 0; attempt < 20; attempt++) {
    const heads: number[] = []
    for (let drop = 0; drop < count; drop++) {
      // No drop may straddle the band's bottom edge where a loop starts (its head
      // between SVG_ROWS and SVG_ROWS + trail), or the loop would jump there.
      const head: number = Pick(PERIOD)
      if (head >= SVG_ROWS && head < SVG_ROWS + trail) continue
      const apart = (other: number): boolean => {
        const distance: number = (head - other + PERIOD) % PERIOD
        return distance >= spacing && PERIOD - distance >= spacing
      }
      if (heads.every(apart)) heads.push(head)
    }
    if (heads.length > 0) return heads
  }
  return []
}

function BuildAt(seed: number, columnCount: number, swaps: boolean): string {
  const random: () => number = Mulberry32(seed)
  const Pick = (count: number): number => Math.floor(random() * count)
  const Glyph = (): string => Escape(GLYPHS.charAt(Pick(GLYPHS.length)))
  const baseline = (row: number): number => (row + 1) * ROW_HEIGHT - 4
  const drawn: number = columnCount * COLUMN_WIDTH
  const height: number = SVG_ROWS * ROW_HEIGHT

  // The trails' gradients, top (faded out) to the cell above the head (brightest green).
  const defs: string[] = []
  for (let tint = 0; tint < TINTS; tint++) {
    const hue: number = 116 + random() * 26
    const saturation: number = 78 + random() * 22
    const shift: number = -7 + random() * 12
    defs.push(
      `<linearGradient id="t${tint}" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${Hex(hue, saturation, 12)}" stop-opacity="0"/>` +
        `<stop offset="0.3" stop-color="${Hex(hue, saturation, 26 + shift)}" stop-opacity="0.45"/>` +
        `<stop offset="0.65" stop-color="${Hex(hue, saturation, 40 + shift)}" stop-opacity="0.8"/>` +
        `<stop offset="0.9" stop-color="${Hex(hue, saturation, 52 + shift)}"/>` +
        `<stop offset="1" stop-color="${Hex(hue, 95, 66 + shift)}"/></linearGradient>`,
    )
  }

  // Each group's trails, in rows of its own loop: row r of the loop shows at the band's
  // top when the loop is r rows in. A loop is PERIOD rows; the trails it needs at its
  // start are drawn again a period lower, so the jump back is seamless.
  const trails: string[][] = TICKS_PER_ROW.map(() => [])
  const heads: string[][] = TICKS_PER_ROW.map(() => [])
  const glyphs: string[] = []
  const swapped: string[] = []
  for (let column = 0; column < columnCount; column++) {
    const x: number = column * COLUMN_WIDTH
    const group: number = Pick(TICKS_PER_ROW.length)
    const trail: number = TRAIL_MIN + Pick(TRAIL_MAX - TRAIL_MIN + 1)
    const tint: number = Pick(TINTS)
    // Slow columns get a drop or two more per loop, so every column rains about as often.
    const count: number = 1 + Pick(1 + TICKS_PER_ROW[group]!)
    for (const head of PlaceDrops(random, count, trail)) {
      for (const shift of [0, PERIOD]) {
        const top: number = head - trail + shift
        // Drawn again only where a loop or its lead-in shows it, above PERIOD + SVG_ROWS.
        if (top >= PERIOD + SVG_ROWS) continue
        trails[group]!.push(
          `<rect x="${x}" y="${top * ROW_HEIGHT}" width="${COLUMN_WIDTH}" height="${trail * ROW_HEIGHT}" fill="url(#t${tint})"/>`,
        )
        heads[group]!.push(`<rect x="${x}" y="${(head + shift) * ROW_HEIGHT}" width="${COLUMN_WIDTH}" height="${ROW_HEIGHT}"/>`)
      }
    }

    // The column's glyphs, mirrored as the film's are: white lets the light through, a
    // few greys a little less, so a trail is uneven.
    const ColumnGlyphs = (): string => {
      const cells: string[] = []
      for (let row = 0; row < SVG_ROWS; row++) {
        const glyph: string = Glyph()
        cells.push(random() < DIM_CHANCE ? `<tspan fill="${Grey(0.45 + random() * 0.35)}">${glyph}</tspan>` : glyph)
      }
      return (
        `<text transform="translate(${x + COLUMN_WIDTH / 2} 0) scale(-1 1)" ` +
        `x="${Array(SVG_ROWS).fill(0).join(' ')}" y="${Array.from({ length: SVG_ROWS }, (_, row) => baseline(row)).join(' ')}">` +
        `${cells.join('')}</text>`
      )
    }
    glyphs.push(ColumnGlyphs())
    if (!swaps) continue

    // Now and then the column's glyphs swap for a second set, every 6 to 14 seconds:
    // the second set covers the first (black hides it in the mask) while it shows.
    const every: number = Math.round((6 + random() * 8) / TICK_SECONDS)
    swapped.push(
      `<g visibility="hidden"><rect x="${x}" width="${COLUMN_WIDTH}" height="${height}" fill="#000"/>` +
        `${ColumnGlyphs()}${Blink(`s${column}`, 1 + Pick(2 * every), every, every)}</g>`,
    )
    // The odd cell flickering between its glyph and another, every second or two.
    for (let row = 0; row < SVG_ROWS; row++) {
      if (random() >= FLICKER_CHANCE) continue
      const beat: number = Math.round((1 + random()) / TICK_SECONDS)
      swapped.push(
        `<g visibility="hidden"><rect x="${x}" y="${row * ROW_HEIGHT}" width="${COLUMN_WIDTH}" height="${ROW_HEIGHT}" fill="#000"/>` +
          `<text transform="translate(${x + COLUMN_WIDTH / 2} 0) scale(-1 1)" y="${baseline(row)}">${Glyph()}</text>` +
          `${Blink(`f${column}_${row}`, 1 + Pick(2 * beat), beat, beat)}</g>`,
      )
    }
  }

  // Each group's loop: a <set> per row it moves. First the lead-in: the band starts
  // dark, its view SVG_ROWS rows below the trails, and the drops rain in from the top;
  // then the loop, over and over. Every step has its own time, from the start or from
  // the loop's clock (a <set> that starts itself again), never from the step before:
  // a browser that draws the band only now and then (an idle window) still shows the
  // step of the moment, as a chain of steps would only crawl along, one per drawing.
  const groups: string[] = []
  TICKS_PER_ROW.forEach((ticks: number, group: number) => {
    const clock: string = `c${group}`
    const sets: string[] = [
      `<set id="${clock}" attributeName="visibility" to="visible" begin="${Ticks((SVG_ROWS + 1) * ticks)};${clock}.end" ` +
        `dur="${Ticks(PERIOD * ticks)}"/>`,
    ]
    for (let step = 0; step < SVG_ROWS + PERIOD; step++) {
      const row: number = PERIOD + SVG_ROWS - 1 - step // the loop's row at the band's top
      const begin: string =
        step < SVG_ROWS ? Ticks((step + 1) * ticks) : `${clock}.begin+${Ticks((step - SVG_ROWS) * ticks)}`
      sets.push(`<set attributeName="y" to="${-row * ROW_HEIGHT}" begin="${begin}" dur="${Ticks(ticks)}"/>`)
    }
    defs.push(`<g id="p${group}">${trails[group]!.join('')}<g fill="${HEAD_COLOR}">${heads[group]!.join('')}</g></g>`)
    groups.push(`<use href="#p${group}" y="${-(PERIOD + SVG_ROWS) * ROW_HEIGHT}">${sets.join('')}</use>`)
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
    `<style>text{font:bold 16px 'MS Gothic','Yu Gothic','Consolas',monospace;text-anchor:middle}</style>` +
    `<defs>${defs.join('')}<mask id="glyphs" maskUnits="userSpaceOnUse" x="0" y="0" width="${drawn}" height="${height}">` +
    `<g fill="#fff">${glyphs.join('')}${swapped.join('')}</g></mask></defs>` +
    `<g mask="url(#glyphs)">${groups.join('')}</g></svg>`
  )
}
