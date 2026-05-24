import { AgenticDashboard } from '@/components/AgenticDashboard'
import { CompetitorData } from '@public-records/core'
import { UseAgenticEngineResult } from '@/hooks/use-agentic-engine'

interface AgenticTabProps {
  agentic: UseAgenticEngineResult
  competitors: CompetitorData[]
}

export function AgenticTab({ agentic, competitors }: AgenticTabProps) {
  return <AgenticDashboard agentic={agentic} competitors={competitors} />
}
