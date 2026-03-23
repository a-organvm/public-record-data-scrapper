import { TabsList, TabsTrigger } from '@public-records/ui/tabs'
import {
  Target,
  ChartBar,
  Heart,
  ArrowClockwise,
  Robot,
  ChartLineUp,
  Broadcast
} from '@phosphor-icons/react'

export function TabNavigation() {
  return (
    <TabsList className="glass-effect hidden md:grid w-full grid-cols-7 mb-4 sm:mb-6 gap-0 h-10 p-1">
      <TabsTrigger
        value="prospects"
        data-tour="prospects-tab"
        className="flex items-center gap-2 text-sm"
      >
        <Target size={18} weight="fill" />
        <span>Prospects</span>
      </TabsTrigger>
      <TabsTrigger value="portfolio" className="flex items-center gap-2 text-sm">
        <Heart size={18} weight="fill" />
        <span>Portfolio</span>
      </TabsTrigger>
      <TabsTrigger
        value="intelligence"
        data-tour="intelligence-tab"
        className="flex items-center gap-2 text-sm"
      >
        <ChartBar size={18} weight="fill" />
        <span>Intelligence</span>
      </TabsTrigger>
      <TabsTrigger
        value="analytics"
        data-tour="analytics-tab"
        className="flex items-center gap-2 text-sm"
      >
        <ChartLineUp size={18} weight="fill" />
        <span>Analytics</span>
      </TabsTrigger>
      <TabsTrigger value="coverage" className="flex items-center gap-2 text-sm">
        <Broadcast size={18} weight="fill" />
        <span>Coverage</span>
      </TabsTrigger>
      <TabsTrigger value="requalification" className="flex items-center gap-2 text-sm">
        <ArrowClockwise size={18} weight="fill" />
        <span>Re-qual</span>
      </TabsTrigger>
      <TabsTrigger
        value="agentic"
        data-tour="agentic-tab"
        className="flex items-center gap-2 text-sm"
      >
        <Robot size={18} weight="fill" />
        <span>Agentic</span>
      </TabsTrigger>
    </TabsList>
  )
}
