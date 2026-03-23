/**
 * Stack Position Detection Service
 *
 * Analyzes UCC filings to determine a prospect's current funding stack position.
 * Key capabilities:
 * - Parse secured party names to identify MCA funders vs other lien holders
 * - Calculate stack depth (1st, 2nd, 3rd+ position)
 * - Detect competitor funders by matching known lender names
 * - Estimate payment burden from filing patterns
 * - Provide stack-based funding recommendations
 *
 * Stack Position Matters Because:
 * - 1st position: Best security, lowest risk, typically best rates
 * - 2nd position: Moderate risk, subordinate to 1st
 * - 3rd+ position: Higher risk, often requires higher rates
 * - Stack depth affects available funding amount and terms
 */

import { database } from '../database/connection'
import { normalizeCompanyName } from '../../packages/core/src/identity'

/**
 * UCC Filing data for stack analysis
 */
export interface UCCFilingForStack {
  id: string
  filingNumber: string
  filingDate: string
  expirationDate?: string
  status: 'active' | 'terminated' | 'lapsed' | 'amended'
  securedPartyName: string
  securedPartyAddress?: string
  collateralDescription?: string
  filingType: string
  originalAmount?: number
}

/**
 * Known funder/lender classification
 */
export interface KnownFunder {
  name: string
  aliases: string[]
  type: 'mca' | 'bank' | 'equipment' | 'sba' | 'factor' | 'other'
  tier: 'a' | 'b' | 'c' | 'd' // Funder quality/reputation
  averagePosition: number // Typical position they take
  typicalTerms?: {
    factorRateRange: [number, number]
    termRange: [number, number] // days
    dailyPaymentRange: [number, number] // percentage of funding
  }
}

/**
 * Stack position analysis result
 */
export interface StackAnalysis {
  prospectId: string
  companyName: string
  analyzedAt: string

  // Position summary
  currentStackDepth: number
  estimatedPosition: number // What position new funding would be
  totalActiveFilings: number
  totalHistoricalFilings: number

  // Active positions detail
  activePositions: PositionDetail[]

  // Competitor detection
  detectedCompetitors: CompetitorPosition[]
  hasKnownMcaFunder: boolean
  mcaPositionCount: number

  // Payment burden estimation
  estimatedMonthlyPayments?: number
  paymentBurdenRatio?: number // If revenue is known
  isOverStacked: boolean

  // Collateral analysis
  collateralTypes: CollateralAnalysis[]
  hasBlanketsLien: boolean

  // Recommendations
  recommendation: StackRecommendation
  riskFactors: string[]
  opportunities: string[]
}

export interface PositionDetail {
  position: number
  filing: UCCFilingForStack
  funderType: KnownFunder['type'] | 'unknown'
  funderTier?: KnownFunder['tier']
  isCompetitor: boolean
  estimatedRemainingBalance?: number
  estimatedPayoffDate?: string
  daysActive: number
}

export interface CompetitorPosition {
  funderName: string
  normalizedName: string
  position: number
  filingDate: string
  isActive: boolean
  funderType: KnownFunder['type']
  funderTier?: KnownFunder['tier']
  collateralDescription?: string
}

export interface CollateralAnalysis {
  type: 'blanket' | 'accounts_receivable' | 'equipment' | 'inventory' | 'specific' | 'other'
  description: string
  filingCount: number
  isCommonMcaCollateral: boolean
}

export interface StackRecommendation {
  canFund: boolean
  suggestedPosition: number
  maxRecommendedAmount?: number
  reasoning: string
  requiredDueDiligence: string[]
  suggestedTerms?: {
    minFactorRate: number
    minTerm: number
    maxDailyPercentage: number
  }
}

/**
 * Database of known MCA funders and lenders
 * This is used to identify competitors and classify filings
 */
