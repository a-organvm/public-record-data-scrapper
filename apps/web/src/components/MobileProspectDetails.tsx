import { Prospect, ProspectNote, FollowUpReminder } from '@public-records/core'
import { Badge } from '@public-records/ui/badge'
import { Button } from '@public-records/ui/button'
import { Separator } from '@public-records/ui/separator'
import { Progress } from '@public-records/ui/progress'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@public-records/ui/accordion'
import { HealthGradeBadge } from './HealthGradeBadge'
import { SignalTimeline } from './SignalTimeline'
import { NotesAndReminders } from './NotesAndReminders'
import { Card } from '@public-records/ui/card'
import {
  Buildings,
  Export,
  MapPin,
  CurrencyDollar,
  TrendUp,
  TrendDown,
  Brain,
  Envelope,
  FileText,
  Heart,
  Sparkle,
  ChartLineUp
} from '@phosphor-icons/react'

// Normalize a possibly-undefined/out-of-range score into a valid 0-100 Progress value.
function clampPercent(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

interface MobileProspectDetailsProps {
  prospect: Prospect
  onClaim: (prospect: Prospect) => void
  onUnclaim: (prospect: Prospect) => void
  onExport: (prospect: Prospect) => void
  onSendEmail?: () => void
  notes?: ProspectNote[]
  reminders?: FollowUpReminder[]
  onAddNote?: (note: Omit<ProspectNote, 'id' | 'createdAt' | 'createdBy'>) => void
  onDeleteNote?: (noteId: string) => void
  onAddReminder?: (
    reminder: Omit<FollowUpReminder, 'id' | 'createdAt' | 'createdBy' | 'completed'>
  ) => void
  onCompleteReminder?: (reminderId: string) => void
  onDeleteReminder?: (reminderId: string) => void
}

export function MobileProspectDetails({
  prospect,
  onClaim,
  onUnclaim,
  onExport,
  onSendEmail,
  notes = [],
  reminders = [],
  onAddNote = () => {},
  onDeleteNote = () => {},
  onAddReminder = () => {},
  onCompleteReminder = () => {},
  onDeleteReminder = () => {}
}: MobileProspectDetailsProps) {
  const yearsSinceDefault = Math.floor(prospect.timeSinceDefault / 365)
  const isClaimed = prospect.status === 'claimed'
  const prospectNotes = notes.filter((n) => n.prospectId === prospect.id)
  const prospectReminders = reminders.filter((r) => r.prospectId === prospect.id)

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {/* Header */}
        <div className="py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold truncate">{prospect.companyName}</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                <MapPin size={14} weight="fill" />
                <span>{prospect.state}</span>
                <span>•</span>
                <span className="capitalize">{prospect.industry}</span>
              </div>
              {prospect.estimatedRevenue && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                  <CurrencyDollar size={14} weight="fill" />
                  <span>${(prospect.estimatedRevenue / 1000000).toFixed(1)}M est. revenue</span>
                </div>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <div className="font-mono text-3xl font-bold text-primary">
                {prospect.priorityScore}
              </div>
              <div className="text-xs text-muted-foreground">Priority</div>
            </div>
          </div>
        </div>

        <Separator className="mb-4" />

        {/* Accordion sections */}
        <Accordion type="multiple" defaultValue={['summary', 'health']} className="space-y-2">
          {/* Summary */}
          <AccordionItem
            value="summary"
            className="glass-effect rounded-lg border border-white/20 px-4"
          >
            <AccordionTrigger className="text-sm font-medium py-3">
              <div className="flex items-center gap-2">
                <FileText size={16} weight="fill" className="text-primary" />
                Opportunity Summary
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-sm leading-relaxed pb-4">{prospect.narrative}</p>
            </AccordionContent>
          </AccordionItem>

          {/* Health Score */}
          <AccordionItem
            value="health"
            className="glass-effect rounded-lg border border-white/20 px-4"
          >
            <AccordionTrigger className="text-sm font-medium py-3">
              <div className="flex items-center gap-2">
                <Heart size={16} weight="fill" className="text-accent" />
                Health Score
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pb-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Grade</span>
                  <HealthGradeBadge grade={prospect.healthScore.grade} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Sentiment Trend</span>
                  <div className="flex items-center gap-1">
                    {prospect.healthScore.sentimentTrend === 'improving' ? (
                      <>
                        <TrendUp size={14} weight="bold" className="text-success" />
                        <span className="text-success">Improving</span>
                      </>
                    ) : prospect.healthScore.sentimentTrend === 'declining' ? (
                      <>
                        <TrendDown size={14} weight="bold" className="text-destructive" />
                        <span className="text-destructive">Declining</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Stable</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Reviews Analyzed</span>
                  <span className="font-mono">{prospect.healthScore.reviewCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Violations</span>
                  <span className="font-mono">{prospect.healthScore.violationCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Default Age</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {yearsSinceDefault} years
                  </Badge>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ML Analysis */}
          {prospect.mlScoring && (
            <AccordionItem
              value="ml"
              className="glass-effect rounded-lg border border-white/20 px-4"
            >
              <AccordionTrigger className="text-sm font-medium py-3">
                <div className="flex items-center gap-2">
                  <Brain size={16} weight="fill" className="text-secondary" />
                  ML Predictive Analysis
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Confidence</div>
                      <div className="text-2xl font-bold font-mono text-primary">
                        {prospect.mlScoring.confidence}%
                      </div>
                      <Progress
                        value={clampPercent(prospect.mlScoring.confidence)}
                        className="mt-1 h-1.5"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Recovery</div>
                      <div className="text-2xl font-bold font-mono text-success">
                        {prospect.mlScoring.recoveryLikelihood}%
                      </div>
                      <Progress
                        value={clampPercent(prospect.mlScoring.recoveryLikelihood)}
                        className="mt-1 h-1.5"
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Model Factors</div>
                    {Object.entries(prospect.mlScoring.factors).map(([key, value]) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="capitalize">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </span>
                          <span className="font-mono">{value}%</span>
                        </div>
                        <Progress value={clampPercent(value)} className="h-1" />
                      </div>
                    ))}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Model {prospect.mlScoring.modelVersion} • {prospect.mlScoring.lastUpdated}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Growth Signals */}
          <AccordionItem
            value="signals"
            className="glass-effect rounded-lg border border-white/20 px-4"
          >
            <AccordionTrigger className="text-sm font-medium py-3">
              <div className="flex items-center gap-2">
                <Sparkle size={16} weight="fill" className="text-warning" />
                Growth Signals ({prospect.growthSignals.length})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="pb-4">
                <SignalTimeline signals={prospect.growthSignals} />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* UCC Filings */}
          <AccordionItem
            value="filings"
            className="glass-effect rounded-lg border border-white/20 px-4"
          >
            <AccordionTrigger className="text-sm font-medium py-3">
              <div className="flex items-center gap-2">
                <ChartLineUp size={16} weight="fill" className="text-primary" />
                UCC Filings ({prospect.uccFilings.length})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pb-4">
                {prospect.uccFilings.map((filing) => (
                  <Card key={filing.id} className="p-3 glass-effect border-white/10">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Badge variant="outline" className="text-xs mb-1">
                          {filing.filingType}
                        </Badge>
                        <div className="text-sm font-medium">{filing.securedParty}</div>
                      </div>
                      {filing.lienAmount && (
                        <div className="text-right">
                          <div className="font-mono text-sm font-semibold">
                            ${(filing.lienAmount / 1000).toFixed(0)}K
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{filing.filingDate}</span>
                      <span>{filing.state}</span>
                      <Badge variant="secondary" className="capitalize text-xs">
                        {filing.status}
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Notes & Reminders */}
          <AccordionItem
            value="notes"
            className="glass-effect rounded-lg border border-white/20 px-4"
          >
            <AccordionTrigger className="text-sm font-medium py-3">
              <div className="flex items-center gap-2">
                <FileText size={16} weight="fill" className="text-muted-foreground" />
                Notes & Reminders
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="pb-4">
                <NotesAndReminders
                  prospectId={prospect.id}
                  prospectName={prospect.companyName}
                  notes={prospectNotes}
                  reminders={prospectReminders}
                  onAddNote={onAddNote}
                  onDeleteNote={onDeleteNote}
                  onAddReminder={onAddReminder}
                  onCompleteReminder={onCompleteReminder}
                  onDeleteReminder={onDeleteReminder}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Sticky action buttons */}
      <div className="fixed bottom-0 left-0 right-0 p-4 glass-effect border-t border-white/20 safe-area-pb">
        <div className="flex items-center gap-2">
          <Button
            className="flex-1 h-12 touch-target"
            disabled={isClaimed}
            onClick={() => onClaim(prospect)}
          >
            <Buildings size={18} weight="fill" className="mr-2" />
            {isClaimed ? 'Claimed' : 'Claim Lead'}
          </Button>
          {isClaimed && (
            <Button
              variant="outline"
              className="h-12 touch-target"
              onClick={() => onUnclaim(prospect)}
            >
              Unclaim
            </Button>
          )}
          {onSendEmail && (
            <Button variant="outline" className="h-12 touch-target px-3" onClick={onSendEmail}>
              <Envelope size={18} weight="bold" />
            </Button>
          )}
          <Button
            variant="outline"
            className="h-12 touch-target px-3"
            onClick={() => onExport(prospect)}
          >
            <Export size={18} weight="bold" />
          </Button>
        </div>
      </div>
    </div>
  )
}
