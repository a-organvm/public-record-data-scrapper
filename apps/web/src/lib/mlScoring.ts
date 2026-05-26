import { Prospect, MLScoring, IndustryType } from '@public-records/core'

/**
 * Calculate ML confidence score and recovery likelihood for a prospect
 * This simulates an ML model's prediction based on multiple factors
 */
export function calculateMLScoring(prospect: Prospect): MLScoring {
  // Industry risk factors (lower is better for recovery)
  const industryRiskMap: Record<IndustryType, number> = {
    technology: 75, // High recovery potential
    healthcare: 70,
    manufacturing: 65,
    services: 60,
    construction: 55,
    retail: 50,
    restaurant: 40 // Higher default risk
  }

  // Calculate health trend score
  const healthTrendScore = calculateHealthTrend(prospect)

  // Calculate signal quality score
  const signalQualityScore = calculateSignalQuality(prospect)

  // Get industry risk score
  const industryRiskScore = industryRiskMap[prospect.industry] || 50

  // Calculate time to recovery factor (optimal is 1-3 years)
  const timeToRecoveryScore = calculateTimeToRecovery(prospect)

  // Calculate financial stability
  const financialStabilityScore = calculateFinancialStability(prospect)

  // Calculate overall ML confidence (weighted average)
  const confidence = Math.round(
    healthTrendScore * 0.25 +
      signalQualityScore * 0.3 +
      industryRiskScore * 0.15 +
      timeToRecoveryScore * 0.15 +
      financialStabilityScore * 0.15
  )

  // Calculate recovery likelihood with non-linear scaling
  // Higher confidence and better factors = higher recovery likelihood
  const baseRecovery = confidence * 0.8 // Start with 80% of confidence
  const signalBonus = (signalQualityScore / 100) * 15 // Up to 15% bonus from signals
  const healthBonus = (healthTrendScore / 100) * 10 // Up to 10% bonus from health
  const recoveryLikelihood = Math.min(95, Math.round(baseRecovery + signalBonus + healthBonus))

  return {
    confidence,
    recoveryLikelihood,
    modelVersion: 'v2.1.0',
    lastUpdated: new Date().toISOString().split('T')[0],
    factors: {
      healthTrend: Math.round(healthTrendScore),
      signalQuality: Math.round(signalQualityScore),
      industryRisk: Math.round(industryRiskScore),
      timeToRecovery: Math.round(timeToRecoveryScore),
      financialStability: Math.round(financialStabilityScore)
    }
  }
}

function calculateHealthTrend(prospect: Prospect): number {
  const { healthScore } = prospect

  // Base score from health grade
  const gradeScores: Record<string, number> = { A: 95, B: 80, C: 60, D: 40, F: 20 }
  // Fall back to a neutral mid score for any unexpected/undefined grade so the
  // calculation never yields NaN.
  let score = gradeScores[healthScore.grade] ?? 50

  // Adjust for sentiment trend
  if (healthScore.sentimentTrend === 'improving') {
    score += 10
  } else if (healthScore.sentimentTrend === 'declining') {
    score -= 15
  }

  // Adjust for violations
  score -= Math.min(20, healthScore.violationCount * 4)

  return Math.max(0, Math.min(100, score))
}

function calculateSignalQuality(prospect: Prospect): number {
  const signals = prospect.growthSignals ?? []

  if (signals.length === 0) return 20

  // Calculate average signal confidence and score
  const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
  const avgScore = signals.reduce((sum, s) => sum + s.score, 0) / signals.length

  // High-value signal types boost score
  const hasHighValueSignals = signals.some((s) => s.type === 'contract' || s.type === 'expansion')

  let score = (avgConfidence + avgScore) / 2

  // Bonus for multiple signals
  if (signals.length >= 3) score += 10
  if (signals.length >= 5) score += 5

  // Bonus for high-value signals
  if (hasHighValueSignals) score += 10

  return Math.min(100, score)
}

function calculateTimeToRecovery(prospect: Prospect): number {
  const daysSinceDefault = prospect.timeSinceDefault
  const yearsSinceDefault = daysSinceDefault / 365

  // Optimal recovery window is 1-3 years
  if (yearsSinceDefault < 0.5) {
    // Too recent, may still be in crisis
    return 40
  } else if (yearsSinceDefault <= 1) {
    return 65
  } else if (yearsSinceDefault <= 2) {
    return 85 // Sweet spot
  } else if (yearsSinceDefault <= 3) {
    return 75
  } else if (yearsSinceDefault <= 4) {
    return 60
  } else {
    // Too old, less likely to recover
    return Math.max(30, 60 - (yearsSinceDefault - 4) * 8)
  }
}

function calculateFinancialStability(prospect: Prospect): number {
  let score = 50 // Base score

  // Revenue factor
  if (prospect.estimatedRevenue) {
    const revenue = prospect.estimatedRevenue
    if (revenue > 5000000) {
      score += 25
    } else if (revenue > 2000000) {
      score += 15
    } else if (revenue > 1000000) {
      score += 10
    } else if (revenue > 500000) {
      score += 5
    }
  }

  // UCC filing status
  const uccFilings = prospect.uccFilings ?? []
  const activeFilings = uccFilings.filter((f) => f.status === 'active').length
  const terminatedFilings = uccFilings.filter((f) => f.status === 'terminated').length

  // Terminated filings are positive (debts cleared)
  score += Math.min(15, terminatedFilings * 5)

  // Too many active filings is negative
  if (activeFilings > 3) {
    score -= 10
  }

  return Math.max(0, Math.min(100, score))
}

/**
 * Add ML confidence to individual growth signals
 */
export function addMLConfidenceToSignal(signal: {
  type: string
  confidence: number
  score: number
  detectedDate: string
}): number {
  // Start with base confidence
  let mlConfidence = signal.confidence

  // Recent signals get a boost
  const daysSinceDetection = Math.floor(
    (Date.now() - new Date(signal.detectedDate).getTime()) / (1000 * 60 * 60 * 24)
  )

  if (daysSinceDetection < 30) {
    mlConfidence += 5
  } else if (daysSinceDetection > 180) {
    mlConfidence -= 10
  }

  // High-value signal types get confidence boost
  if (signal.type === 'contract' || signal.type === 'expansion') {
    mlConfidence += 10
  }

  // Score alignment check
  if (Math.abs(signal.confidence - signal.score) < 10) {
    // Confidence and score align, boost ML confidence
    mlConfidence += 5
  }

  // Round to a whole number for consistency with the other scoring outputs,
  // which all return rounded integers.
  return Math.round(Math.max(0, Math.min(100, mlConfidence)))
}
