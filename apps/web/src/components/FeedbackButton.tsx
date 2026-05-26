import { useState } from 'react'
import { Button } from '@public-records/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@public-records/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import { Label } from '@public-records/ui/label'
import { Textarea } from '@public-records/ui/textarea'
import { ChatCircleDots } from '@phosphor-icons/react'
import { toast } from 'sonner'

interface FeedbackData {
  component: string
  feedbackType: string
  priority: string
  description: string
  suggestion: string
  deviceType: string
}

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [feedbackData, setFeedbackData] = useState<FeedbackData>({
    component: '',
    feedbackType: '',
    priority: '',
    description: '',
    suggestion: '',
    deviceType: ''
  })

  const handleSubmit = () => {
    // Validate required fields
    if (
      !feedbackData.component ||
      !feedbackData.feedbackType ||
      !feedbackData.priority ||
      !feedbackData.description ||
      !feedbackData.deviceType
    ) {
      toast.error('Please fill in all required fields')
      return
    }

    // In a real implementation, this would send the feedback to a backend or GitHub API
    // For now, we'll save it to localStorage and show a success message
    const timestamp = new Date().toISOString()
    const feedback = {
      ...feedbackData,
      timestamp,
      userAgent: navigator.userAgent
    }

    // Get existing feedback, tolerating corrupt/non-array localStorage contents.
    let existingFeedback: unknown[] = []
    try {
      const parsed = JSON.parse(localStorage.getItem('ui-feedback') || '[]')
      if (Array.isArray(parsed)) existingFeedback = parsed
    } catch (error) {
      console.error('Failed to parse stored feedback; starting fresh', error)
    }
    existingFeedback.push(feedback)
    localStorage.setItem('ui-feedback', JSON.stringify(existingFeedback))

    // Log to console for development
    console.log('Feedback submitted:', feedback)

    toast.success('Feedback submitted!', {
      description: 'Thank you for helping us improve the platform.'
    })

    // Reset form and close dialog
    setFeedbackData({
      component: '',
      feedbackType: '',
      priority: '',
      description: '',
      suggestion: '',
      deviceType: ''
    })
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="glass-effect border-white/30 text-white hover:bg-white/10 flex items-center gap-2"
        aria-label="Give Feedback"
      >
        <ChatCircleDots size={16} weight="bold" />
        <span className="hidden sm:inline">Give Feedback</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-effect border-white/30 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl sm:text-2xl">Share Your Feedback</DialogTitle>
            <DialogDescription className="text-white/70">
              Help us improve the UCC-MCA Intelligence Platform by sharing your thoughts on the new
              UI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="component" className="text-white">
                Component <span className="text-red-400">*</span>
              </Label>
              <Select
                value={feedbackData.component}
                onValueChange={(value) => setFeedbackData({ ...feedbackData, component: value })}
              >
                <SelectTrigger
                  id="component"
                  className="glass-effect border-white/30 text-white"
                  aria-required="true"
                >
                  <SelectValue placeholder="Select a component" />
                </SelectTrigger>
                <SelectContent className="glass-effect border-white/30">
                  <SelectItem value="dashboard">Dashboard Overview</SelectItem>
                  <SelectItem value="prospect-cards">Prospect Cards</SelectItem>
                  <SelectItem value="stats">Stats Overview</SelectItem>
                  <SelectItem value="filters">Filters & Search</SelectItem>
                  <SelectItem value="detail-dialog">Prospect Detail Dialog</SelectItem>
                  <SelectItem value="portfolio">Portfolio Monitor</SelectItem>
                  <SelectItem value="intelligence">Competitor Intelligence</SelectItem>
                  <SelectItem value="navigation">Navigation & Tabs</SelectItem>
                  <SelectItem value="mobile">Mobile Responsiveness</SelectItem>
                  <SelectItem value="effects">Visual Effects (Glass/Mica)</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedbackType" className="text-white">
                Type of Feedback <span className="text-red-400">*</span>
              </Label>
              <Select
                value={feedbackData.feedbackType}
                onValueChange={(value) => setFeedbackData({ ...feedbackData, feedbackType: value })}
              >
                <SelectTrigger
                  id="feedbackType"
                  className="glass-effect border-white/30 text-white"
                  aria-required="true"
                >
                  <SelectValue placeholder="Select feedback type" />
                </SelectTrigger>
                <SelectContent className="glass-effect border-white/30">
                  <SelectItem value="bug">Bug/Issue</SelectItem>
                  <SelectItem value="design">Design Improvement</SelectItem>
                  <SelectItem value="usability">Usability Enhancement</SelectItem>
                  <SelectItem value="performance">Performance Concern</SelectItem>
                  <SelectItem value="accessibility">Accessibility Issue</SelectItem>
                  <SelectItem value="feature">Feature Request</SelectItem>
                  <SelectItem value="general">General Comment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority" className="text-white">
                Priority <span className="text-red-400">*</span>
              </Label>
              <Select
                value={feedbackData.priority}
                onValueChange={(value) => setFeedbackData({ ...feedbackData, priority: value })}
              >
                <SelectTrigger
                  id="priority"
                  className="glass-effect border-white/30 text-white"
                  aria-required="true"
                >
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent className="glass-effect border-white/30">
                  <SelectItem value="critical">Critical (Blocks usage)</SelectItem>
                  <SelectItem value="high">High (Major improvement needed)</SelectItem>
                  <SelectItem value="medium">Medium (Nice to have)</SelectItem>
                  <SelectItem value="low">Low (Minor polish)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deviceType" className="text-white">
                Device Type <span className="text-red-400">*</span>
              </Label>
              <Select
                value={feedbackData.deviceType}
                onValueChange={(value) => setFeedbackData({ ...feedbackData, deviceType: value })}
              >
                <SelectTrigger
                  id="deviceType"
                  className="glass-effect border-white/30 text-white"
                  aria-required="true"
                >
                  <SelectValue placeholder="Select device type" />
                </SelectTrigger>
                <SelectContent className="glass-effect border-white/30">
                  <SelectItem value="desktop">Desktop</SelectItem>
                  <SelectItem value="tablet">Tablet</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                  <SelectItem value="multiple">Multiple devices</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-white">
                Description <span className="text-red-400">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Describe your feedback in detail..."
                value={feedbackData.description}
                onChange={(e) => setFeedbackData({ ...feedbackData, description: e.target.value })}
                className="glass-effect border-white/30 text-white placeholder:text-white/50 min-h-[100px]"
                required
                aria-required="true"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="suggestion" className="text-white">
                Suggested Improvement (optional)
              </Label>
              <Textarea
                id="suggestion"
                placeholder="What would you suggest to improve this?"
                value={feedbackData.suggestion}
                onChange={(e) => setFeedbackData({ ...feedbackData, suggestion: e.target.value })}
                className="glass-effect border-white/30 text-white placeholder:text-white/50 min-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="glass-effect border-white/30 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Submit Feedback</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
