import {
  Prospect,
  GrowthSignal,
  HealthScore,
  CompetitorData,
  PortfolioCompany,
  DashboardStats,
  IndustryType,
  HealthGrade,
  SignalType,
  DataTier
} from '@public-records/core'
import { calculateMLScoring, addMLConfidenceToSignal } from './mlScoring'

// MCA-focused industries: high credit card volume businesses
const INDUSTRIES: IndustryType[] = [
  'restaurant',
  'retail',
  'construction',
  'healthcare',
  'manufacturing',
  'services',
  'technology'
]
// Weight industries towards those best suited for MCA (restaurants, retail, services have high card processing)
const MCA_INDUSTRY_WEIGHTS: Record<IndustryType, number> = {
  restaurant: 0.25, // High card volume, perfect for MCA
  retail: 0.25, // High card volume, perfect for MCA
  services: 0.2, // Good card volume
  construction: 0.15, // Moderate fit
  healthcare: 0.1, // Lower priority
  manufacturing: 0.03, // Lower priority
  technology: 0.02 // Lowest priority for MCA
}

const STATES = ['NY', 'CA', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI']
const SIGNAL_TYPES: SignalType[] = ['hiring', 'permit', 'contract', 'expansion', 'equipment']

export interface MockDataOptions {
  dataTier?: DataTier
}

const DATA_TIER_CONFIG: Record<
  DataTier,
  {
    signalMin: number
    signalMax: number
    revenueMax: number
    lienAmountMin: number
    lienAmountMax: number
    competitorFilingMin: number
    competitorFilingMax: number
    competitorDealMin: number
    competitorDealMax: number
    portfolioFundingMin: number
    portfolioFundingMax: number
  }
> = {
  oss: {
    signalMin: 0,
    signalMax: 3,
    revenueMax: 2000000,
    lienAmountMin: 25000,
    lienAmountMax: 150000,
    competitorFilingMin: 40,
    competitorFilingMax: 250,
    competitorDealMin: 60000,
    competitorDealMax: 180000,
    portfolioFundingMin: 75000,
    portfolioFundingMax: 300000
  },
  paid: {
    signalMin: 1,
    signalMax: 6,
    revenueMax: 3000000,
    lienAmountMin: 25000,
    lienAmountMax: 250000,
    competitorFilingMin: 80,
    competitorFilingMax: 500,
    competitorDealMin: 75000,
    competitorDealMax: 350000,
    portfolioFundingMin: 100000,
    portfolioFundingMax: 750000
  }
}

function resolveDataTier(options?: MockDataOptions): DataTier {
  return options?.dataTier ?? 'oss'
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Weighted random selection for MCA-suitable industries.
// Robust against weights that do not sum to exactly 1.0 and against the
// rand === 1.0 edge case: weights are normalized by their total and the random
// draw is scaled to that total, so the cumulative comparison always covers the
// full range without biasing the trailing fallback.
function weightedIndustrySelection(): IndustryType {
  const entries = Object.entries(MCA_INDUSTRY_WEIGHTS) as Array<[IndustryType, number]>
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0)

  // Degenerate config (no positive weights): fall back deterministically.
  if (total <= 0) {
    return 'restaurant'
  }

  // Draw in [0, total). Math.random() never returns 1, so scaling by total
  // keeps the draw strictly below total, guaranteeing a match within the loop.
  const rand = Math.random() * total
  let cumulative = 0

  for (const [industry, weight] of entries) {
    cumulative += Math.max(0, weight)
    if (rand < cumulative) {
      return industry
    }
  }

  // Only reached due to floating-point rounding; return the last weighted item
  // rather than a hard-coded one so it stays consistent with the weights.
  return entries[entries.length - 1][0]
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomDate(daysAgo: number, variance: number = 0): string {
  const days = daysAgo + (variance > 0 ? randomInt(-variance, variance) : 0)
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().split('T')[0]
}

export function generateHealthScore(): HealthScore {
  const grades: HealthGrade[] = ['A', 'B', 'C', 'D', 'F']
  const weights = [0.25, 0.35, 0.25, 0.1, 0.05]
  const rand = Math.random()
  let cumulative = 0
  let grade: HealthGrade = 'B'

  for (let i = 0; i < grades.length; i++) {
    cumulative += weights[i]
    if (rand <= cumulative) {
      grade = grades[i]
      break
    }
  }

  const scoreMap: Record<HealthGrade, [number, number]> = {
    A: [85, 100],
    B: [70, 84],
    C: [55, 69],
    D: [40, 54],
    F: [0, 39]
  }

  const [min, max] = scoreMap[grade]
  const score = randomInt(min, max)

  return {
    grade,
    score,
    sentimentTrend: randomElement(['improving', 'stable', 'declining'] as const),
    reviewCount: randomInt(50, 500),
    avgSentiment: 0.3 + (score / 100) * 0.6,
    violationCount: grade === 'A' ? 0 : grade === 'B' ? randomInt(0, 1) : randomInt(1, 5),
    lastUpdated: randomDate(randomInt(1, 7))
  }
}

export function generateGrowthSignals(
  count: number,
  includeTodaySignals: boolean = false
): GrowthSignal[] {
  const signals: GrowthSignal[] = []
  const descriptions: Record<SignalType, string[]> = {
    hiring: [
      'Posted 5 new positions for expansion team',
      'Hiring manager and operations staff',
      'Seeking sales team for new territory',
      'Multiple job openings across departments'
    ],
    permit: [
      'Filed building permit for new 3,000 sq ft location',
      'Renovation permit approved for facility expansion',
      'Commercial permit for equipment installation',
      'Construction permit for second location'
    ],
    contract: [
      'Awarded $200K municipal contract',
      'Signed multi-year service agreement',
      'Won competitive bid for regional project',
      'New supply contract with Fortune 500 company'
    ],
    expansion: [
      'Announced opening of third location',
      'Expanding operations to two new states',
      'Launching new product line',
      'Acquired competitor business'
    ],
    equipment: [
      'Purchased commercial kitchen equipment',
      'Leased fleet of delivery vehicles',
      'Installed new manufacturing machinery',
      'Upgraded point-of-sale systems across locations'
    ]
  }

  for (let i = 0; i < count; i++) {
    const type = randomElement(SIGNAL_TYPES)
    const score =
      type === 'expansion'
        ? randomInt(20, 30)
        : type === 'contract'
          ? randomInt(18, 28)
          : type === 'permit'
            ? randomInt(15, 25)
            : type === 'equipment'
              ? randomInt(12, 22)
              : randomInt(10, 20)

    // For demo: first signal gets today's date if includeTodaySignals is true
    const detectedDate =
      includeTodaySignals && i === 0
        ? new Date().toISOString().split('T')[0]
        : randomDate(randomInt(5, 60))
    const baseConfidence = 0.7 + Math.random() * 0.25

    const signal = {
      id: `signal-${Date.now()}-${i}`,
      type,
      description: randomElement(descriptions[type]),
      detectedDate,
      sourceUrl: `https://example.com/source/${i}`,
      score,
      confidence: baseConfidence
    }

    // Add ML confidence to signal
    const mlConfidence = addMLConfidenceToSignal({
      type,
      confidence: baseConfidence * 100,
      score,
      detectedDate
    })

    signals.push({
      ...signal,
      mlConfidence
    })
  }

  return signals.sort(
    (a, b) => new Date(b.detectedDate).getTime() - new Date(a.detectedDate).getTime()
  )
}

export function generateProspects(count: number, options: MockDataOptions = {}): Prospect[] {
  const prospects: Prospect[] = []
  const tier = resolveDataTier(options)
  const tierConfig = DATA_TIER_CONFIG[tier]

  // Small business names - NO corporate/bank names
  // MCA targets: local restaurants, retail shops, small service businesses
  const restaurantNames = [
    "Joe's Pizza",
    'Main Street Diner',
    'Bella Italia Trattoria',
    'The Corner Café',
    'Golden Dragon Chinese',
    'Taco Express',
    "Maria's Bakery",
    'Burger Haven',
    'Sunset Grill & Bar',
    'The Daily Grind Coffee',
    "Tony's Steakhouse",
    'Fresh Sushi Bar'
  ]

  const retailNames = [
    'City Hardware Store',
    "Bella's Boutique",
    'Quick Stop Convenience',
    'Green Leaf Market',
    'The Book Nook',
    'Sports Gear Plus',
    'Pet Paradise Store',
    'Flower Power Florist',
    "Mike's Auto Parts",
    'Fashion Forward Outlet',
    'Tech Corner Electronics',
    'Home Essentials'
  ]

  const serviceNames = [
    'Quick Clean Laundry',
    'Elite Hair Salon',
    'ProFit Gym & Wellness',
    'Happy Paws Pet Grooming',
    'Speedy Auto Repair',
    'Bright Smile Dental',
    'Total Care Pharmacy',
    'Ace Plumbing Services',
    'Green Thumb Landscaping',
    'All City Moving Co',
    'Classic Dry Cleaners',
    'Shine Detailing'
  ]

  const constructionNames = [
    'ABC Contracting LLC',
    'Summit Builders',
    'Quality Roofing Co',
    'Master Remodeling',
    'Precision Electrical',
    'Metro HVAC Services',
    'Foundation Experts',
    'Elite Carpentry'
  ]

  const healthcareNames = [
    'Community Medical Center',
    'Sunrise Physical Therapy',
    'Valley Dental Group',
    'CarePlus Pharmacy',
    'HealthFirst Clinic',
    'Wellness Chiropractic',
    'Premier Vision Care',
    'Family Health Practice'
  ]

  for (let i = 0; i < count; i++) {
    // Use weighted industry selection to favor MCA-suitable businesses
    const industry = weightedIndustrySelection()
    const state = randomElement(STATES)
    const defaultDate = randomDate(randomInt(1200, 1800), 200)
    const timeSinceDefault = Math.floor(
      (Date.now() - new Date(defaultDate).getTime()) / (1000 * 60 * 60 * 24)
    )
    const signalCount = randomInt(tierConfig.signalMin, tierConfig.signalMax)
    // First 3 prospects with signals get today's date for demo impact
    const includeTodaySignals = i < 3 && signalCount > 0
    const growthSignals = generateGrowthSignals(signalCount, includeTodaySignals)
    const healthScore = generateHealthScore()

    // Generate MCA-appropriate company name based on industry
    let companyName: string
    switch (industry) {
      case 'restaurant':
        companyName = randomElement(restaurantNames)
        break
      case 'retail':
        companyName = randomElement(retailNames)
        break
      case 'services':
        companyName = randomElement(serviceNames)
        break
      case 'construction':
        companyName = randomElement(constructionNames)
        break
      case 'healthcare':
        companyName = randomElement(healthcareNames)
        break
      case 'manufacturing':
        companyName = `${randomElement(['Metro', 'Regional', 'Local'])} Manufacturing LLC`
        break
      case 'technology':
        companyName = `${randomElement(['Digital', 'Smart', 'Tech'])} Solutions LLC`
        break
    }

    const totalSignalScore = growthSignals.reduce((sum, s) => sum + s.score, 0)
    const basePriority = Math.min(
      100,
      timeSinceDefault / 14 + totalSignalScore + healthScore.score * 0.3
    )
    const priorityScore = Math.round(basePriority)

    const narrativeParts: string[] = []
    if (timeSinceDefault > 1095) {
      narrativeParts.push(
        `Defaulted ${Math.floor(timeSinceDefault / 365)} years ago on equipment financing`
      )
    }
    if (growthSignals.length > 0) {
      const topSignals = growthSignals
        .slice(0, 2)
        .map((s) => s.type)
        .join(', ')
      narrativeParts.push(`showing ${growthSignals.length} growth signals (${topSignals})`)
    }
    narrativeParts.push(`Current health grade: ${healthScore.grade}`)

    // MCA-appropriate revenue range: $100K - $3M (small businesses only)
    // Exclude large corporations with >$5M revenue
    const estimatedRevenue = randomInt(100000, tierConfig.revenueMax)

    const prospect: Prospect = {
      id: `prospect-${1000 + i}`,
      companyName,
      industry,
      state,
      status: Math.random() > 0.8 ? 'claimed' : 'new',
      priorityScore,
      defaultDate,
      timeSinceDefault,
      lastFilingDate: Math.random() > 0.7 ? randomDate(randomInt(1500, 2000)) : undefined,
      uccFilings: [
        {
          id: `ucc-${i}`,
          filingDate: defaultDate,
          debtorName: companyName,
          securedParty: randomElement([
            'Capital Finance Corp',
            'Business Lending LLC',
            'Equipment Leasing Inc',
            'MCA Direct'
          ]),
          state,
          // MCA-appropriate lien amounts: $25K - $250K (small business ranges)
          lienAmount: randomInt(tierConfig.lienAmountMin, tierConfig.lienAmountMax),
          status: 'lapsed',
          filingType: 'UCC-1'
        }
      ],
      growthSignals,
      healthScore,
      narrative: narrativeParts.join(', '),
      estimatedRevenue,
      claimedBy: Math.random() > 0.8 ? 'Sales Team' : undefined,
      claimedDate: Math.random() > 0.8 ? randomDate(randomInt(1, 30)) : undefined
    }

    // Add ML scoring
    prospect.mlScoring = calculateMLScoring(prospect)

    prospects.push(prospect)
  }

  return prospects.sort((a, b) => b.priorityScore - a.priorityScore)
}

export function generateCompetitorData(options: MockDataOptions = {}): CompetitorData[] {
  const tier = resolveDataTier(options)
  const tierConfig = DATA_TIER_CONFIG[tier]
  const lenders = [
    'Capital Finance Corp',
    'Business Lending LLC',
    'Rapid Funding Partners',
    'MCA Direct',
    'Commercial Capital Group',
    'Advance America Business',
    'Merchant Growth Capital',
    'Fast Track Funding',
    'Strategic Finance Solutions',
    'Enterprise Lending Network'
  ]

  return lenders
    .map((lenderName) => {
      const filingCount = randomInt(tierConfig.competitorFilingMin, tierConfig.competitorFilingMax)
      const avgDealSize = randomInt(tierConfig.competitorDealMin, tierConfig.competitorDealMax)
      const marketShare = Math.round((filingCount / 2000) * 100 * 10) / 10

      return {
        lenderName,
        filingCount,
        avgDealSize,
        marketShare,
        industries: INDUSTRIES.slice(0, randomInt(2, 5)),
        topState: randomElement(STATES),
        monthlyTrend: -10 + Math.random() * 30
      }
    })
    .sort((a, b) => b.filingCount - a.filingCount)
}

export function generatePortfolioCompanies(
  count: number,
  options: MockDataOptions = {}
): PortfolioCompany[] {
  const companies: PortfolioCompany[] = []
  const tier = resolveDataTier(options)
  const tierConfig = DATA_TIER_CONFIG[tier]
  const companyPrefixes = ['Metro', 'Central', 'Regional', 'United', 'Superior', 'Quality']
  const companySuffixes = ['Builders', 'Services', 'Enterprises', 'Industries', 'Group']

  for (let i = 0; i < count; i++) {
    const healthScore = generateHealthScore()
    const currentStatus =
      healthScore.grade === 'A' || healthScore.grade === 'B'
        ? 'performing'
        : healthScore.grade === 'C'
          ? 'watch'
          : healthScore.grade === 'D'
            ? 'at-risk'
            : 'default'

    companies.push({
      id: `portfolio-${i}`,
      companyName: `${randomElement(companyPrefixes)} ${randomElement(companySuffixes)}`,
      fundingDate: randomDate(randomInt(90, 730)),
      fundingAmount: randomInt(tierConfig.portfolioFundingMin, tierConfig.portfolioFundingMax),
      currentStatus,
      healthScore,
      lastAlertDate: currentStatus === 'at-risk' ? randomDate(randomInt(1, 7)) : undefined
    })
  }

  return companies
}

export function generateDashboardStats(
  prospects: Prospect[],
  portfolio: PortfolioCompany[]
): DashboardStats {
  const highValueProspects = prospects.filter((p) => p.priorityScore >= 70).length
  const avgPriorityScore =
    prospects.length === 0
      ? 0
      : Math.round(prospects.reduce((sum, p) => sum + p.priorityScore, 0) / prospects.length)
  const newSignalsToday = prospects.reduce((sum, p) => {
    const todaySignals = p.growthSignals.filter((s) => {
      const daysDiff = (Date.now() - new Date(s.detectedDate).getTime()) / (1000 * 60 * 60 * 24)
      return daysDiff < 1
    })
    return sum + todaySignals.length
  }, 0)
  const portfolioAtRisk = portfolio.filter(
    (c) => c.currentStatus === 'at-risk' || c.currentStatus === 'default'
  ).length

  const avgGradeScore =
    portfolio.length === 0
      ? 0
      : portfolio.reduce((sum, c) => {
          const gradeValues: Record<HealthGrade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 }
          return sum + gradeValues[c.healthScore.grade]
        }, 0) / portfolio.length

  const avgHealthGrade =
    portfolio.length === 0
      ? 'N/A'
      : avgGradeScore >= 3.5
        ? 'A-'
        : avgGradeScore >= 2.5
          ? 'B'
          : avgGradeScore >= 1.5
            ? 'C'
            : 'D'

  return {
    totalProspects: prospects.length,
    highValueProspects,
    avgPriorityScore,
    newSignalsToday,
    portfolioAtRisk,
    avgHealthGrade
  }
}
