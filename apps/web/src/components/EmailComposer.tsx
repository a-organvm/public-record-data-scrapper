import { useState } from 'react'
import { Prospect, EmailTemplate, OutreachEmail } from '@public-records/core'
import { DEFAULT_EMAIL_TEMPLATES, populateTemplate } from '@/lib/emailTemplates'
import { Card } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Textarea } from '@public-records/ui/textarea'
import { Label } from '@public-records/ui/label'
import { Badge } from '@public-records/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@public-records/ui/dialog'
import { Separator } from '@public-records/ui/separator'
import { Envelope, PaperPlaneRight, Calendar, Eye } from '@phosphor-icons/react'
import { toast } from 'sonner'

interface EmailComposerProps {
  prospect: Prospect
  open: boolean
  onOpenChange: (open: boolean) => void
  onSendEmail: (email: Omit<OutreachEmail, 'id' | 'createdAt' | 'createdBy'>) => void
}

export function EmailComposer({ prospect, open, onOpenChange, onSendEmail }: EmailComposerProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [previewMode, setPreviewMode] = useState(false)

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId)
    const template = DEFAULT_EMAIL_TEMPLATES.find((t) => t.id === templateId)

    if (template) {
      // Prepare template data
      const templateData = {
        companyName: prospect.companyName,
        industryType: prospect.industry,
        priorityScore: prospect.priorityScore.toString(),
        healthGrade: prospect.healthScore.grade,
        recoveryLikelihood: prospect.mlScoring?.recoveryLikelihood.toString() || 'N/A',
        mlConfidence: prospect.mlScoring?.confidence.toString() || 'N/A',
        signalCount: prospect.growthSignals.length.toString(),
        signalSummary:
          prospect.growthSignals
            .slice(0, 2)
            .map((s) => s.description)
            .join(' and ') || 'recent positive developments',
        newSignalSummary: prospect.growthSignals[0]?.description || 'new growth indicators',
        equipmentSignal:
          prospect.growthSignals.find((s) => s.type === 'equipment')?.description ||
          'investing in new equipment',
        yearsSinceDefault: Math.floor(prospect.timeSinceDefault / 365).toString(),
        senderName: 'Your Name' // This would come from user profile in real app
      }

      const populated = populateTemplate(template, templateData)
      setSubject(populated.subject)
      setBody(populated.body)
    }
  }

  const handleSend = () => {
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and body are required')
      return
    }

    const email: Omit<OutreachEmail, 'id' | 'createdAt' | 'createdBy'> = {
      prospectId: prospect.id,
      templateId: selectedTemplateId || 'custom',
      subject: subject.trim(),
      body: body.trim(),
      status: scheduledDate ? 'scheduled' : 'sent',
      scheduledFor: scheduledDate || undefined,
      sentAt: scheduledDate ? undefined : new Date().toISOString()
    }

    onSendEmail(email)
    onOpenChange(false)

    toast.success(
      scheduledDate
        ? `Email scheduled for ${new Date(scheduledDate).toLocaleDateString()}`
        : 'Email sent successfully'
    )

    // Reset form
    setSelectedTemplateId('')
    setSubject('')
    setBody('')
    setScheduledDate('')
    setPreviewMode(false)
  }

  const groupedTemplates = DEFAULT_EMAIL_TEMPLATES.reduce(
    (acc, template) => {
      if (!acc[template.category]) {
        acc[template.category] = []
      }
      acc[template.category].push(template)
      return acc
    },
    {} as Record<string, EmailTemplate[]>
  )

  const categoryLabels: Record<string, string> = {
    'initial-outreach': 'Initial Outreach',
    'follow-up': 'Follow-up',
    'recovery-offer': 'Recovery Offer',
    'check-in': 'Check-in'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Envelope size={24} weight="fill" className="text-primary" />
            <div>
              <DialogTitle>Compose Email</DialogTitle>
              <DialogDescription>
                Send personalized outreach to {prospect.companyName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Template Selection */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Email Template</Label>
            <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template or start from scratch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Blank Template</SelectItem>
                {Object.entries(groupedTemplates).map(([category, templates]) => (
                  <div key={category}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      {categoryLabels[category]}
                    </div>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Email Details */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="recipient" className="text-sm font-medium mb-2 block">
                To
              </Label>
              <Input
                id="recipient"
                value={`${prospect.companyName} <contact@${prospect.companyName.toLowerCase().replace(/\s+/g, '')}.com>`}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Contact details in this composer are not sourced from CRM yet.
              </p>
            </div>

            <div>
              <Label htmlFor="subject" className="text-sm font-medium mb-2 block">
                Subject
              </Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter email subject"
              />
            </div>

            <div>
              <Label htmlFor="body" className="text-sm font-medium mb-2 block">
                Email Body
              </Label>
              {previewMode ? (
                <Card className="p-4 bg-muted/50 min-h-[300px] whitespace-pre-wrap">
                  {body || 'Email body preview will appear here...'}
                </Card>
              ) : (
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Enter email body"
                  className="min-h-[300px] font-mono text-sm"
                />
              )}
              <div className="flex justify-end mt-2">
                <Button variant="ghost" size="sm" onClick={() => setPreviewMode(!previewMode)}>
                  <Eye size={16} weight="bold" className="mr-2" />
                  {previewMode ? 'Edit' : 'Preview'}
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="schedule" className="text-sm font-medium mb-2 block">
                Schedule Send (Optional)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="schedule"
                  type="datetime-local"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                />
                {scheduledDate && (
                  <Button variant="outline" onClick={() => setScheduledDate('')}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Prospect Context */}
          <Card className="p-4 bg-primary/5">
            <h4 className="font-medium mb-3 text-sm">Prospect Context</h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Priority Score:</span>
                <Badge className="ml-2">{prospect.priorityScore}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Health Grade:</span>
                <Badge className="ml-2">{prospect.healthScore.grade}</Badge>
              </div>
              {prospect.mlScoring && (
                <>
                  <div>
                    <span className="text-muted-foreground">ML Confidence:</span>
                    <Badge className="ml-2">{prospect.mlScoring.confidence}%</Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Recovery Likelihood:</span>
                    <Badge className="ml-2">{prospect.mlScoring.recoveryLikelihood}%</Badge>
                  </div>
                </>
              )}
              <div>
                <span className="text-muted-foreground">Growth Signals:</span>
                <Badge className="ml-2">{prospect.growthSignals.length}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Industry:</span>
                <Badge className="ml-2 capitalize">{prospect.industry}</Badge>
              </div>
            </div>
          </Card>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend}>
            {scheduledDate ? (
              <>
                <Calendar size={16} weight="bold" className="mr-2" />
                Schedule Email
              </>
            ) : (
              <>
                <PaperPlaneRight size={16} weight="bold" className="mr-2" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
