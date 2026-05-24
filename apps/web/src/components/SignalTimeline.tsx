import { GrowthSignal, SignalType } from '@public-records/core'
import { Card } from '@public-records/ui/card'
import { Badge } from '@public-records/ui/badge'
import { Briefcase, Certificate, Handshake, TrendUp, Toolbox, Pulse } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

interface SignalTimelineProps {
  signals: GrowthSignal[]
}

type SignalConfigEntry = { icon: typeof Briefcase; color: string; label: string }

const signalConfig: Record<SignalType, SignalConfigEntry> = {
  hiring: { icon: Briefcase, color: 'text-secondary', label: 'Hiring' },
  permit: { icon: Certificate, color: 'text-accent', label: 'Permit' },
  contract: { icon: Handshake, color: 'text-success', label: 'Contract' },
  expansion: { icon: TrendUp, color: 'text-primary', label: 'Expansion' },
  equipment: { icon: Toolbox, color: 'text-warning', label: 'Equipment' }
}

// Fallback for unknown/legacy signal types so config.icon/.color/.label never throw.
const DEFAULT_SIGNAL_CONFIG: SignalConfigEntry = {
  icon: Pulse,
  color: 'text-muted-foreground',
  label: 'Signal'
}

export function SignalTimeline({ signals }: SignalTimelineProps) {
  // Refresh `now` periodically so relative "Nd ago" labels don't freeze at mount
  // time. Lazy initializer keeps the render itself pure.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  if (signals.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground text-center">No growth signals detected</p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {signals.map((signal) => {
        const config = signalConfig[signal.type] ?? DEFAULT_SIGNAL_CONFIG
        const Icon = config.icon
        const date = new Date(signal.detectedDate)
        const daysAgo = Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24))

        return (
          <Card key={signal.id} className="p-4">
            <div className="flex items-start gap-4">
              <div className={cn('mt-1', config.color)}>
                <Icon size={24} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {config.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
                  </span>
                  <Badge variant="secondary" className="text-xs font-mono ml-auto">
                    Score: {signal.score}
                  </Badge>
                </div>
                <p className="text-sm text-foreground leading-relaxed">{signal.description}</p>
                {signal.confidence && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className="font-mono">{Math.round(signal.confidence * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-secondary transition-all duration-300"
                        style={{ width: `${signal.confidence * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ')
}
