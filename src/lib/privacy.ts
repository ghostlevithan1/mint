import type { Redaction } from './data'

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
  'Create',
  'Describe',
  'Draft',
  'Each',
  'Every',
  'Explain',
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

/**
 * Runs entirely in the browser. We intentionally keep detection conservative
 * and expose every substitution so a person can audit what would be sent.
 */
export function detectRedactions(text: string): Redaction[] {
  if (!text.trim()) return []

  const found: Redaction[] = []
  const seen = new Set<string>()
  let nameIndex = 0
  let emailIndex = 0
  let phoneIndex = 0

  const push = (original: string, placeholder: string, kind: Redaction['kind']) => {
    const key = `${kind}:${original.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ original, placeholder, kind })
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
  const nameRe =
    /\b([A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?)\s+([A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?)(?:\s+([A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?))?\b/g
  for (const match of text.matchAll(nameRe)) {
    const first = match[1]
    const second = match[2]
    const third = match[3]
    if (!first || !second) continue
    if (NAME_STOPWORDS.has(first) || SECOND_WORD_STOPWORDS.has(second)) continue
    const name = third ? `${first} ${second} ${third}` : `${first} ${second}`
    if (found.some((item) => item.original.toLowerCase() === name.toLowerCase())) continue
    nameIndex += 1
    push(name, `[PERSON_${String(nameIndex).padStart(2, '0')}]`, 'name')
  }

  // Explicit introductions such as "my name is Ada" or "I'm Ada". Skip names
  // already covered by a full-name match.
  const introRe = /\b(?:my name is|i am|i'm|call me)\s+([A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?)\b/g
  for (const match of text.matchAll(introRe)) {
    const name = match[1]
    if (!name || NAME_STOPWORDS.has(name)) continue
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
    nameIndex += 1
    push(name, `[PERSON_${String(nameIndex).padStart(2, '0')}]`, 'name')
  }

  return found
}

export function redactText(text: string, redactions: Redaction[]): string {
  let output = text
  const ordered = [...redactions].sort((a, b) => b.original.length - a.original.length)
  for (const item of ordered) {
    if (!item.original) continue
    const escaped = item.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    output = output.replace(new RegExp(escaped, 'gi'), item.placeholder)
  }
  return output
}

export function rehydrateText(text: string, redactions: Redaction[]): string {
  let output = text
  for (const item of redactions) {
    output = output.split(item.placeholder).join(item.original)
  }
  return output
}

export function estimateTokens(text: string): number {
  if (!text.trim()) return 0
  return Math.max(1, Math.round(text.trim().split(/\s+/).length * 1.34))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
