import { Clock, ShieldAlert, Zap } from 'lucide-react'
import { useBlock, useNow } from '../hooks/useBlock'
import { describeDuration, formatCountdown, type BlockKind } from '../lib/blocks'

/** A live m:ss / h:mm:ss readout that ticks until `until`. Hidden from screen readers, which would read every tick. */
export function Countdown({ until }: { until: number }) {
  const now = useNow(until)
  return (
    <time className="countdown" aria-hidden="true">
      {formatCountdown(until - now)}
    </time>
  )
}

const COPY: Record<BlockKind, { title: string; icon: typeof Clock; tone: 'amber' | 'red' }> = {
  rate: { title: 'Message limit reached', icon: Clock, tone: 'amber' },
  spam: { title: 'Slow down', icon: Zap, tone: 'amber' },
  ban: { title: 'This device is blocked', icon: ShieldAlert, tone: 'red' },
}

function Detail({ kind, time }: { kind: BlockKind; time: string }) {
  if (kind === 'rate') {
    return (
      <>
        You can send again in <strong className="countdown" aria-hidden="true">{time}</strong>.
      </>
    )
  }
  if (kind === 'spam') {
    return (
      <>
        Messages are arriving too fast. Stop for a moment and sending unlocks in{' '}
        <strong className="countdown" aria-hidden="true">{time}</strong>. Sending more restarts the timer.
      </>
    )
  }
  return (
    <>
      Requests from this device were altered, so it is blocked for{' '}
      <strong className="countdown" aria-hidden="true">{time}</strong>.
    </>
  )
}

/**
 * Shown above the composer while sending is paused, with the time left ticking
 * down live. Send is disabled for the same period (see Composer); the server
 * enforces the pause either way.
 */
export function LimitBanner() {
  const { block, remainingMs } = useBlock()
  if (!block) return null

  const copy = COPY[block.kind]
  const total = Math.max(1, block.until - block.startedAt)
  const Icon = copy.icon
  return (
    <div className={`limit-banner is-${copy.tone}`} role="alert">
      <Icon size={15} aria-hidden="true" />
      <div className="limit-banner-copy">
        <strong>{copy.title}</strong>
        <span>
          <Detail kind={block.kind} time={formatCountdown(remainingMs)} />
          <span className="sr-only"> Sending is paused for about {describeDuration(total)}.</span>
        </span>
      </div>
      <div className="limit-banner-track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (remainingMs / total) * 100)}%` }} />
      </div>
    </div>
  )
}
