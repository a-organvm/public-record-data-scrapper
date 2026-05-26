import { useState } from 'react'
import { Button } from '@public-records/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@public-records/ui/dialog'
import { Badge } from '@public-records/ui/badge'
import { Card } from '@public-records/ui/card'
import { ScrollArea } from '@public-records/ui/scroll-area'
import { ClipboardText, Export, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'

interface FeedbackEntry {
  component: string
  feedbackType: string
  priority: string
  description: string
  suggestion: string
  deviceType: string
  timestamp: string
  userAgent: string
}

const componentLabels: Record<string, string> = {
  dashboard: 'Dashboard Overview',
  'prospect-cards': 'Prospect Cards',
  stats: 'Stats Overview',
  filters: 'Filters & Search',
  'detail-dialog': 'Prospect Detail Dialog',
  portfolio: 'Portfolio Monitor',
  intelligence: 'Competitor Intelligence',
  navigation: 'Navigation & Tabs',
  mobile: 'Mobile Responsiveness',
  effects: 'Visual Effects',
  other: 'Other'
}

const feedbackTypeLabels: Record<string, string> = {
  bug: 'Bug/Issue',
  design: 'Design Improvement',
  usability: 'Usability Enhancement',
  performance: 'Performance Concern',
  accessibility: 'Accessibility Issue',
  feature: 'Feature Request',
  general: 'General Comment'
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500'
}

export function FeedbackViewer() {
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([])
  const [open, setOpen] = useState(false)

  const loadFeedback = () => {
    const stored = localStorage.getItem('ui-feedback')
    if (!stored) return
    try {
      const parsed = JSON.parse(stored)
      setFeedback(Array.isArray(parsed) ? (parsed as FeedbackEntry[]) : [])
    } catch (error) {
      console.error('Failed to parse stored feedback', error)
      setFeedback([])
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      loadFeedback()
    }
  }

  const handleExport = () => {
    const exportData = feedback.map((entry, index) => ({
      id: index + 1,
      timestamp: new Date(entry.timestamp).toLocaleString(),
      component: componentLabels[entry.component] || entry.component,
      type: feedbackTypeLabels[entry.feedbackType] || entry.feedbackType,
      priority: entry.priority,
      description: entry.description,
      suggestion: entry.suggestion,
      deviceType: entry.deviceType,
      userAgent: entry.userAgent
    }))

    const jsonStr = JSON.stringify(exportData, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ui-feedback-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)

    toast.success('Feedback exported', {
      description: `${feedback.length} feedback entries exported successfully.`
    })
  }

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all feedback? This cannot be undone.')) {
      localStorage.removeItem('ui-feedback')
      setFeedback([])
      toast.info('All feedback cleared')
    }
  }

  const getSummary = () => {
    const byComponent = feedback.reduce(
      (acc, entry) => {
        acc[entry.component] = (acc[entry.component] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const byType = feedback.reduce(
      (acc, entry) => {
        acc[entry.feedbackType] = (acc[entry.feedbackType] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const byPriority = feedback.reduce(
      (acc, entry) => {
        acc[entry.priority] = (acc[entry.priority] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    return { byComponent, byType, byPriority }
  }

  const summary = getSummary()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="glass-effect border-white/30 text-white hover:bg-white/10"
        >
          <ClipboardText size={16} weight="bold" className="sm:mr-2" />
          <span className="hidden sm:inline">View Feedback</span>
          {feedback.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {feedback.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-effect border-white/30 text-white max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-xl sm:text-2xl">Collected Feedback</DialogTitle>
          <DialogDescription className="text-white/70">
            Review all user feedback collected from the application.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {feedback.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="glass-effect p-4">
                <h4 className="font-semibold mb-2 text-white">By Component</h4>
                <div className="space-y-1 text-sm">
                  {Object.entries(summary.byComponent).map(([key, count]) => (
                    <div key={key} className="flex justify-between text-white/80">
                      <span>{componentLabels[key] || key}</span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="glass-effect p-4">
                <h4 className="font-semibold mb-2 text-white">By Type</h4>
                <div className="space-y-1 text-sm">
                  {Object.entries(summary.byType).map(([key, count]) => (
                    <div key={key} className="flex justify-between text-white/80">
                      <span>{feedbackTypeLabels[key] || key}</span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="glass-effect p-4">
                <h4 className="font-semibold mb-2 text-white">By Priority</h4>
                <div className="space-y-1 text-sm">
                  {Object.entries(summary.byPriority).map(([key, count]) => (
                    <div key={key} className="flex justify-between text-white/80">
                      <span className="capitalize">{key}</span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={feedback.length === 0}
              className="glass-effect border-white/30 text-white hover:bg-white/10"
            >
              <Export size={16} weight="bold" className="mr-2" />
              Export
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClear}
              disabled={feedback.length === 0}
            >
              <Trash size={16} weight="bold" className="mr-2" />
              Clear All
            </Button>
          </div>

          <ScrollArea className="h-[400px] pr-4">
            {feedback.length === 0 ? (
              <div className="text-center py-12 text-white/70">No feedback collected yet</div>
            ) : (
              <div className="space-y-4">
                {feedback.map((entry, index) => (
                  <Card key={index} className="glass-effect p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">
                          {componentLabels[entry.component] || entry.component}
                        </Badge>
                        <Badge variant="outline">
                          {feedbackTypeLabels[entry.feedbackType] || entry.feedbackType}
                        </Badge>
                        <Badge className={priorityColors[entry.priority]}>{entry.priority}</Badge>
                      </div>
                      <span className="text-xs text-white/50">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="font-semibold text-white">Description:</span>
                        <p className="text-white/80 mt-1">{entry.description}</p>
                      </div>

                      {entry.suggestion && (
                        <div>
                          <span className="font-semibold text-white">Suggestion:</span>
                          <p className="text-white/80 mt-1">{entry.suggestion}</p>
                        </div>
                      )}

                      <div className="flex gap-4 text-xs text-white/60">
                        <span>Device: {entry.deviceType}</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
