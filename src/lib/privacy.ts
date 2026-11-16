import type { Redaction } from './data'
import { MIDDLE_EASTERN_GIVEN_NAMES, NAME_PARTICLES } from './middleEasternNames'
import {
  LEADING_VERBS,
  NON_NAME_FIRST_WORDS,
  plainWord,
  TOPIC_DETERMINERS,
  TOPIC_WORDS,
} from './nonNames'

const NAME_STOPWORDS = new Set([
  'A',
  'About',
  'After',
  'All',
  'Also',
  'An',
  'And',
  'Any',
  'Are',
  'As',
  'Ask',
  'At',
  'Attached',
  'Be',
  'Because',
  'Before',
  'But',
  'By',
  'Can',
  'Check',
  'Contact',
  'Create',
  'Describe',
  'Draft',
  'Each',
  'Every',
  'Explain',
  'Hello',
  'Hey',
  'Hi',
  'Find',
  'Flag',
  'For',
  'Friday',
  'From',
  'Generate',
  'Give',
  'Help',
  'Here',
  'How',
  'I',
  'Identify',
  'If',
  'In',
  'Include',
  'Into',
  'Is',
  'It',
  'Its',
  'List',
  'Make',
  'Monday',
  'My',
  'Note',
  'Of',
  'On',
  'One',
  'Or',
  'Our',
  'Please',
  'Review',
  'She',
  'Show',
  'So',
  'Summarize',
  'Tell',
  'That',
  'The',
  'Their',
  'Then',
  'There',
  'These',
  'They',
  'This',
  'Those',
  'Three',
  'To',
  'Two',
  'Use',
  'We',
  'What',
  'When',
  'Where',
  'Which',
  'Who',
  'Why',
  'With',
  'Write',
  'You',
  'Your',
  'AI',
  'API',
  'CSV',
  'Data',
  'Docs',
  'Email',
  'File',
  'Google',
  'JSON',
  'Mint',
  'NVIDIA',
  'OpenAI',
  'PDF',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Report',
  'Security',
  'Team',
  'Workspace',
])

const SECOND_WORD_STOPWORDS = new Set([
  'AI',
  'API',
  'Agreement',
  'Bank',
  'Brief',
  'Capital',
  'Chain',
  'Cloud',
  'Company',
  'Contract',
  'Corp',
  'Counsel',
  'Customer',
  'Data',
  'Director',
  'Docs',
  'Enterprises',
  'File',
  'Foundation',
  'Friday',
  'GmbH',
  'Group',
  'Health',
  'Holdings',
  'Inc',
  'Institute',
  'Intelligence',
  'LLC',
  'LLP',
  'Labs',
  'Ltd',
  'Management',
  'Manager',
  'Media',
  'Mint',
  'Monday',
  'Networks',
  'Officer',
  'Operations',
  'Partners',
  'Platform',
  'PLC',
  'Product',
  'Project',
  'Report',
  'SaaS',
  'Security',
  'Services',
  'Solutions',
  'Strategy',
  'Systems',
  'Team',
  'Technologies',
  'Thursday',
  'Tuesday',
  'University',
  'Vendor',
  'Wednesday',
  'Workspace',
])

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g

// Capitalized token (supports accents, apostrophes, hyphens). Used for ME-name spans.
const NAME_TOKEN_RE =
  /\b([A-Z\u00C0-\u024F\u0621-\u064A][\p{L}\p{M}'’.-]*|\p{Lu}[\p{L}\p{M}'’.-]*)/gu

function normalizeNameToken(token: string) {
  return token
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’.-]/g, '')
}

function isMiddleEasternName(token: string) {
  const norm = normalizeNameToken(token)
  return norm.length > 1 && MIDDLE_EASTERN_GIVEN_NAMES.has(norm)
}

/** One capitalised word of a name, accents included: "Ana", "García", "O’Neil", "Al-Zahra", "Zoë". */
const NAME_WORD = "\\p{Lu}[\\p{Ll}\\p{M}]+(?:['’-]\\p{Lu}?[\\p{Ll}\\p{M}]+)?"
// JavaScript's \b only knows A-Z, so "Émile" or "García" need letter-aware edges.
const NAME_EDGE_BEFORE = '(?<![\\p{L}\\p{M}])'
const NAME_EDGE_AFTER = '(?![\\p{L}\\p{M}])'

/** Whether the text right before `index` is "the", "a", "this" and so on. */
function afterDeterminer(text: string, index: number): boolean {
  return TOPIC_DETERMINERS.test(text.slice(Math.max(0, index - 16), index))
}

