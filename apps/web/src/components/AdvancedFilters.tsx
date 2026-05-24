import { useEffect, useState } from 'react'
import { Button } from '@public-records/ui/button'
import { Label } from '@public-records/ui/label'
import { Slider } from '@public-records/ui/slider'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@public-records/ui/sheet'
import { Funnel } from '@phosphor-icons/react'
import { HealthGrade, SignalType, ProspectStatus } from '@public-records/core'
import { AdvancedFilterState, initialFilters } from '@/components/advanced-filters'

interface AdvancedFiltersProps {
  filters: AdvancedFilterState
  onFiltersChange: (filters: AdvancedFilterState) => void
  activeFilterCount: number
}

export function AdvancedFilters({
  filters,
  onFiltersChange,
  activeFilterCount
}: AdvancedFiltersProps) {
  const [open, setOpen] = useState(false)
  const [localFilters, setLocalFilters] = useState<AdvancedFilterState>(filters)

  // Re-sync local draft state when the controlling `filters` prop changes (e.g.
  // a parent-driven reset). Without this, stale local state would clobber the
  // parent's value the next time Apply is clicked.
  useEffect(() => {
    setLocalFilters(filters)
  }, [filters])

  const handleApply = () => {
    onFiltersChange(localFilters)
    setOpen(false)
  }

  const handleReset = () => {
    setLocalFilters(initialFilters)
    onFiltersChange(initialFilters)
  }

  const toggleHealthGrade = (grade: HealthGrade) => {
    setLocalFilters((prev) => ({
      ...prev,
      healthGrades: prev.healthGrades.includes(grade)
        ? prev.healthGrades.filter((g) => g !== grade)
        : [...prev.healthGrades, grade]
    }))
  }

  const toggleStatus = (status: ProspectStatus) => {
    setLocalFilters((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status]
    }))
  }

  const toggleSignalType = (type: SignalType) => {
    setLocalFilters((prev) => ({
      ...prev,
      signalTypes: prev.signalTypes.includes(type)
        ? prev.signalTypes.filter((t) => t !== type)
        : [...prev.signalTypes, type]
    }))
  }

  const toggleSentiment = (sentiment: 'improving' | 'stable' | 'declining') => {
    setLocalFilters((prev) => ({
      ...prev,
      sentimentTrends: prev.sentimentTrends.includes(sentiment)
        ? prev.sentimentTrends.filter((s) => s !== sentiment)
        : [...prev.sentimentTrends, sentiment]
    }))
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="glass-effect border-white/30 text-white hover:bg-white/10 relative"
        >
          <Funnel size={18} weight="fill" className="mr-2" />
          Advanced Filters
          {activeFilterCount > 0 && (
            <span className="ml-2 bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="glass-effect border-white/30 overflow-y-auto w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-white">Advanced Filters</SheetTitle>
          <SheetDescription className="text-white/70">
            Refine your prospect search with detailed criteria
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          <div>
            <Label className="text-white">Health Grade</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {(['A', 'B', 'C', 'D', 'F'] as HealthGrade[]).map((grade) => (
                <Button
                  key={grade}
                  size="sm"
                  variant={localFilters.healthGrades.includes(grade) ? 'default' : 'outline'}
                  onClick={() => toggleHealthGrade(grade)}
                  className={
                    localFilters.healthGrades.includes(grade)
                      ? ''
                      : 'glass-effect border-white/30 text-white'
                  }
                >
                  {grade}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-white">Status</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {(['new', 'claimed', 'contacted', 'qualified', 'dead'] as ProspectStatus[]).map(
                (status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={localFilters.statuses.includes(status) ? 'default' : 'outline'}
                    onClick={() => toggleStatus(status)}
                    className={
                      localFilters.statuses.includes(status)
                        ? ''
                        : 'glass-effect border-white/30 text-white'
                    }
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Button>
                )
              )}
            </div>
          </div>

          <div>
            <Label className="text-white">Signal Types</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {(['hiring', 'permit', 'contract', 'expansion', 'equipment'] as SignalType[]).map(
                (type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={localFilters.signalTypes.includes(type) ? 'default' : 'outline'}
                    onClick={() => toggleSignalType(type)}
                    className={
                      localFilters.signalTypes.includes(type)
                        ? ''
                        : 'glass-effect border-white/30 text-white'
                    }
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Button>
                )
              )}
            </div>
          </div>

          <div>
            <Label className="text-white">Sentiment Trend</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {(['improving', 'stable', 'declining'] as const).map((sentiment) => (
                <Button
                  key={sentiment}
                  size="sm"
                  variant={localFilters.sentimentTrends.includes(sentiment) ? 'default' : 'outline'}
                  onClick={() => toggleSentiment(sentiment)}
                  className={
                    localFilters.sentimentTrends.includes(sentiment)
                      ? ''
                      : 'glass-effect border-white/30 text-white'
                  }
                >
                  {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-white">
              Minimum Signal Count: {localFilters.minSignalCount}
            </Label>
            <Slider
              value={[localFilters.minSignalCount]}
              onValueChange={([value]) =>
                setLocalFilters((prev) => ({ ...prev, minSignalCount: value }))
              }
              max={10}
              min={0}
              step={1}
              className="mt-2"
            />
          </div>

          <div>
            <Label className="text-white">
              Default Age Range: {localFilters.defaultAgeRange[0]} -{' '}
              {localFilters.defaultAgeRange[1]} years
            </Label>
            <Slider
              value={localFilters.defaultAgeRange}
              onValueChange={(value) =>
                setLocalFilters((prev) => ({ ...prev, defaultAgeRange: value as [number, number] }))
              }
              max={7}
              min={0}
              step={1}
              className="mt-2"
            />
          </div>

          <div>
            <Label className="text-white">
              Revenue Range: ${(localFilters.revenueRange[0] / 1000000).toFixed(1)}M - $
              {(localFilters.revenueRange[1] / 1000000).toFixed(1)}M
            </Label>
            <Slider
              value={localFilters.revenueRange}
              onValueChange={(value) =>
                setLocalFilters((prev) => ({ ...prev, revenueRange: value as [number, number] }))
              }
              max={10000000}
              min={0}
              step={100000}
              className="mt-2"
            />
          </div>

          <div>
            <Label className="text-white">Violations</Label>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant={localFilters.hasViolations === null ? 'default' : 'outline'}
                onClick={() => setLocalFilters((prev) => ({ ...prev, hasViolations: null }))}
                className={
                  localFilters.hasViolations === null
                    ? ''
                    : 'glass-effect border-white/30 text-white'
                }
              >
                Any
              </Button>
              <Button
                size="sm"
                variant={localFilters.hasViolations === false ? 'default' : 'outline'}
                onClick={() => setLocalFilters((prev) => ({ ...prev, hasViolations: false }))}
                className={
                  localFilters.hasViolations === false
                    ? ''
                    : 'glass-effect border-white/30 text-white'
                }
              >
                Clean Record
              </Button>
              <Button
                size="sm"
                variant={localFilters.hasViolations === true ? 'default' : 'outline'}
                onClick={() => setLocalFilters((prev) => ({ ...prev, hasViolations: true }))}
                className={
                  localFilters.hasViolations === true
                    ? ''
                    : 'glass-effect border-white/30 text-white'
                }
              >
                Has Violations
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t border-white/20">
            <Button
              variant="outline"
              onClick={handleReset}
              className="flex-1 glass-effect border-white/30 text-white"
            >
              Reset
            </Button>
            <Button onClick={handleApply} className="flex-1">
              Apply Filters
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
