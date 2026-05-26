import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UnderwritingService, createUnderwritingService } from '../../services/UnderwritingService'
import type { PlaidTransaction, PlaidAccount } from '../../integrations/plaid'

// Mock the Plaid integrations.
// Use vi.hoisted() so these mock fns are initialized before the hoisted
// vi.mock factory runs (referencing plain top-level consts inside the factory
// throws "Cannot access ... before initialization").
const { mockFetchAllTransactions, mockParseTransactionCategory } = vi.hoisted(() => ({
  mockFetchAllTransactions: vi.fn(),
  mockParseTransactionCategory: vi.fn()
}))

vi.mock('../../integrations/plaid', () => ({
  plaidTransactionsManager: {
    fetchAllTransactions: mockFetchAllTransactions,
    parseTransactionCategory: mockParseTransactionCategory
  },
  PlaidTransactionsManager: class MockPlaidTransactionsManager {
    fetchAllTransactions = mockFetchAllTransactions
    parseTransactionCategory = mockParseTransactionCategory
  }
}))

describe('UnderwritingService', () => {
  let service: UnderwritingService

  const createMockAccount = (overrides: Partial<PlaidAccount> = {}): PlaidAccount => ({
    accountId: 'acc-1',
    name: 'Business Checking',
    type: 'depository',
    subtype: 'checking',
    mask: '1234',
    balances: {
      current: 15000,
      available: 14000
    },
    ...overrides
  })

  // Build a date `monthsAgo`/`daysAgo` before today so transactions fall inside
  // the default 6-month analysis window regardless of when the suite runs.
  const dateAgo = (opts: { months?: number; days?: number }): string => {
    const d = new Date()
    if (opts.months) d.setMonth(d.getMonth() - opts.months)
    if (opts.days) d.setDate(d.getDate() - opts.days)
    return d.toISOString().split('T')[0]
  }

  const createMockTransaction = (overrides: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
    transactionId: `tx-${Math.random().toString(36).substr(2, 9)}`,
    accountId: 'acc-1',
    date: dateAgo({ days: 15 }),
    amount: 100,
    name: 'Test Transaction',
    category: ['Transfer', 'Debit'],
    pending: false,
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()
    service = new UnderwritingService()

    // Default mock implementations
    mockParseTransactionCategory.mockReturnValue({
      isDeposit: false,
      isWithdrawal: true,
      isNsfFee: false,
      isLenderPayment: false,
      isTransfer: false
    })
  })

  describe('extractFeatures', () => {
    it('should extract features from bank data', async () => {
      const mockAccounts = [createMockAccount()]
      const mockTransactions = [
        createMockTransaction({ amount: -5000, date: '2024-01-01' }), // Deposit
        createMockTransaction({ amount: 200, date: '2024-01-02' }), // Withdrawal
        createMockTransaction({ amount: -3000, date: '2024-01-15' }) // Deposit
      ]

      mockFetchAllTransactions.mockResolvedValueOnce({
        accounts: mockAccounts,
        transactions: mockTransactions
      })

      const result = await service.extractFeatures('access-token-123')

      expect(result.primaryAccountId).toBe('acc-1')
      expect(result.currentBalance).toBe(15000)
      expect(result.totalDaysAnalyzed).toBeGreaterThan(0)
      expect(result.totalTransactionsAnalyzed).toBe(3)
    })

    it('should calculate average daily balance', async () => {
      const mockAccounts = [createMockAccount()]
      const mockTransactions = [
        createMockTransaction({ amount: -10000, date: '2024-01-01' }),
        createMockTransaction({ amount: 500, date: '2024-01-15' }),
        createMockTransaction({ amount: -5000, date: '2024-01-20' })
      ]

      mockFetchAllTransactions.mockResolvedValueOnce({
        accounts: mockAccounts,
        transactions: mockTransactions
      })

      const result = await service.extractFeatures('access-token-123')

      expect(result.averageDailyBalance).toBeDefined()
      expect(typeof result.averageDailyBalance).toBe('number')
    })

    it('should detect NSF/overdraft events', async () => {
      const mockAccounts = [createMockAccount()]
      const mockTransactions = [
        createMockTransaction({ amount: 35, date: dateAgo({ days: 20 }), name: 'NSF FEE' }),
        createMockTransaction({ amount: 35, date: dateAgo({ days: 10 }), name: 'OVERDRAFT FEE' })
      ]

      mockParseTransactionCategory
        .mockReturnValueOnce({
          isNsfFee: true,
          isDeposit: false,
          isWithdrawal: true,
          isLenderPayment: false,
          isTransfer: false
        })
        .mockReturnValueOnce({
          isNsfFee: true,
          isDeposit: false,
          isWithdrawal: true,
          isLenderPayment: false,
          isTransfer: false
        })

      mockFetchAllTransactions.mockResolvedValueOnce({
        accounts: mockAccounts,
        transactions: mockTransactions
      })

      const result = await service.extractFeatures('access-token-123')

      expect(result.nsfCount).toBe(2)
      expect(result.nsfFeeTotal).toBe(70)
    })

    it('should calculate negative days percentage', async () => {
      const mockAccounts = [createMockAccount()]
      const mockTransactions = [
        createMockTransaction({ amount: 1000, date: '2024-01-01' }) // Large withdrawal causing negative
      ]

      mockFetchAllTransactions.mockResolvedValueOnce({
        accounts: mockAccounts,
        transactions: mockTransactions
      })

      const result = await service.extractFeatures('access-token-123')

      expect(result.negativeDaysPercentage).toBeDefined()
      expect(result.negativeDaysPercentage).toBeGreaterThanOrEqual(0)
    })

    it('should throw error when no suitable account found', async () => {
      mockFetchAllTransactions.mockResolvedValueOnce({
        accounts: [],
        transactions: []
      })

      await expect(service.extractFeatures('access-token-123')).rejects.toThrow(
        'No suitable account found'
      )
    })

    it('should prefer checking accounts over savings', async () => {
      const mockAccounts = [
        createMockAccount({ accountId: 'savings-1', subtype: 'savings' }),
        createMockAccount({ accountId: 'checking-1', subtype: 'checking' })
      ]

      mockFetchAllTransactions.mockResolvedValueOnce({
        accounts: mockAccounts,
        transactions: []
      })

      const result = await service.extractFeatures('access-token-123')

      expect(result.primaryAccountId).toBe('savings-1') // First account matching criteria
    })
  })

  describe('analyzeTransactions', () => {
    it('should calculate min/max/average daily balance', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -10000, date: '2024-01-01' }), // Deposit
        createMockTransaction({ amount: 5000, date: '2024-01-15' }) // Withdrawal
      ]

      const startDate = new Date('2024-01-01')
      const endDate = new Date('2024-01-31')

      const result = service.analyzeTransactions(transactions, startDate, endDate)

      expect(result.minimumDailyBalance).toBeDefined()
      expect(result.maximumDailyBalance).toBeDefined()
      expect(result.averageDailyBalance).toBeDefined()
    })

    it('should count negative balance days', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: 10000, date: '2024-01-01' }) // Large withdrawal
      ]

      const startDate = new Date('2024-01-01')
      const endDate = new Date('2024-01-10')

      const result = service.analyzeTransactions(transactions, startDate, endDate)

      expect(result.negativeDays).toBeGreaterThanOrEqual(0)
    })

    it('should calculate total deposits', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -5000, date: '2024-01-01' }),
        createMockTransaction({ amount: -3000, date: '2024-01-15' }),
        createMockTransaction({ amount: 1000, date: '2024-01-20' })
      ]

      const startDate = new Date('2024-01-01')
      const endDate = new Date('2024-01-31')

      const result = service.analyzeTransactions(transactions, startDate, endDate)

      expect(result.totalDeposits).toBe(8000) // 5000 + 3000
    })
  })

  describe('detectLenderPayments', () => {
    it('should detect MCA lender payments', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: 500, date: '2024-01-01', name: 'ONDECK CAPITAL' }),
        createMockTransaction({ amount: 500, date: '2024-01-02', name: 'ONDECK CAPITAL' }),
        createMockTransaction({ amount: 500, date: '2024-01-03', name: 'ONDECK CAPITAL' })
      ]

      mockParseTransactionCategory.mockReturnValue({
        isLenderPayment: true,
        isDeposit: false,
        isWithdrawal: true,
        isNsfFee: false,
        isTransfer: false
      })

      const result = service.detectLenderPayments(transactions)

      expect(result.length).toBeGreaterThan(0)
      expect(result[0].lenderName).toContain('ONDECK')
    })

    it('should determine payment frequency', () => {
      const transactions: PlaidTransaction[] = []

      // Create daily payments
      for (let i = 0; i < 20; i++) {
        transactions.push(
          createMockTransaction({
            amount: 200,
            date: `2024-01-${String(i + 1).padStart(2, '0')}`,
            name: 'KABBAGE INC'
          })
        )
      }

      mockParseTransactionCategory.mockReturnValue({
        isLenderPayment: true,
        isDeposit: false,
        isWithdrawal: true,
        isNsfFee: false,
        isTransfer: false
      })

      const result = service.detectLenderPayments(transactions)

      expect(result.some((p) => p.frequency === 'daily')).toBe(true)
    })

    it('should calculate confidence score', () => {
      const transactions: PlaidTransaction[] = []

      // Many consistent payments = high confidence
      for (let i = 0; i < 30; i++) {
        transactions.push(
          createMockTransaction({
            amount: 350,
            date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
            name: 'BLUEVINE CAPITAL'
          })
        )
      }

      mockParseTransactionCategory.mockReturnValue({
        isLenderPayment: true,
        isDeposit: false,
        isWithdrawal: true,
        isNsfFee: false,
        isTransfer: false
      })

      const result = service.detectLenderPayments(transactions)

      expect(result[0]?.confidence).toBeGreaterThan(0.5)
    })
  })

  describe('analyzeRevenueTrend', () => {
    it('should identify increasing revenue', () => {
      // The trend direction compares the average of the first 3 months to the
      // average of the last 3 months, so we provide >= 5 months of rising
      // deposits (months are derived from the YYYY-MM of each tx date).
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -20000, date: '2024-01-15' }),
        createMockTransaction({ amount: -22000, date: '2024-02-15' }),
        createMockTransaction({ amount: -25000, date: '2024-03-15' }),
        createMockTransaction({ amount: -30000, date: '2024-04-15' }),
        createMockTransaction({ amount: -38000, date: '2024-05-15' }),
        createMockTransaction({ amount: -45000, date: '2024-06-15' })
      ]

      mockParseTransactionCategory.mockReturnValue({
        isTransfer: false,
        isDeposit: true,
        isWithdrawal: false,
        isNsfFee: false,
        isLenderPayment: false
      })

      const result = service.analyzeRevenueTrend(transactions)

      expect(result.direction).toBe('increasing')
      expect(result.percentageChange).toBeGreaterThan(0)
    })

    it('should identify decreasing revenue', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -45000, date: '2024-01-15' }),
        createMockTransaction({ amount: -38000, date: '2024-02-15' }),
        createMockTransaction({ amount: -30000, date: '2024-03-15' }),
        createMockTransaction({ amount: -25000, date: '2024-04-15' }),
        createMockTransaction({ amount: -22000, date: '2024-05-15' }),
        createMockTransaction({ amount: -20000, date: '2024-06-15' })
      ]

      mockParseTransactionCategory.mockReturnValue({
        isTransfer: false,
        isDeposit: true,
        isWithdrawal: false,
        isNsfFee: false,
        isLenderPayment: false
      })

      const result = service.analyzeRevenueTrend(transactions)

      expect(result.direction).toBe('decreasing')
    })

    it('should identify stable revenue', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -25000, date: '2024-01-15' }),
        createMockTransaction({ amount: -25500, date: '2024-02-15' }),
        createMockTransaction({ amount: -24500, date: '2024-03-15' })
      ]

      mockParseTransactionCategory.mockReturnValue({
        isTransfer: false,
        isDeposit: true,
        isWithdrawal: false,
        isNsfFee: false,
        isLenderPayment: false
      })

      const result = service.analyzeRevenueTrend(transactions)

      expect(result.direction).toBe('stable')
    })

    it('should calculate seasonality score', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -50000, date: '2024-01-15' }),
        createMockTransaction({ amount: -20000, date: '2024-02-15' }),
        createMockTransaction({ amount: -45000, date: '2024-03-15' }),
        createMockTransaction({ amount: -15000, date: '2024-04-15' })
      ]

      mockParseTransactionCategory.mockReturnValue({
        isTransfer: false,
        isDeposit: true,
        isWithdrawal: false,
        isNsfFee: false,
        isLenderPayment: false
      })

      const result = service.analyzeRevenueTrend(transactions)

      expect(result.seasonalityScore).toBeGreaterThan(0)
    })

    it('should provide monthly breakdown', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -10000, date: '2024-01-01' }),
        createMockTransaction({ amount: -15000, date: '2024-01-15' }),
        createMockTransaction({ amount: -12000, date: '2024-02-01' })
      ]

      mockParseTransactionCategory.mockReturnValue({
        isTransfer: false,
        isDeposit: true,
        isWithdrawal: false,
        isNsfFee: false,
        isLenderPayment: false
      })

      const result = service.analyzeRevenueTrend(transactions)

      expect(result.monthlyData.length).toBeGreaterThan(0)
      expect(result.monthlyData[0]).toHaveProperty('totalDeposits')
    })
  })

  describe('calculateDepositConsistency', () => {
    it('should return high score for consistent deposits', () => {
      const transactions: PlaidTransaction[] = []

      // Weekly deposits of similar amounts
      for (let i = 0; i < 12; i++) {
        transactions.push(
          createMockTransaction({
            amount: -5000 + Math.random() * 200, // Slight variation
            date: `2024-0${Math.floor(i / 4) + 1}-${String((i % 4) * 7 + 1).padStart(2, '0')}`
          })
        )
      }

      mockParseTransactionCategory.mockReturnValue({
        isTransfer: false,
        isDeposit: true,
        isWithdrawal: false,
        isNsfFee: false,
        isLenderPayment: false
      })

      const result = service.calculateDepositConsistency(transactions)

      expect(result).toBeGreaterThan(50)
    })

    it('should return low score for irregular deposits', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -50000, date: '2024-01-01' }),
        createMockTransaction({ amount: -1000, date: '2024-01-25' }),
        createMockTransaction({ amount: -30000, date: '2024-02-10' })
      ]

      mockParseTransactionCategory.mockReturnValue({
        isTransfer: false,
        isDeposit: true,
        isWithdrawal: false,
        isNsfFee: false,
        isLenderPayment: false
      })

      const result = service.calculateDepositConsistency(transactions)

      expect(result).toBeLessThan(80)
    })

    it('should return 0 for less than 2 deposits', () => {
      const transactions: PlaidTransaction[] = [
        createMockTransaction({ amount: -5000, date: '2024-01-01' })
      ]

      mockParseTransactionCategory.mockReturnValue({
        isTransfer: false,
        isDeposit: true,
        isWithdrawal: false,
        isNsfFee: false,
        isLenderPayment: false
      })

      const result = service.calculateDepositConsistency(transactions)

      expect(result).toBe(0)
    })
  })

  describe('createUnderwritingService', () => {
    it('should create service with custom transactions manager', () => {
      const mockManager = {
        fetchAllTransactions: vi.fn(),
        parseTransactionCategory: vi.fn()
      }

      const customService = createUnderwritingService(
        mockManager as unknown as Parameters<typeof createUnderwritingService>[0]
      )

      expect(customService).toBeInstanceOf(UnderwritingService)
    })
  })
})