/**
 * True when a name-shaped span is really a topic, place, event or work:
 * "the French Revolution", "Cold War", "New York", "Ohm’s Law". `index` is
 * where the span starts in `text`; without it, every place the span appears
 * is checked and it counts as a thing only if each one reads as a thing.
 */
export function looksLikeThing(span: string, text: string, index?: number): boolean {
  const words = span.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  if (words.some((word) => TOPIC_WORDS.has(plainWord(word)))) return true
  if (NON_NAME_FIRST_WORDS.has(plainWord(words[0]))) return true
  // People are never written "Ohm’s Law" or "Newton’s Laws".
  if (words.slice(0, -1).some((word) => /['’]s$/u.test(word))) return true

  // Words that end company names ("Inc", "Product") count anywhere after the first.
  if (words.slice(1).some((word) => SECOND_WORD_STOPWORDS.has(word))) return true

  const readsAsThing = (at: number) => afterDeterminer(text, at) || isEponym(span, text, at)
  if (index !== undefined) return readsAsThing(index)
  const places: number[] = []
  for (let at = text.indexOf(span); at >= 0 && places.length < 50; at = text.indexOf(span, at + span.length)) {
    places.push(at)
  }
  return places.length > 0 && places.every(readsAsThing)
}

/**
 * "Pascal’s Triangle", "Boyle’s Law": a name in the possessive followed by a
 * capitalised word is the name of a theorem or a place, not a person being
 * talked about. "Sarah’s essay" (lowercase after) is still a person.
 */
function isEponym(span: string, text: string, index: number): boolean {
  const end = index + span.length
  const possessive = /['’]s$/u.test(span) ? '' : (/^['’]s/u.exec(text.slice(end))?.[0] ?? null)
  if (possessive === null) return false
  return /^\s+\p{Lu}/u.test(text.slice(end + possessive.length))
}

/** Drops greetings and instructions from the front: "Ask Priya Nair" becomes "Priya Nair". */
function withoutLeadingWords(words: string[]): number {
  let skip = 0
  while (
    skip < words.length &&
    (NAME_STOPWORDS.has(words[skip]) || LEADING_VERBS.has(plainWord(words[skip])))
  ) {
    skip += 1
  }
  return skip
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Runs entirely in the browser. We intentionally keep detection conservative
 * and expose every substitution so a person can audit what would be sent.
 *
 * Name detection combines:
 * - pattern-based full names and explicit introductions
 * - Compromise.js person-entity NLP
 * - a curated list of common Middle Eastern given names (local matching)
 */
export function detectRedactions(text: string, people: string[] = []): Redaction[] {
  if (!text.trim()) return []

  const found: Redaction[] = []
  const seen = new Set<string>()
  let nameIndex = 0
  let emailIndex = 0
  let phoneIndex = 0

  const push = (original: string, placeholder: string, kind: Redaction['kind']) => {
    const trimmed = original.trim()
    if (!trimmed) return
    const key = `${kind}:${trimmed.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ original: trimmed, placeholder, kind })
  }

  const covers = (value: string) => {
    const lower = value.toLowerCase()
    return found.some(
      (item) => item.kind === 'name' && item.original.toLowerCase() === lower,
    )
  }

  const coveredByExisting = (value: string) => {
    const lower = value.toLowerCase()
    return found.some((item) => {
      if (item.kind !== 'name') return false
      const existing = item.original.toLowerCase()
      return existing === lower || existing.includes(lower) || lower.includes(existing)
    })
  }

  const nextName = () => {
    nameIndex += 1
    return `[PERSON_${String(nameIndex).padStart(2, '0')}]`
  }

  const pushName = (original: string) => {
    const trimmed = original.trim()
    if (!trimmed) return
    // Skip if an identical name or a containing/contained name span already exists.
    if (coveredByExisting(trimmed)) return
    // If this is a longer span containing an existing single-token name, replace it.
    const lower = trimmed.toLowerCase()
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const item = found[i]
      if (item.kind === 'name' && lower.includes(item.original.toLowerCase()) && lower !== item.original.toLowerCase()) {
        // keep the longer span by upgrading the original in-place
        item.original = trimmed
        seen.delete(`name:${item.original.toLowerCase()}`)
        // rebuild seen for the new value below
      }
    }
    // Re-check after possible in-place upgrades: avoid duplicates by final value
    const finalLower = trimmed.toLowerCase()
    const exists = found.some(
      (item) => item.kind === 'name' && item.original.toLowerCase() === finalLower,
    )
    if (exists) return
    // prune any shorter names now fully covered by this span
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const item = found[i]
      if (item.kind === 'name' && finalLower.includes(item.original.toLowerCase()) && item.original.toLowerCase() !== finalLower) {
        seen.delete(`name:${item.original.toLowerCase()}`)
        found.splice(i, 1)
      }
    }
    push(trimmed, nextName(), 'name')
  }

  const emailMatches = text.match(EMAIL_RE) ?? []
  for (const email of emailMatches) {
    emailIndex += 1
    push(email, `[EMAIL_${String(emailIndex).padStart(2, '0')}]`, 'email')
  }

  const phoneMatches = text.match(PHONE_RE) ?? []
  for (const phone of phoneMatches) {
    if (phone.replace(/\D/g, '').length < 10) continue
    phoneIndex += 1
    push(phone.trim(), `[PHONE_${String(phoneIndex).padStart(2, '0')}]`, 'phone')
  }

  // Title-case full names first, capped at three words to avoid swallowing sentences.
  // Accented letters count as letters: with plain [a-z], "García" matched as
  // "Garc" and the shielded text read "[PERSON_01]ía", leaking the rest.
  const nameRe = new RegExp(
    `${NAME_EDGE_BEFORE}(${NAME_WORD})\\s+(${NAME_WORD})(?:\\s+(${NAME_WORD}))?${NAME_EDGE_AFTER}`,
    'gu',
  )
  for (const match of text.matchAll(nameRe)) {
    const matched = [match[1], match[2], match[3]].filter((word): word is string => Boolean(word))
    // A sentence often opens with an instruction ("Ask Priya Nair"): skip it
    // rather than throwing away the name that follows.
    const skip = withoutLeadingWords(matched)
    const words = matched.slice(skip)
    if (words.length < 2 || SECOND_WORD_STOPWORDS.has(words[1])) continue
    let offset = 0
    for (let i = 0; i < skip; i += 1) offset = match[0].indexOf(matched[i + 1], offset + matched[i].length)
    const name = words.join(' ')
    if (looksLikeThing(name, text, (match.index ?? 0) + offset)) continue
    if (!covers(name)) pushName(name)
  }

  // Explicit introductions such as "my name is Ada" or "I'm Ada".
  // The phrase is case-insensitive by hand ("I am", "My name is"); an `i` flag
  // would also let \p{Lu} match lowercase and turn "i am tired" into a name.
  const introRe = new RegExp(
    `\\b(?:[Mm]y name is|[Ii] am|[Ii]['’]m|[Cc]all me)\\s+(${NAME_WORD})${NAME_EDGE_AFTER}`,
    'gu',
  )
  for (const match of text.matchAll(introRe)) {
    const name = match[1]
    if (!name || NAME_STOPWORDS.has(name)) continue
    // "I'm French", "I am Year Ten": an introduction, but not of a name.
    if (TOPIC_WORDS.has(plainWord(name)) || NON_NAME_FIRST_WORDS.has(plainWord(name))) continue
    const lower = name.toLowerCase()
    if (
      found.some(
        (item) =>
          item.kind === 'name' &&
          (item.original.toLowerCase() === lower ||
            item.original.toLowerCase().startsWith(`${lower} `)),
      )
    ) {
      continue
    }
    pushName(name)
  }

  // Compromise.js NLP: detect person entities. The caller loads the library
  // lazily so it stays out of the initial bundle.
  for (const person of people) {
    const cleaned = person
      .replace(/^(mr|mrs|ms|dr|prof)\.?\s+/i, '')
      .replace(/[.,!?;:]+$/g, '')
      .trim()
    if (!cleaned || cleaned.length < 2) continue
    // Require at least one capitalized/name-like token to avoid junk.
    if (!/[A-Z\u00C0-\u024F]/.test(cleaned)) continue
    if (NAME_STOPWORDS.has(cleaned)) continue
    // The NLP model also tags "Mona Lisa" or "Cold War" as people now and then.
    if (looksLikeThing(cleaned, text)) continue
    pushName(cleaned)
  }

  // Custom Middle Eastern name list: match known given names as whole tokens,
  // and extend to a short capitalized name span (e.g. "Omar Al-Farsi").
  const tokens = Array.from(text.matchAll(NAME_TOKEN_RE)).map((m) => ({
    value: m[0],
    index: m.index ?? 0,
  }))
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!isMiddleEasternName(token.value)) continue
    if (NAME_STOPWORDS.has(token.value)) continue

    // Grow a span forward over capitalized tokens / particles (max 4 words total).
    let end = token.index + token.value.length
    let words = [token.value]
    let j = i + 1
    while (j < tokens.length && words.length < 4) {
      const prevEnd = end
      const next = tokens[j]
      const gap = text.slice(prevEnd, next.index)
      if (!/^\s+$/.test(gap)) break
      const norm = normalizeNameToken(next.value)
      if (NAME_STOPWORDS.has(next.value) || SECOND_WORD_STOPWORDS.has(next.value)) break
      if (NAME_PARTICLES.has(norm) || isMiddleEasternName(next.value) || /^[A-Z]/.test(next.value)) {
        words.push(next.value)
        end = next.index + next.value.length
        j += 1
        // stop after adding a clear non-name capitalized tail unless it's a particle/known name
        if (!NAME_PARTICLES.has(norm) && !isMiddleEasternName(next.value) && words.length >= 3) break
      } else {
        break
      }
    }
    const span = text.slice(token.index, end).trim()
    if (!span) continue
    if (!looksLikeThing(span, text, token.index)) {
      pushName(span)
    } else if (words.length > 1 && !looksLikeThing(token.value, text, token.index)) {
      // "Ali Mountain Road" is not a name, but the given name on its own still is.
      pushName(token.value)
    }
  }

  // Preserve stable numbering by order of first appearance in text.
  found.sort((a, b) => {
    const ia = text.toLowerCase().indexOf(a.original.toLowerCase())
    const ib = text.toLowerCase().indexOf(b.original.toLowerCase())
    return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib)
  })
  // Reassign sequential placeholders per kind in appearance order.
  let n = 0,
    e = 0,
    p = 0
  for (const item of found) {
    if (item.kind === 'name') item.placeholder = `[PERSON_${String(++n).padStart(2, '0')}]`
    else if (item.kind === 'email') item.placeholder = `[EMAIL_${String(++e).padStart(2, '0')}]`
    else if (item.kind === 'phone') item.placeholder = `[PHONE_${String(++p).padStart(2, '0')}]`
  }

  return found
}

/**
 * Adds NLP person detection on top of the pattern-based pass. Compromise is
 * loaded on demand because it is the heaviest dependency in the client.
 */
type Nlp = typeof import('compromise').default
let nlpLoad: Promise<Nlp | null> | null = null

/** Starts loading the name detector (~350 KB) early, so the first send never waits on it. */
export function preloadNameDetector(): Promise<Nlp | null> {
  nlpLoad ??= import('compromise').then((module) => module.default).catch(() => null)
  return nlpLoad
}

export async function detectRedactionsAsync(text: string): Promise<Redaction[]> {
  if (!text.trim()) return []
  let people: string[] = []
  try {
    const nlp = await preloadNameDetector()
    if (nlp) people = nlp(text).people().out('array') as string[]
  } catch {
    // NLP is best-effort; pattern and list matching still run.
  }
  return detectRedactions(text, people)
}

export function redactText(text: string, redactions: Redaction[]): string {
  let output = text
  const ordered = [...redactions].sort((a, b) => b.original.length - a.original.length)
  for (const item of ordered) {
    if (!item.original) continue
    const escaped = escapeRegex(item.original)
    output = output.replace(new RegExp(escaped, 'gi'), item.placeholder)
  }
  return output
}

const PLACEHOLDER_LABEL: Record<Redaction['kind'], string> = {
  name: 'PERSON',
  email: 'EMAIL',
  phone: 'PHONE',
}

/**
 * Joins redaction lists into one list for a whole request. Earlier lists keep
 * their placeholders; an original that was already seen is dropped, and a new
 * one whose placeholder is taken (every turn numbers from 01) gets the next
 * free number, so one placeholder never stands for two different people.
 */
export function mergeRedactions(...lists: Redaction[][]): Redaction[] {
  const merged: Redaction[] = []
  const seen = new Set<string>()
  const used = new Set<string>()
  for (const list of lists) {
    for (const item of list) {
      const original = item.original?.trim()
      if (!original) continue
      const key = `${item.kind}:${original.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      let placeholder = item.placeholder
      if (!placeholder || used.has(placeholder)) {
        let number = 1
        do {
          placeholder = `[${PLACEHOLDER_LABEL[item.kind]}_${String(number).padStart(2, '0')}]`
          number += 1
        } while (used.has(placeholder))
      }
      used.add(placeholder)
      merged.push({ original, placeholder, kind: item.kind })
    }
  }
  return merged
}

export function rehydrateText(text: string, redactions: Redaction[]): string {
  let output = text
  for (const item of redactions) {
    output = output.split(item.placeholder).join(item.original)
  }
  return output
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
