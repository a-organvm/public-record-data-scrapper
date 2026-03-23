import { TabsTrigger, TabsList } from '@public-records/ui/tabs'
import {
  Target,
  Heart,
  ChartBar,
  ChartLineUp,
  ArrowClockwise,
  Robot,
  Broadcast
} from '@phosphor-icons/react'

export function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden glass-effect border-t border-white/20 safe-area-pb">
      <TabsList className="grid grid-cols-7 h-16 w-full rounded-none bg-transparent border-0 p-0">
        <TabsTrigger
          value="prospects"
          className="flex flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Target size={20} weight="fill" />
          <span className="text-[9px] font-medium">Prospects</span>
        </TabsTrigger>

        <TabsTrigger
          value="portfolio"
          className="flex flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Heart size={20} weight="fill" />
          <span className="text-[9px] font-medium">Portfolio</span>
        </TabsTrigger>

        <TabsTrigger
          value="intelligence"
          className="flex flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <ChartBar size={20} weight="fill" />
          <span className="text-[9px] font-medium">Intelligence</span>
        </TabsTrigger>

        <TabsTrigger
          value="analytics"
          className="flex flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <ChartLineUp size={20} weight="fill" />
          <span className="text-[9px] font-medium">Analytics</span>
        </TabsTrigger>

        <TabsTrigger
          value="coverage"
          className="flex flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Broadcast size={20} weight="fill" />
          <span className="text-[9px] font-medium">Coverage</span>
        </TabsTrigger>

        <TabsTrigger
          value="requalification"
          className="flex flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <ArrowClockwise size={20} weight="fill" />
          <span className="text-[9px] font-medium">Re-qual</span>
        </TabsTrigger>

        <TabsTrigger
          value="agentic"
          className="flex flex-col items-center justify-center gap-1 touch-target rounded-none border-0 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
        >
          <Robot size={20} weight="fill" />
          <span className="text-[9px] font-medium">Agentic</span>
        </TabsTrigger>
      </TabsList>
    </nav>
  )
}
