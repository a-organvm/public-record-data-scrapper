import { AnalyticsDashboard } from '@/components/AnalyticsDashboard'
import { Prospect, PortfolioCompany, type DataTier } from '@public-records/core'

interface AnalyticsTabProps {
  prospects: Prospect[]
  portfolio: PortfolioCompany[]
  dataTier?: DataTier
  usePreviewData?: boolean
}

export function AnalyticsTab({
  prospects,
  portfolio,
  dataTier = 'oss',
  usePreviewData = false
}: AnalyticsTabProps) {
  return (
    <AnalyticsDashboard
      prospects={prospects}
      portfolio={portfolio}
      dataTier={dataTier}
      usePreviewData={usePreviewData}
    />
  )
}
