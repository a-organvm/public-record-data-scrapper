import { useState } from 'react'
import { Prospect } from '@public-records/core'
import { Card } from '@public-records/ui/card'
import { Badge } from '@public-records/ui/badge'
import { Button } from '@public-records/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@public-records/ui/collapsible'
import { HealthGradeBadge } from './HealthGradeBadge'
import { Buildings, TrendUp, MapPin, Brain, CaretDown } from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'
import { motion } from 'framer-motion'
import { useIsMobile } from '@public-records/ui/use-mobile'

interface ProspectCardProps {
  prospect: Prospect
  onSelect: (prospect: Prospect) => void
}

const industryIcons: Record<string, string> = {
  restaurant: '🍽️',
  retail: '🛍️',
  construction: '🏗️',
  healthcare: '🏥',
  manufacturing: '🏭',
  services: '💼',
  technology: '💻'
}

// Fallback so unknown/unmapped industries still render an icon instead of blank.
const DEFAULT_INDUSTRY_ICON = '🏢'

export function ProspectCard({ prospect, onSelect }: ProspectCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isMobile = useIsMobile()
  const isClaimed = prospect.status === 'claimed'
  const hasGrowthSignals = prospect.growthSignals.length > 0
  const yearsSinceDefault = Math.floor(prospect.timeSinceDefault / 365)

  // Desktop card (full content, hover effects)
  if (!isMobile) {
    return (
      <motion.div
        className="h-full"
        whileHover={{ scale: 1.03, y: -8 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        <Card
          className={cn(
            'glass-effect p-4 sm:p-5 md:p-6 hover:shadow-2xl hover:shadow-primary/10 transition-all duration-300 cursor-pointer group overflow-hidden relative border-2 h-full flex flex-col',
            isClaimed && 'border-primary/50 shadow-lg shadow-primary/10'
          )}
          onClick={() => onSelect(prospect)}
        >
          <motion.div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/8 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="relative z-10 flex flex-col flex-1">
            <div className="flex items-start justify-between mb-3 sm:mb-4 gap-2">
              <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                <motion.div
                  className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 text-xl sm:text-2xl flex-shrink-0"
                  animate={{
                    rotate: [0, 5, 0, -5, 0]
                  }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: 'easeInOut'
                  }}
                >
                  {industryIcons[prospect.industry] ?? DEFAULT_INDUSTRY_ICON}
                </motion.div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base sm:text-lg leading-tight mb-1 truncate">
                    {prospect.companyName}
                  </h3>
                  <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                    <MapPin size={12} weight="fill" className="sm:w-3.5 sm:h-3.5 flex-shrink-0" />
                    <span className="truncate">{prospect.state}</span>
                    <span>•</span>
                    <span className="capitalize truncate">{prospect.industry}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <motion.div
                  className="font-mono text-xl sm:text-2xl font-semibold text-primary"
                  animate={{
                    scale: [1, 1.05, 1]
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut'
                  }}
                >
                  {prospect.priorityScore}
                </motion.div>
                <div className="text-xs text-muted-foreground">Priority</div>
              </div>
            </div>

            <div className="space-y-2 sm:space-y-3 mb-3 sm:mb-4 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm text-muted-foreground">Health Score</span>
                <HealthGradeBadge grade={prospect.healthScore.grade} />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm text-muted-foreground">Default Age</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {yearsSinceDefault}y ago
                </Badge>
              </div>

              {hasGrowthSignals && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm text-muted-foreground">Growth Signals</span>
                  <Badge className="bg-accent text-accent-foreground text-xs">
                    <TrendUp size={12} weight="bold" className="mr-1 sm:w-3.5 sm:h-3.5" />
                    {prospect.growthSignals.length} detected
                  </Badge>
                </div>
              )}

              {prospect.mlScoring && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm text-muted-foreground">ML Confidence</span>
                  <Badge
                    variant={prospect.mlScoring.confidence >= 70 ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    <Brain size={12} weight="bold" className="mr-1 sm:w-3.5 sm:h-3.5" />
                    {prospect.mlScoring.confidence}%
                  </Badge>
                </div>
              )}

              {prospect.mlScoring && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm text-muted-foreground">
                    Recovery Likelihood
                  </span>
                  <Badge
                    variant={prospect.mlScoring.recoveryLikelihood >= 70 ? 'default' : 'outline'}
                    className={cn(
                      'text-xs font-mono',
                      prospect.mlScoring.recoveryLikelihood >= 70 &&
                        'bg-success text-success-foreground'
                    )}
                  >
                    {prospect.mlScoring.recoveryLikelihood}%
                  </Badge>
                </div>
              )}
            </div>

            <p className="text-xs sm:text-sm text-foreground/80 mb-3 sm:mb-4 line-clamp-2">
              {prospect.narrative}
            </p>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1 text-xs sm:text-sm h-8 sm:h-9"
                disabled={isClaimed}
                aria-label={
                  isClaimed
                    ? prospect.claimedBy
                      ? `Claimed by ${prospect.claimedBy}`
                      : 'Claimed'
                    : `View details for ${prospect.companyName}`
                }
                title={
                  isClaimed
                    ? prospect.claimedBy
                      ? `Claimed by ${prospect.claimedBy}`
                      : 'Claimed'
                    : `View details for ${prospect.companyName}`
                }
              >
                <Buildings size={14} weight="fill" className="mr-1 sm:mr-2 sm:w-4 sm:h-4" />
                {isClaimed ? 'Claimed' : 'View Details'}
              </Button>
              {isClaimed && prospect.claimedBy && (
                <Badge variant="secondary" className="text-xs">
                  {prospect.claimedBy}
                </Badge>
              )}
            </div>
          </div>
        </Card>
      </motion.div>
    )
  }

  // Mobile card (collapsible, progressive disclosure)
  return (
    <Card
      className={cn(
        'glass-effect overflow-hidden relative border-2 transition-all duration-300',
        isClaimed && 'border-primary/50 shadow-lg shadow-primary/10'
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        {/* Collapsed header - always visible */}
        <CollapsibleTrigger asChild>
          <div className="p-4 cursor-pointer touch-target">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-xl flex-shrink-0">
                  {industryIcons[prospect.industry] ?? DEFAULT_INDUSTRY_ICON}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base leading-tight truncate">
                    {prospect.companyName}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <MapPin size={12} weight="fill" className="flex-shrink-0" />
                    <span>{prospect.state}</span>
                    <HealthGradeBadge grade={prospect.healthScore.grade} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  <div className="font-mono text-2xl font-semibold text-primary">
                    {prospect.priorityScore}
                  </div>
                </div>
                <CaretDown
                  size={20}
                  weight="bold"
                  className={cn(
                    'text-muted-foreground transition-transform duration-200',
                    isExpanded && 'rotate-180'
                  )}
                />
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Default Age</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {yearsSinceDefault}y ago
                </Badge>
              </div>

              {hasGrowthSignals && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Growth Signals</span>
                  <Badge className="bg-accent text-accent-foreground text-xs">
                    <TrendUp size={12} weight="bold" className="mr-1" />
                    {prospect.growthSignals.length} detected
                  </Badge>
                </div>
              )}

              {prospect.mlScoring && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">ML Confidence</span>
                    <Badge
                      variant={prospect.mlScoring.confidence >= 70 ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      <Brain size={12} weight="bold" className="mr-1" />
                      {prospect.mlScoring.confidence}%
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Recovery Likelihood</span>
                    <Badge
                      variant={prospect.mlScoring.recoveryLikelihood >= 70 ? 'default' : 'outline'}
                      className={cn(
                        'text-xs font-mono',
                        prospect.mlScoring.recoveryLikelihood >= 70 &&
                          'bg-success text-success-foreground'
                      )}
                    >
                      {prospect.mlScoring.recoveryLikelihood}%
                    </Badge>
                  </div>
                </>
              )}
            </div>

            <p className="text-xs text-foreground/80 line-clamp-2">{prospect.narrative}</p>

            <Button
              size="sm"
              className="w-full h-11 touch-target text-sm"
              disabled={isClaimed}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(prospect)
              }}
            >
              <Buildings size={16} weight="fill" className="mr-2" />
              {isClaimed ? `Claimed by ${prospect.claimedBy || 'user'}` : 'View Full Details'}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