const KNOWN_FUNDERS: KnownFunder[] = [
  // Tier A - Major MCA/Alternative Lenders
  {
    name: 'OnDeck Capital',
    aliases: ['ondeck', 'on deck'],
    type: 'mca',
    tier: 'a',
    averagePosition: 1
  },
  { name: 'Kabbage', aliases: ['kabbage'], type: 'mca', tier: 'a', averagePosition: 1 },
  {
    name: 'BlueVine',
    aliases: ['bluevine', 'blue vine'],
    type: 'mca',
    tier: 'a',
    averagePosition: 1
  },
  { name: 'Credibly', aliases: ['credibly'], type: 'mca', tier: 'a', averagePosition: 1 },
  { name: 'Fundbox', aliases: ['fundbox', 'fund box'], type: 'mca', tier: 'a', averagePosition: 1 },
  {
    name: 'National Funding',
    aliases: ['national funding'],
    type: 'mca',
    tier: 'a',
    averagePosition: 1
  },

  // Tier B - Established MCA Funders
  {
    name: 'Forward Financing',
    aliases: ['forward financing'],
    type: 'mca',
    tier: 'b',
    averagePosition: 2
  },
  { name: 'Rapid Finance', aliases: ['rapid finance'], type: 'mca', tier: 'b', averagePosition: 2 },
  {
    name: 'Greenbox Capital',
    aliases: ['greenbox', 'green box'],
    type: 'mca',
    tier: 'b',
    averagePosition: 2
  },
  { name: 'Libertas Funding', aliases: ['libertas'], type: 'mca', tier: 'b', averagePosition: 2 },
  { name: 'Reliant Funding', aliases: ['reliant'], type: 'mca', tier: 'b', averagePosition: 2 },
  {
    name: 'Fora Financial',
    aliases: ['fora financial'],
    type: 'mca',
    tier: 'b',
    averagePosition: 2
  },
  {
    name: 'American Express Merchant Financing',
    aliases: ['amex merchant', 'american express merchant'],
    type: 'mca',
    tier: 'b',
    averagePosition: 1
  },

  // Tier C - Smaller MCA Funders
  { name: 'Pearl Capital', aliases: ['pearl capital'], type: 'mca', tier: 'c', averagePosition: 2 },
  {
    name: 'Merchant Cash Group',
    aliases: ['merchant cash group', 'mcg'],
    type: 'mca',
    tier: 'c',
    averagePosition: 2
  },
  {
    name: 'Strategic Funding Source',
    aliases: ['strategic funding'],
    type: 'mca',
    tier: 'c',
    averagePosition: 2
  },
  {
    name: 'CFG Merchant Solutions',
    aliases: ['cfg merchant', 'cfg solutions'],
    type: 'mca',
    tier: 'c',
    averagePosition: 2
  },

  // Tier D - High Risk / Stacking Specialists
  {
    name: 'World Business Lenders',
    aliases: ['world business lenders', 'wbl'],
    type: 'mca',
    tier: 'd',
    averagePosition: 3
  },
  {
    name: 'QuickBridge',
    aliases: ['quickbridge', 'quick bridge'],
    type: 'mca',
    tier: 'd',
    averagePosition: 3
  },

  // Banks (typically 1st position, better terms)
  {
    name: 'Bank of America',
    aliases: ['bank of america', 'bofa', 'b of a'],
    type: 'bank',
    tier: 'a',
    averagePosition: 1
  },
  { name: 'Wells Fargo', aliases: ['wells fargo'], type: 'bank', tier: 'a', averagePosition: 1 },
  {
    name: 'Chase',
    aliases: ['chase', 'jpmorgan chase', 'jp morgan'],
    type: 'bank',
    tier: 'a',
    averagePosition: 1
  },
  {
    name: 'US Bank',
    aliases: ['us bank', 'u.s. bank'],
    type: 'bank',
    tier: 'a',
    averagePosition: 1
  },
  { name: 'PNC', aliases: ['pnc bank', 'pnc'], type: 'bank', tier: 'a', averagePosition: 1 },
  { name: 'TD Bank', aliases: ['td bank'], type: 'bank', tier: 'a', averagePosition: 1 },

  // Equipment Lenders
  {
    name: 'De Lage Landen',
    aliases: ['de lage landen', 'dll'],
    type: 'equipment',
    tier: 'b',
    averagePosition: 1
  },
  {
    name: 'CIT Group',
    aliases: ['cit group', 'cit'],
    type: 'equipment',
    tier: 'b',
    averagePosition: 1
  },
  {
    name: 'Balboa Capital',
    aliases: ['balboa capital'],
    type: 'equipment',
    tier: 'b',
    averagePosition: 1
  },
  {
    name: 'LEAF Commercial Capital',
    aliases: ['leaf commercial', 'leaf capital'],
    type: 'equipment',
    tier: 'b',
    averagePosition: 1
  },

  // Factoring Companies
  {
    name: 'BlueVine Factoring',
    aliases: ['bluevine factor'],
    type: 'factor',
    tier: 'b',
    averagePosition: 1
  },
  {
    name: 'Fundbox Factoring',
    aliases: ['fundbox factor'],
    type: 'factor',
    tier: 'b',
    averagePosition: 1
  },
  { name: 'altLINE', aliases: ['altline'], type: 'factor', tier: 'b', averagePosition: 1 },

  // SBA Lenders
  {
    name: 'SBA',
    aliases: ['small business administration', 'sba'],
    type: 'sba',
    tier: 'a',
    averagePosition: 1
  },
  { name: 'Lendio', aliases: ['lendio'], type: 'sba', tier: 'b', averagePosition: 1 }
]

