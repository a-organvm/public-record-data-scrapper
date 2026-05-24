import { CompetitorData } from '@public-records/core'
import { Card } from '@public-records/ui/card'
import { Badge } from '@public-records/ui/badge'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendUp, TrendDown } from '@phosphor-icons/react'

interface CompetitorChartProps {
  data: CompetitorData[]
}

export function CompetitorChart({ data }: CompetitorChartProps) {
  const top10 = data.slice(0, 10)

  const chartData = top10.map((item) => ({
    name: item.lenderName.length > 20 ? item.lenderName.substring(0, 20) + '...' : item.lenderName,
    filings: item.filingCount,
    avgDeal: Math.round(item.avgDealSize / 1000),
    trend: item.monthlyTrend
  }))

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="glass-effect p-4 sm:p-6">
        <h3 className="font-semibold text-base sm:text-lg mb-4 text-white">
          Top Lenders by Filing Volume
        </h3>
        <ResponsiveContainer width="100%" height={300} className="sm:h-[400px]">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-white/20" />
            <XAxis
              dataKey="name"
              angle={-45}
              textAnchor="end"
              height={100}
              className="text-xs"
              stroke="oklch(1 0 0 / 0.7)"
            />
            <YAxis className="text-xs" stroke="oklch(1 0 0 / 0.7)" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'oklch(1 0 0 / 0.95)',
                border: '1px solid oklch(1 0 0 / 0.2)',
                borderRadius: '0.75rem',
                backdropFilter: 'blur(20px)'
              }}
            />
            <Bar dataKey="filings" fill="oklch(0.65 0.30 45)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {top10.map((competitor, index) => (
          <motion.div
            key={`${competitor.lenderName}-${index}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            whileHover={{ scale: 1.02, y: -2 }}
          >
            <Card className="glass-effect p-4 sm:p-5 hover:shadow-lg transition-all duration-300">
              <div className="flex items-start justify-between mb-3 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="outline" className="font-mono text-xs border-white/30">
                      #{index + 1}
                    </Badge>
                    <h4 className="font-semibold text-xs sm:text-sm truncate">
                      {competitor.lenderName}
                    </h4>
                  </div>
                  <div className="text-xs text-white/70">Top State: {competitor.topState}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-mono text-lg sm:text-xl font-semibold">
                    {competitor.filingCount}
                  </div>
                  <div className="text-xs text-white/70">Filings</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-xs text-white/70 mb-1">Avg Deal Size</div>
                  <div className="font-mono text-xs sm:text-sm font-semibold">
                    ${(competitor.avgDealSize / 1000).toFixed(0)}K
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/70 mb-1">Market Share</div>
                  <div className="font-mono text-xs sm:text-sm font-semibold">
                    {competitor.marketShare}%
                  </div>
                </div>
              </div>

              <div className="mb-3">
                <div className="text-xs text-white/70 mb-1">Industries</div>
                <div className="flex flex-wrap gap-1">
                  {competitor.industries.map((ind, indIndex) => (
                    <Badge
                      key={`${ind}-${indIndex}`}
                      variant="secondary"
                      className="text-xs capitalize glass-effect border-white/30"
                    >
                      {ind}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/20">
                <span className="text-xs text-white/70">Monthly Trend</span>
                <div className="flex items-center gap-1">
                  {competitor.monthlyTrend > 0 ? (
                    <>
                      <TrendUp size={12} weight="bold" className="text-success sm:w-3.5 sm:h-3.5" />
                      <span className="font-mono text-xs sm:text-sm text-success">
                        +{competitor.monthlyTrend.toFixed(1)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <TrendDown
                        size={12}
                        weight="bold"
                        className="text-destructive sm:w-3.5 sm:h-3.5"
                      />
                      <span className="font-mono text-xs sm:text-sm text-destructive">
                        {competitor.monthlyTrend.toFixed(1)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
