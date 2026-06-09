import { UnifiedInbox } from '@/components/communications'

// Communications has no REST client or server route yet, so the inbox renders
// its genuine empty state against an empty backend. Composer (a dialog needing
// `open` state) and CallInterface (requires a selected non-null contact) are
// not standalone surfaces and are launched from a populated inbox, so the
// self-sufficient UnifiedInbox is mounted here. No mock data is injected.
export function CommunicationsTab() {
  return (
    <UnifiedInbox
      communications={[]}
      contacts={[]}
      onCommunicationSelect={() => {}}
      onCompose={() => {}}
      onReply={() => {}}
    />
  )
}