/**
 * Collateral patterns that indicate MCA-type funding
 */
const MCA_COLLATERAL_PATTERNS = [
  'all assets',
  'accounts receivable',
  'future receivables',
  'credit card receivables',
  'merchant accounts',
  'deposit accounts',
  'general intangibles',
  'inventory',
  'all business assets',
  'all present and future'
]

export class StackAnalysisService {
  private funderIndex: Map<string, KnownFunder>

  constructor() {
    // Build normalized funder index for fast lookup
    this.funderIndex = new Map()
    for (const funder of KNOWN_FUNDERS) {
      const normalized = this.normalizeForMatching(funder.name)
      this.funderIndex.set(normalized, funder)
      for (const alias of funder.aliases) {
        this.funderIndex.set(this.normalizeForMatching(alias), funder)
      }
    }
  }

  /**
   * Analyze stack position for a prospect
   */
  async analyzeStack(prospectId: string): Promise<StackAnalysis> {
    // Fetch prospect and filings
    const [prospect] = await database.query<{
      id: string
      company_name: string
      estimated_revenue: number
    }>('SELECT id, company_name, estimated_revenue FROM prospects WHERE id = $1', [prospectId])

    if (!prospect) {
      throw new Error(`Prospect not found: ${prospectId}`)
    }

    // Fetch all UCC filings for this prospect
    const filings = await database.query<{
      id: string
      external_id: string
      filing_date: string
      expiration_date: string
      status: string
      secured_party_name: string
      secured_party_address: string
      collateral_description: string
      filing_type: string
      original_amount: number
    }>(
      `SELECT uf.id, uf.external_id, uf.filing_date, uf.expiration_date,
              uf.status, uf.secured_party_name, uf.secured_party_address,
              uf.collateral_description, uf.filing_type, uf.original_amount
       FROM ucc_filings uf
       JOIN prospect_ucc_filings puf ON uf.id = puf.ucc_filing_id
       WHERE puf.prospect_id = $1
       ORDER BY uf.filing_date ASC`,
      [prospectId]
    )

    const uccFilings: UCCFilingForStack[] = filings.map((f) => ({
      id: f.id,
      filingNumber: f.external_id,
      filingDate: f.filing_date,
      expirationDate: f.expiration_date,
      status: f.status as UCCFilingForStack['status'],
      securedPartyName: f.secured_party_name,
      securedPartyAddress: f.secured_party_address,
      collateralDescription: f.collateral_description,
      filingType: f.filing_type,
      originalAmount: f.original_amount
    }))

    // Perform analysis
    const activeFilings = uccFilings.filter((f) => f.status === 'active')
    const activePositions = this.analyzePositions(activeFilings)
    const competitors = this.detectCompetitors(uccFilings)
    const collateralAnalysis = this.analyzeCollateral(uccFilings)
    const paymentEstimate = this.estimatePayments(activeFilings, prospect.estimated_revenue)

    // Determine if over-stacked
    const mcaCount = activePositions.filter((p) => p.funderType === 'mca').length
    const isOverStacked = mcaCount >= 4 || activePositions.length >= 5

    // Generate recommendation
    const recommendation = this.generateRecommendation(
      activePositions,
      mcaCount,
      paymentEstimate,
      collateralAnalysis.some((c) => c.type === 'blanket')
    )

    // Identify risk factors and opportunities
    const { riskFactors, opportunities } = this.identifyRisksAndOpportunities(
      activePositions,
      competitors,
      collateralAnalysis,
      paymentEstimate
    )

    return {
      prospectId,
      companyName: prospect.company_name,
      analyzedAt: new Date().toISOString(),

      currentStackDepth: activePositions.length,
      estimatedPosition: activePositions.length + 1,
      totalActiveFilings: activeFilings.length,
      totalHistoricalFilings: uccFilings.length,

      activePositions,
      detectedCompetitors: competitors,
      hasKnownMcaFunder: competitors.some((c) => c.funderType === 'mca'),
      mcaPositionCount: mcaCount,

      estimatedMonthlyPayments: paymentEstimate.monthlyPayments,
      paymentBurdenRatio: paymentEstimate.burdenRatio,
      isOverStacked,

      collateralTypes: collateralAnalysis,
      hasBlanketsLien: collateralAnalysis.some((c) => c.type === 'blanket'),

      recommendation,
      riskFactors,
      opportunities
    }
  }

