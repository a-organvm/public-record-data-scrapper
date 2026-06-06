import { TabsTrigger, TabsList } from '@public-records/ui/tabs'
import {
  Target,
  Heart,
  ChartBar,
  ChartLineUp,
  ArrowClockwise,
  Robot,
  Broadcast,
  Handshake,
  AddressBook,
  ChatCircle,
  ShieldCheck
} from '@phosphor-icons/react'

export function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden glass-effect border-t border-white/20 safe-area-pb">
      {/* 11 tabs exceed a phone's width: scroll horizontally with fixed-width
          items instead of crushing them into a single-row grid. */}
      <TabsList className="flex h-16 w-full overflow-x-auto rounded-none bg-transparent border-0 p-0">
        <TabsTrigger
          value="prospects"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Target size={20} weight="fill" />
          <span className="text-[9px] font-medium">Prospects</span>
        </TabsTrigger>

        <TabsTrigger
          value="portfolio"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Heart size={20} weight="fill" />
          <span className="text-[9px] font-medium">Portfolio</span>
        </TabsTrigger>

        <TabsTrigger
          value="intelligence"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <ChartBar size={20} weight="fill" />
          <span className="text-[9px] font-medium">Intelligence</span>
        </TabsTrigger>

        <TabsTrigger
          value="analytics"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <ChartLineUp size={20} weight="fill" />
          <span className="text-[9px] font-medium">Analytics</span>
        </TabsTrigger>

        <TabsTrigger
          value="coverage"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Broadcast size={20} weight="fill" />
          <span className="text-[9px] font-medium">Coverage</span>
        </TabsTrigger>

        <TabsTrigger
          value="deals"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Handshake size={20} weight="fill" />
          <span className="text-[9px] font-medium">Deals</span>
        </TabsTrigger>

        <TabsTrigger
          value="contacts"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <AddressBook size={20} weight="fill" />
          <span className="text-[9px] font-medium">Contacts</span>
        </TabsTrigger>

        <TabsTrigger
          value="communications"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <ChatCircle size={20} weight="fill" />
          <span className="text-[9px] font-medium">Comms</span>
        </TabsTrigger>

        <TabsTrigger
          value="compliance"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <ShieldCheck size={20} weight="fill" />
          <span className="text-[9px] font-medium">Compliance</span>
        </TabsTrigger>

        <TabsTrigger
          value="requalification"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <ArrowClockwise size={20} weight="fill" />
          <span className="text-[9px] font-medium">Re-qual</span>
        </TabsTrigger>

        <TabsTrigger
          value="agentic"
          className="flex shrink-0 min-w-[64px] flex-1 flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Robot size={20} weight="fill" />
          <span className="text-[9px] font-medium">Agentic</span>
        </TabsTrigger>
      </TabsList>
    </nav>
  )
}
