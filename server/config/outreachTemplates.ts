export interface OutreachTemplate {
  key: string
  triggerType: string
  channel: 'email' | 'sms'
  subject?: string
  body: string
  delayMinutes: number
}

export const OUTREACH_SEQUENCES: Record<string, OutreachTemplate[]> = {
  termination: [
    {
      key: 'termination-email-1',
      triggerType: 'termination',
      channel: 'email',
      subject: '{{companyName}} — Fresh capital capacity available',
      body: 'Hi {{contactName}},\n\nWe noticed that {{companyName}} recently completed a financing obligation. Congratulations on that milestone.\n\nWith your current position, you may have capacity for growth capital. We specialize in fast, flexible funding for businesses like yours.\n\nWould you be open to a quick conversation this week?\n\nBest,\n{{senderName}}',
      delayMinutes: 0
    },
    {
      key: 'termination-sms-1',
      triggerType: 'termination',
      channel: 'sms',
      body: 'Hi {{contactName}}, this is {{senderName}} from {{senderCompany}}. I noticed {{companyName}} recently freed up financing capacity. Would you be open to a quick call about growth capital options? Reply STOP to opt out.',
      delayMinutes: 2880
    }
  ],
  new_filing: [
    {
      key: 'new-filing-email-1',
      triggerType: 'new_filing',
      channel: 'email',
      subject: "{{companyName}} — We see you're growing",
      body: "Hi {{contactName}},\n\nWe noticed {{companyName}} recently secured new financing — that usually means things are moving in the right direction.\n\nIf you're looking for additional capital to fuel that growth, we offer competitive terms with fast funding.\n\nHappy to discuss when it makes sense for you.\n\nBest,\n{{senderName}}",
      delayMinutes: 0
    }
  ],
  acceleration: [
    {
      key: 'acceleration-email-1',
      triggerType: 'acceleration',
      channel: 'email',
      subject: "{{companyName}} — Growing fast? Let's talk capital.",
      body: "Hi {{contactName}},\n\nOur data shows {{companyName}} has been expanding rapidly. Businesses in growth mode often benefit from flexible working capital.\n\nI'd love to share how we help companies like yours fund expansion without slowing down.\n\nOpen to a quick call?\n\nBest,\n{{senderName}}",
      delayMinutes: 0
    }
  ]
}

export const MINIMUM_CAPACITY_SCORE = 50
export const SEQUENCE_COOLDOWN_DAYS = 30
