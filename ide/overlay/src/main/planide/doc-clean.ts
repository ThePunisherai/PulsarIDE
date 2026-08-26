/**
 * Strip AI provenance marks out of text a project writes.
 *
 * Modern models leave marks in generated prose. The ones that matter for a
 * document you are going to publish fall into layers, and only the first is
 * removable with no dependencies at all:
 *
 *   Layer A  invisible Unicode -- zero-width characters, bidirectional controls,
 *            Unicode tag characters (a real steganographic channel: an entire
 *            hidden message can be encoded in U+E0000..U+E007F and stays
 *            invisible in every editor), and lookalike spaces such as the
 *            narrow no-break space.
 *   Layer B  statistical token-sampling watermarks. Removing those means
 *            rewriting the text with a model -- not something to fake.
 *   Layer C  file metadata (C2PA, EXIF, XMP) inside binary containers.
 *
 * This does Layer A, honestly and completely, in pure TypeScript, so it works
 * for every agent with nothing installed. It is modelled on
 * guillaumemeyer/watermarks-remover (MIT), which covers all three layers as a
 * Python service; when that is installed we can hand off to it, but we do not
 * pretend to do B or C ourselves.
 *
 * Deliberately conservative: it only removes characters that carry no visible
 * meaning, and normalises a small set of lookalike spaces to a plain space. It
 * never touches ordinary punctuation, emoji, or any non-Latin script -- an
 * em dash and a Chinese character are content, not a watermark.
 */

/** Zero-width and invisible formatting characters. */
const ZERO_WIDTH = /[​‌‍⁠﻿]/g

/**
 * Bidirectional controls. These reorder how text RENDERS without changing what
 * it says, which is why they are both a watermark carrier and a spoofing trick.
 */
const BIDI = /[‎‏‪-‮⁦-⁩]/g

/**
 * Unicode tag characters (U+E0000..U+E007F). Invisible everywhere, and enough
 * to carry a whole hidden payload, so they are stripped outright.
 */
const TAGS = /[\u{E0000}-\u{E007F}]/gu

/** Other invisible/deprecated formatting marks. */
const INVISIBLE = /[­͏؜᠎⁡-⁤]/g

/**
 * Spaces that look like a normal space but are not. Normalised rather than
 * deleted -- the word gap is real, only the exotic codepoint is not.
 */
const ODD_SPACES = /[   -   　]/g

export type CleanReport = {
  cleaned: string
  /** How many of each kind were found, so the result can be reported honestly. */
  removed: { zeroWidth: number; bidi: number; tags: number; invisible: number; oddSpaces: number }
  total: number
  changed: boolean
}

function count(text: string, re: RegExp): number {
  const m = text.match(re)
  return m ? m.length : 0
}

/** Strip Layer-A marks from a string, reporting exactly what was taken out. */
export function cleanText(text: string): CleanReport {
  const removed = {
    zeroWidth: count(text, ZERO_WIDTH),
    bidi: count(text, BIDI),
    tags: count(text, TAGS),
    invisible: count(text, INVISIBLE),
    oddSpaces: count(text, ODD_SPACES)
  }
  const cleaned = text
    .replace(ZERO_WIDTH, '')
    .replace(BIDI, '')
    .replace(TAGS, '')
    .replace(INVISIBLE, '')
    .replace(ODD_SPACES, ' ')
  const total =
    removed.zeroWidth + removed.bidi + removed.tags + removed.invisible + removed.oddSpaces
  return { cleaned, removed, total, changed: cleaned !== text }
}

/** Report what is in a string without changing it. */
export function inspectText(text: string): Omit<CleanReport, 'cleaned'> {
  const { removed, total, changed } = cleanText(text)
  return { removed, total, changed }
}
