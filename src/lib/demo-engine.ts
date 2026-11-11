import type { Model, Redaction } from './data'

type AnswerInput = {
  prompt: string
  files: string[]
  images?: string[]
  redactions: Redaction[]
  model: Model
  context?: string
}

type Side = {
  coef: number
  constant: number
}

function firstName(redactions: Redaction[]) {
  return redactions.find((item) => item.kind === 'name')?.placeholder
}

function attachmentLine(files: string[]) {
  if (!files.length) return ''
  const noun = files.length === 1 ? 'attachment' : 'attachments'
  const names = files.slice(0, 3).join(', ')
  return `\nThe ${noun} ${names} ${files.length === 1 ? 'was' : 'were'} included in the local context window.`
}

function fmt(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function normalizeMath(text: string) {
  return text.replace(/[−–—]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/')
}

/** Safe recursive-descent evaluator for + - * / and parentheses. */
function evalExpression(input: string): number | null {
  const source = input.replace(/\s+/g, '')
  let index = 0

  const peek = () => source[index]

  function parseExpression(): number | null {
    let value = parseTerm()
    if (value === null) return null
    while (peek() === '+' || peek() === '-') {
      const op = source[index++]
      const next = parseTerm()
      if (next === null) return null
      value = op === '+' ? value + next : value - next
    }
    return value
  }

  function parseTerm(): number | null {
    let value = parseFactor()
    if (value === null) return null
    while (peek() === '*' || peek() === '/') {
      const op = source[index++]
      const next = parseFactor()
      if (next === null) return null
      if (op === '/' && next === 0) return null
      value = op === '*' ? value * next : value / next
    }
    return value
  }

  function parseFactor(): number | null {
    if (peek() === '+') {
      index += 1
      return parseFactor()
    }
    if (peek() === '-') {
      index += 1
      const value = parseFactor()
      return value === null ? null : -value
    }
    if (peek() === '(') {
      index += 1
      const value = parseExpression()
      if (value === null || peek() !== ')') return null
      index += 1
      return value
    }
    const start = index
    while (index < source.length && /[0-9.]/.test(source[index])) index += 1
    if (start === index) return null
    const value = Number(source.slice(start, index))
    return Number.isFinite(value) ? value : null
  }

  const result = parseExpression()
  if (result === null || index !== source.length) return null
  return result
}

function formatCoefTerm(coef: number): string {
  if (coef === 0) return '0'
  if (coef === 1) return 'x'
  if (coef === -1) return '-x'
  if (Number.isInteger(coef)) return `${coef}x`

  const reciprocal = 1 / coef
  if (Math.abs(reciprocal - Math.round(reciprocal)) < 1e-9) {
    const denominator = Math.abs(Math.round(reciprocal))
    return coef > 0 ? `x/${denominator}` : `-x/${denominator}`
  }
  return `${fmt(coef)}x`
}

/** Parse a linear expression (including parentheses) into coeff·x + constant. */
function parseLinear(side: string): Side | null {
  const source = side.replace(/\s+/g, '').toLowerCase()
  if (!source) return null
  let index = 0

  const peek = () => source[index]

  function expression(): Side | null {
    let value = term()
    if (!value) return null
    while (peek() === '+' || peek() === '-') {
      const op = source[index++]
      const next = term()
      if (!next) return null
      value =
        op === '+'
          ? { coef: value.coef + next.coef, constant: value.constant + next.constant }
          : { coef: value.coef - next.coef, constant: value.constant - next.constant }
    }
    return value
  }

  function term(): Side | null {
    let value = factor()
    if (!value) return null

    while (peek() === '*' || peek() === '/' || peek() === '(') {
      if (peek() === '(') {
        const next = factor()
        if (!next) return null
        const product = multiply(value, next)
        if (!product) return null
        value = product
        continue
      }

      const op = source[index++]
      const next = factor()
      if (!next) return null

      if (op === '*') {
        const product = multiply(value, next)
        if (!product) return null
        value = product
      } else {
        if (next.coef !== 0 || next.constant === 0) return null
        value = {
          coef: value.coef / next.constant,
          constant: value.constant / next.constant,
        }
      }
    }

    return value
  }

  function multiply(left: Side, right: Side): Side | null {
    if (left.coef !== 0 && right.coef !== 0) return null
    if (right.coef !== 0) {
      return {
        coef: left.constant * right.coef,
        constant: left.constant * right.constant,
      }
    }
    return {
      coef: left.coef * right.constant,
      constant: left.constant * right.constant,
    }
  }

  function factor(): Side | null {
    if (peek() === '+') {
      index += 1
      return factor()
    }
    if (peek() === '-') {
      index += 1
      const value = factor()
      return value ? { coef: -value.coef, constant: -value.constant } : null
    }
    if (peek() === '(') {
      index += 1
      const value = expression()
      if (!value || peek() !== ')') return null
      index += 1
      return value
    }
    if (peek() === 'x') {
      index += 1
      return { coef: 1, constant: 0 }
    }

    const start = index
    while (index < source.length && /[0-9.]/.test(source[index])) index += 1
    if (start === index) return null
    const value = Number(source.slice(start, index))
    if (!Number.isFinite(value)) return null

    if (peek() === 'x') {
      index += 1
      return { coef: value, constant: 0 }
    }
    return { coef: 0, constant: value }
  }

  const result = expression()
  if (!result || index !== source.length) return null
  return result
}

function extractEquation(prompt: string): string | null {
  const text = normalizeMath(prompt)
  const match = text.match(/[0-9x][0-9x+\-*/=.\s()]*=[0-9x+\-*/=.\s()]*/i)
  if (!match) return null
  const equation = match[0].trim()
  if (!/x/i.test(equation) || !/[0-9]/.test(equation)) return null
  if ((equation.match(/=/g) ?? []).length !== 1) return null
  return equation
}

function extractArithmetic(prompt: string): string | null {
  let text = normalizeMath(prompt.toLowerCase())
  text = text
    .replace(/\b(what'?s|what\s+is|calculate|compute|evaluate|solve|please|the\s+answer\s+to|how\s+much\s+is)\b/g, ' ')
    .replace(/[?!]/g, ' ')
    .replace(/[.]+$/, '')
    .trim()

  if (!text || text.includes('=')) return null
  if (!/^[0-9+\-*/().\s]+$/.test(text)) return null
  if (!/[0-9]/.test(text) || !/[+\-*/]/.test(text)) return null
  return text
}

function mathAnswer(prompt: string): string | null {
  const equation = extractEquation(prompt)
  if (equation) return equationAnswer(equation)

  const arithmetic = extractArithmetic(prompt)
  if (arithmetic) {
    const value = evalExpression(arithmetic)
    if (value === null) return null
    const display = arithmetic.replace(/\s+/g, ' ').trim()
    return `## Result
**${display} = ${fmt(value)}**

> Calculated locally by Mint's demo engine.`
  }

  return null
}

function equationAnswer(equation: string): string | null {
  const sides = equation.split('=')
  const left = parseLinear(sides[0])
  const right = parseLinear(sides[1])
  if (!left || !right) return null

  const coef = left.coef - right.coef
  const constant = right.constant - left.constant
  const display = equation.replace(/\s+/g, ' ').trim()

  if (coef === 0) {
    if (constant === 0) {
      return `## Solution
This equation is an identity: every value of \`x\` satisfies it.

Start with \`${display}\` — the \`x\` terms cancel and both sides are equal.

> Solved locally by Mint's demo engine.`
    }
    return `## Solution
This equation has **no solution**.

Start with \`${display}\` — the \`x\` terms cancel, leaving \`${fmt(constant)} = 0\`, which is false.

> Solved locally by Mint's demo engine.`
  }

  const solution = constant / coef
  const steps = [`Start with \`${display}\`.`]

  if (right.coef !== 0) {
    steps.push(`Collect the \`x\` terms on the left: \`${formatCoefTerm(coef)} = ${fmt(constant)}\`.`)
  } else if (left.constant !== 0) {
    steps.push(`Move the constant to the right: \`${formatCoefTerm(left.coef)} = ${fmt(constant)}\`.`)
  }

  if (coef !== 1) {
    const reciprocal = 1 / coef
    if (Math.abs(coef) < 1 && Math.abs(reciprocal - Math.round(reciprocal)) < 1e-9) {
      steps.push(
        `Multiply both sides by ${fmt(Math.round(reciprocal))}: \`x = ${fmt(solution)}\`.`,
      )
    } else {
      steps.push(`Divide both sides by ${fmt(coef)}: \`x = ${fmt(solution)}\`.`)
    }
  }

  const substituted = display.replace(/x/gi, `(${fmt(solution)})`)
  const leftValue = left.coef * solution + left.constant
  const rightValue = right.coef * solution + right.constant
  const check = `Substituting \`x = ${fmt(solution)}\` back in: \`${substituted}\` → ${fmt(leftValue)} = ${fmt(rightValue)}. ✓`

  return `## Solution
**x = ${fmt(solution)}**

### Steps
${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}

### Check
${check}

> Solved locally by Mint's demo engine.`
}

function legalAnswer({ prompt, files, redactions }: AnswerInput) {
  const person = firstName(redactions)
  const subject = person ? `For ${person}, the` : 'The'
  return `## Risk read
${subject} excerpt is structurally conventional, but three points deserve a closer look before anyone signs. This is a directional review, not legal advice.

### 1. Liability exposure is asymmetric
The indemnity language appears to flow both ways while the limitation-of-liability clause protects only one side. That leaves the other party carrying a disproportionate share of downstream risk.
- **Priority:** High
- **Ask:** Make the cap mutual and tie it to fees paid in the prior 12 months.

### 2. Renewal may be easy to miss
The notice window for auto-renewal is shorter than a normal procurement cycle. A missed date can lock the team into another full term.
- **Priority:** Medium
- **Ask:** Extend the notice period to 60 days and add a renewal reminder obligation.

### 3. Obligations need named owners
Several delivery and cooperation duties are written in passive language. They are enforceable, but operationally unclear.
- **Priority:** Medium
- **Ask:** Assign each obligation to a named role and add a response-time expectation.

## Recommended next moves
- Return a redline covering the liability cap, renewal window, and ownership language.
- Ask for the full master agreement before approving the excerpt.
- Route the revised version through counsel for a final privilege review.

> Context note: ${prompt.slice(0, 140)}${prompt.length > 140 ? '…' : ''}${attachmentLine(files)}`
}

function researchAnswer({ prompt, files, redactions }: AnswerInput) {
  const person = firstName(redactions)
  const subject = person ? `${person}'s` : 'The'
  return `## Executive summary
${subject} material makes a coherent argument, but the conclusion is stronger than the evidence currently provided. The core thesis holds; the confidence around it should be tightened.${attachmentLine(files)}

### Strongest arguments
1. **The framing is clear.** The central claim is stated early and stays consistent through the supporting sections.
2. **The evidence is directional.** The examples point in the same direction, which makes the case easy to follow.
3. **The recommendations are actionable.** Each finding maps to a next step rather than stopping at observation.

### Where the case is thin
- The sample size is not established, so the results should be described as indicative rather than conclusive.
- The counterargument is acknowledged but not tested. One paragraph on disconfirming evidence would materially improve credibility.
- Several claims need a source or a date attached before this is shared externally.

### Suggested next steps
- Add a short methodology note covering sources, sample size, and time period.
- Separate observed findings from interpretation in the summary.
- Run one adversarial review before publishing. The strongest version of this work will survive it.

> Context note: ${prompt.slice(0, 140)}${prompt.length > 140 ? '…' : ''}${attachmentLine(files)}`
}

function replyAnswer({ prompt, files, redactions }: AnswerInput) {
  const person = firstName(redactions)
  const salutation = person ? `Hi ${person},` : 'Hi,'
  return `## Draft reply

**Subject:** Re: Q3 forecast — next steps

${salutation}

Thanks for sending this through. I have reviewed the forecast and the attached material. The direction is sound, and the near-term assumptions look reasonable, but I would like to tighten two points before we circulate it more widely.

First, the revenue bridge would benefit from a clearer split between committed pipeline and weighted opportunity. Second, the cost assumptions should include a sensitivity case so the team can see where the plan breaks if volume lands below target.

I can turn those changes around by Thursday. If it is useful, I can also prepare a one-page summary for the leadership review.

Best,
[Your name]

### Why this version works
- It acknowledges the work before introducing changes.
- It names two concrete edits rather than offering vague feedback.
- It closes with a specific, low-friction next step.

> Context note: ${prompt.slice(0, 140)}${prompt.length > 140 ? '…' : ''}${attachmentLine(files)}`
}

function codeAnswer({ prompt, files }: AnswerInput) {
  return `## Review summary
The implementation is readable and the separation of concerns is mostly sound. I would address correctness at the boundaries first, then simplify the control flow.${attachmentLine(files)}

### High-impact findings
1. **Validate at the edge.** External input reaches core logic before shape checks. Add one validation layer and return typed errors.
2. **Make failures observable.** The catch path currently swallows context. Log the operation, the input identifier, and the error class — never raw personal data.
3. **Remove hidden shared state.** The module-level mutation makes tests order-dependent and can leak between requests.

### Suggested patch order
- Add boundary validation and fixtures for malformed input.
- Replace the shared mutation with an explicit dependency.
- Add a regression test for the failure path.
- Re-run the full suite under concurrency before shipping.

### Quick quality note
The naming is strong and the happy path is easy to follow. The next gain is not more abstraction; it is clearer failure behavior.

> Context note: ${prompt.slice(0, 140)}${prompt.length > 140 ? '…' : ''}${attachmentLine(files)}`
}

function defaultAnswer({ prompt, files, redactions }: AnswerInput) {
  const person = firstName(redactions)
  const audience = person ? `\nPrepared for ${person}.` : ''
  const trimmed = prompt.trim()
  const excerpt = trimmed.slice(0, 180)
  return `## Local demo limitation
Live inference is not configured, so this reply comes from Mint's built-in demo engine — not a language model. It only covers a few scripted patterns: legal excerpts, research summaries, email drafts, code reviews, and simple math. It has no real answer for this request.

**Prompt:** ${excerpt}${trimmed.length > 180 ? '…' : ''}${attachmentLine(files)}${audience}`
}

function withImageNote(answer: string, images: string[] | undefined) {
  if (!images?.length) return answer
  const noun = images.length === 1 ? 'image' : 'images'
  const pronoun = images.length === 1 ? 'its' : 'their'
  return `${answer}\n\n> Image note: the local demo engine can name the attached ${noun} (${images.join(', ')}) but cannot inspect ${pronoun} pixels. Use a vision model for a real reading.`
}

export function buildDemoAnswer(input: AnswerInput): string {
  const math = mathAnswer(input.prompt)
  if (math) return withImageNote(math, input.images)

  const text = `${input.prompt} ${input.files.join(' ')} ${input.context ?? ''}`.toLowerCase()
  if (/\b(contract|legal|liabil|clause|renewal|agreement)\b/.test(text)) return withImageNote(legalAnswer(input), input.images)
  if (/\b(research|study|paper|argument|thesis|analy[sz]e|summari[sz]e|summary|report|evidence)\b/.test(text)) return withImageNote(researchAnswer(input), input.images)
  if (/\b(reply|email|respond|draft|message|follow.?up)\b/.test(text)) return withImageNote(replyAnswer(input), input.images)
  if (/\b(code|function|bug|refactor|typescript|javascript|python|api)\b/.test(text)) return withImageNote(codeAnswer(input), input.images)
  return withImageNote(defaultAnswer(input), input.images)
}

export function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? []
}