  /**
   * Analyze positions from active filings
   */
  private analyzePositions(activeFilings: UCCFilingForStack[]): PositionDetail[] {
    // Sort by filing date to determine position order
    const sorted = [...activeFilings].sort(
      (a, b) => new Date(a.filingDate).getTime() - new Date(b.filingDate).getTime()
    )

    return sorted.map((filing, index) => {
      const funder = this.identifyFunder(filing.securedPartyName)
      const daysActive = Math.floor(
        (Date.now() - new Date(filing.filingDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      return {
        position: index + 1,
        filing,
        funderType: funder?.type || 'unknown',
        funderTier: funder?.tier,
        isCompetitor: funder?.type === 'mca',
        daysActive,
        estimatedRemainingBalance: this.estimateRemainingBalance(filing, daysActive),
        estimatedPayoffDate: this.estimatePayoffDate(filing)
      }
    })
  }

  /**
   * Detect competitor positions
   */
  private detectCompetitors(filings: UCCFilingForStack[]): CompetitorPosition[] {
    const competitors: CompetitorPosition[] = []

    // Sort by date for position calculation
    const activeFilings = filings
      .filter((f) => f.status === 'active')
      .sort((a, b) => new Date(a.filingDate).getTime() - new Date(b.filingDate).getTime())

    for (let i = 0; i < filings.length; i++) {
      const filing = filings[i]
      const funder = this.identifyFunder(filing.securedPartyName)

      // Find position if active
      let position = 0
      if (filing.status === 'active') {
        position = activeFilings.findIndex((f) => f.id === filing.id) + 1
      }

      competitors.push({
        funderName: filing.securedPartyName,
        normalizedName: normalizeCompanyName(filing.securedPartyName).normalized,
        position,
        filingDate: filing.filingDate,
        isActive: filing.status === 'active',
        funderType: funder?.type || 'other',
        funderTier: funder?.tier,
        collateralDescription: filing.collateralDescription
      })
    }

    return competitors
  }

  /**
   * Analyze collateral descriptions
   */
  private analyzeCollateral(filings: UCCFilingForStack[]): CollateralAnalysis[] {
    const collateralMap = new Map<string, CollateralAnalysis>()

    for (const filing of filings) {
      if (!filing.collateralDescription) continue

      const type = this.classifyCollateral(filing.collateralDescription)
      const key = type

      if (!collateralMap.has(key)) {
        collateralMap.set(key, {
          type,
          description: filing.collateralDescription.slice(0, 200),
          filingCount: 0,
          isCommonMcaCollateral: this.isMcaCollateral(filing.collateralDescription)
        })
      }

      const analysis = collateralMap.get(key)!
      analysis.filingCount++
    }

    return Array.from(collateralMap.values())
  }

  /**
   * Classify collateral type from description
   */
  private classifyCollateral(description: string): CollateralAnalysis['type'] {
    const lower = description.toLowerCase()

    if (
      lower.includes('all assets') ||
      lower.includes('all present and future') ||
      (lower.includes('general intangibles') && lower.includes('accounts'))
    ) {
      return 'blanket'
    }
    if (lower.includes('account') || lower.includes('receivable')) {
      return 'accounts_receivable'
    }
    if (lower.includes('equipment') || lower.includes('machinery') || lower.includes('vehicle')) {
      return 'equipment'
    }
    if (lower.includes('inventory') || lower.includes('stock')) {
      return 'inventory'
    }
    if (lower.match(/serial|vin|specific|particular/)) {
      return 'specific'
    }

    return 'other'
  }

  /**
   * Check if collateral description matches common MCA patterns
   */
  private isMcaCollateral(description: string): boolean {
    const lower = description.toLowerCase()
    return MCA_COLLATERAL_PATTERNS.some((pattern) => lower.includes(pattern))
  }

  /**
   * Estimate monthly payments from active positions
   */
  private estimatePayments(
    activeFilings: UCCFilingForStack[],
    estimatedRevenue?: number
  ): {
    monthlyPayments?: number
    burdenRatio?: number
  } {
    // Rough estimation based on typical MCA terms
    // Without actual payment data, we estimate based on filing patterns
    let totalMonthlyEstimate = 0

    for (const filing of activeFilings) {
      const funder = this.identifyFunder(filing.securedPartyName)

      // Estimate based on original amount if available
      if (filing.originalAmount) {
        // Typical MCA: 1.3x factor, 6-12 month term
        const estimatedPayback = filing.originalAmount * 1.3
        const estimatedTerm = 9 // months, average
        const monthlyPayment = estimatedPayback / estimatedTerm
        totalMonthlyEstimate += monthlyPayment
      } else {
        // Without amount, use industry averages by funder type
        const avgPayment =
          funder?.type === 'mca'
            ? 5000
            : funder?.type === 'bank'
              ? 3000
              : funder?.type === 'equipment'
                ? 2000
                : 2500
        totalMonthlyEstimate += avgPayment
      }
    }

    const result: { monthlyPayments?: number; burdenRatio?: number } = {}

    if (totalMonthlyEstimate > 0) {
      result.monthlyPayments = Math.round(totalMonthlyEstimate)

      if (estimatedRevenue && estimatedRevenue > 0) {
        const monthlyRevenue = estimatedRevenue / 12
        result.burdenRatio = totalMonthlyEstimate / monthlyRevenue
      }
    }

    return result
  }

  /**
   * Generate stack-based funding recommendation
   */
  private generateRecommendation(
    positions: PositionDetail[],
    mcaCount: number,
    paymentEstimate: { monthlyPayments?: number; burdenRatio?: number },
    hasBlanketLien: boolean
  ): StackRecommendation {
    const stackDepth = positions.length
    const suggestedPosition = stackDepth + 1

    // Determine if we can fund
    let canFund = true
    let reasoning = ''
    const requiredDueDiligence: string[] = []
    let suggestedTerms: StackRecommendation['suggestedTerms'] | undefined

    // Check for deal-breakers
    if (stackDepth >= 5) {
      canFund = false
      reasoning =
        'Stack depth of 5+ positions indicates excessive leverage. Not recommended for additional funding.'
    } else if (mcaCount >= 4) {
      canFund = false
      reasoning = '4+ existing MCA positions creates unacceptable default risk.'
    } else if (paymentEstimate.burdenRatio && paymentEstimate.burdenRatio > 0.35) {
      canFund = false
      reasoning = 'Estimated payment burden exceeds 35% of revenue - business is overleveraged.'
    }

    if (canFund) {
      // Position-based recommendations
      if (stackDepth === 0) {
        reasoning = 'Clean slate - 1st position available with maximum flexibility.'
        suggestedTerms = {
          minFactorRate: 1.15,
          minTerm: 180,
          maxDailyPercentage: 15
        }
      } else if (stackDepth === 1) {
        reasoning = '2nd position opportunity. Verify 1st position terms and remaining balance.'
        requiredDueDiligence.push('Verify 1st position balance and payoff amount')
        requiredDueDiligence.push('Request 3 months bank statements')
        suggestedTerms = {
          minFactorRate: 1.25,
          minTerm: 120,
          maxDailyPercentage: 18
        }
      } else if (stackDepth === 2) {
        reasoning = '3rd position requires careful underwriting but may be viable.'
        requiredDueDiligence.push('Full bank statement analysis')
        requiredDueDiligence.push('Verify all existing position balances')
        requiredDueDiligence.push('Calculate total payment burden')
        suggestedTerms = {
          minFactorRate: 1.35,
          minTerm: 90,
          maxDailyPercentage: 20
        }
      } else {
        reasoning = `${stackDepth + 1}th position is high risk. Consider consolidation or waiting for payoffs.`
        requiredDueDiligence.push('Comprehensive due diligence required')
        requiredDueDiligence.push('Verify payment history on all positions')
        requiredDueDiligence.push('Consider shorter term or smaller amount')
        suggestedTerms = {
          minFactorRate: 1.45,
          minTerm: 60,
          maxDailyPercentage: 22
        }
      }

      // Adjust for blanket liens
      if (hasBlanketLien) {
        requiredDueDiligence.push('Blanket UCC on file - verify subordination possibilities')
      }

      // Adjust for MCA count
      if (mcaCount >= 2) {
        requiredDueDiligence.push(`${mcaCount} existing MCA positions - verify no default history`)
      }
    }

    // Always require basic due diligence
    if (requiredDueDiligence.length === 0) {
      requiredDueDiligence.push('Standard bank statement review')
    }

    return {
      canFund,
      suggestedPosition,
      reasoning,
      requiredDueDiligence,
      suggestedTerms
    }
  }

  /**
   * Identify risks and opportunities from stack analysis
   */
  private identifyRisksAndOpportunities(
    positions: PositionDetail[],
    competitors: CompetitorPosition[],
    collateral: CollateralAnalysis[],
    paymentEstimate: { monthlyPayments?: number; burdenRatio?: number }
  ): { riskFactors: string[]; opportunities: string[] } {
    const riskFactors: string[] = []
    const opportunities: string[] = []

    // Risk factors
    if (positions.length >= 3) {
      riskFactors.push(`${positions.length} active positions indicate heavy reliance on financing`)
    }

    const mcaPositions = positions.filter((p) => p.funderType === 'mca')
    if (mcaPositions.length >= 2) {
      riskFactors.push(`${mcaPositions.length} existing MCA positions - check for payment issues`)
    }

    const tierDPositions = positions.filter((p) => p.funderTier === 'd')
    if (tierDPositions.length > 0) {
      riskFactors.push('Has positions with known high-risk lenders')
    }

    if (paymentEstimate.burdenRatio && paymentEstimate.burdenRatio > 0.2) {
      riskFactors.push(
        `High payment burden ratio: ${(paymentEstimate.burdenRatio * 100).toFixed(0)}%`
      )
    }

    const recentPositions = positions.filter((p) => p.daysActive < 90)
    if (recentPositions.length >= 2) {
      riskFactors.push('Multiple recent funding positions - potential stacking behavior')
    }

    // Opportunities
    if (positions.length === 0) {
      opportunities.push('Clean UCC history - prime 1st position candidate')
    }

    const nearingPayoff = positions.filter((p) => {
      const daysRemaining = p.estimatedPayoffDate
        ? Math.floor(
            (new Date(p.estimatedPayoffDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          )
        : 999
      return daysRemaining < 60
    })
    if (nearingPayoff.length > 0) {
      opportunities.push(
        `${nearingPayoff.length} position(s) nearing payoff - good timing for refinance discussion`
      )
    }

    const bankPositions = positions.filter((p) => p.funderType === 'bank')
    if (bankPositions.length > 0 && mcaPositions.length === 0) {
      opportunities.push('Only bank positions - likely good credit, consider competitive offer')
    }

    const terminatedFilings = competitors.filter((c) => !c.isActive).length
    if (terminatedFilings >= 2) {
      opportunities.push(
        `${terminatedFilings} terminated positions - history of paying off financing`
      )
    }

    const equipmentOnly = positions.every((p) => p.funderType === 'equipment')
    if (equipmentOnly && positions.length > 0) {
      opportunities.push(
        'Only equipment financing on file - working capital position likely available'
      )
    }

    return { riskFactors, opportunities }
  }

  /**
   * Identify funder from secured party name
   */
  private identifyFunder(securedPartyName: string): KnownFunder | undefined {
    if (!securedPartyName) return undefined

    const normalized = this.normalizeForMatching(securedPartyName)

    // Direct match
    if (this.funderIndex.has(normalized)) {
      return this.funderIndex.get(normalized)
    }

    // Partial match
    for (const [key, funder] of this.funderIndex.entries()) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return funder
      }
    }

    return undefined
  }

  /**
   * Normalize string for funder matching
   */
  private normalizeForMatching(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Estimate remaining balance on a filing
   */
  private estimateRemainingBalance(
    filing: UCCFilingForStack,
    daysActive: number
  ): number | undefined {
    if (!filing.originalAmount) return undefined

    // Assume typical MCA: 1.3x factor, 9 month term
    const totalPayback = filing.originalAmount * 1.3
    const termDays = 270 // 9 months
    const dailyPayment = totalPayback / termDays

    const paid = dailyPayment * Math.min(daysActive, termDays)
    const remaining = totalPayback - paid

    return Math.max(0, Math.round(remaining))
  }

  /**
   * Estimate payoff date for a filing
   */
  private estimatePayoffDate(filing: UCCFilingForStack): string | undefined {
    // Use expiration date if available
    if (filing.expirationDate) {
      return filing.expirationDate
    }

    // Otherwise estimate based on typical term
    const filingDate = new Date(filing.filingDate)
    const estimatedTermDays = 270 // 9 months average

    const payoffDate = new Date(filingDate.getTime() + estimatedTermDays * 24 * 60 * 60 * 1000)

    // If already past, assume paid off or renewed
    if (payoffDate < new Date()) {
      return undefined
    }

    return payoffDate.toISOString()
  }

  /**
   * Batch analyze stack for multiple prospects
   */
  async analyzeStackBatch(prospectIds: string[]): Promise<Map<string, StackAnalysis>> {
    const results = new Map<string, StackAnalysis>()

    for (const id of prospectIds) {
      try {
        const analysis = await this.analyzeStack(id)
        results.set(id, analysis)
      } catch (error) {
        console.error(`Failed to analyze stack for ${id}:`, error)
      }
    }

    return results
  }

  /**
   * Get known funders list (for UI/reporting)
   */
  getKnownFunders(): KnownFunder[] {
    return KNOWN_FUNDERS
  }

  /**
   * Add a new known funder
   */
  addKnownFunder(funder: KnownFunder): void {
    KNOWN_FUNDERS.push(funder)

    // Update index
    const normalized = this.normalizeForMatching(funder.name)
    this.funderIndex.set(normalized, funder)
    for (const alias of funder.aliases) {
      this.funderIndex.set(this.normalizeForMatching(alias), funder)
    }
  }
}

// Export singleton instance
export const stackAnalysisService = new StackAnalysisService()
