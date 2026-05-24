/**
 * Tests for RateLimiter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RateLimiter, createRateLimiter } from './RateLimiter'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic functionality', () => {
    it('should allow requests within rate limits', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 10,
        requestsPerHour: 100,
        requestsPerDay: 1000
      })

      // Should allow first request immediately
      const promise = limiter.acquire()
      await vi.runAllTimersAsync()
      await expect(promise).resolves.toBeUndefined()
    })

    it('should track request counts accurately', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 10,
        requestsPerHour: 100,
        requestsPerDay: 1000
      })

      // Make 3 requests
      await limiter.acquire()
      await limiter.acquire()
      await limiter.acquire()

      const stats = limiter.getStats()
      expect(stats.perMinute.current).toBe(3)
      expect(stats.perHour.current).toBe(3)
      expect(stats.perDay.current).toBe(3)
    })

    it('should calculate available slots correctly', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 5,
        requestsPerHour: 50,
        requestsPerDay: 500
      })

      await limiter.acquire()
      await limiter.acquire()

      const stats = limiter.getStats()
      expect(stats.perMinute.available).toBe(3)
      expect(stats.perHour.available).toBe(48)
      expect(stats.perDay.available).toBe(498)
    })
  })

  describe('rate limiting', () => {
    it('should enforce per-minute rate limit', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 2,
        requestsPerHour: 100,
        requestsPerDay: 1000
      })

      // Make 2 requests (should be instant)
      await limiter.acquire()
      await limiter.acquire()

      // Third request should wait
      const stats = limiter.getStats()
      expect(stats.perMinute.available).toBe(0)
    })

    it('should enforce per-hour rate limit', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 100,
        requestsPerHour: 3,
        requestsPerDay: 1000
      })

      await limiter.acquire()
      await limiter.acquire()
      await limiter.acquire()

      const stats = limiter.getStats()
      expect(stats.perHour.available).toBe(0)
    })

    it('should enforce per-day rate limit', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 100,
        requestsPerHour: 1000,
        requestsPerDay: 2
      })

      await limiter.acquire()
      await limiter.acquire()

      const stats = limiter.getStats()
      expect(stats.perDay.available).toBe(0)
    })

    it('should enforce per-second rate limit when configured', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 2,
        requestsPerMinute: 100,
        requestsPerHour: 1000,
        requestsPerDay: 10000
      })

      await limiter.acquire()
      await limiter.acquire()

      const stats = limiter.getStats()
      expect(stats.perSecond.available).toBe(0)
    })
  })

  describe('time windows', () => {
    it('should reset counts after time window expires', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 2,
        requestsPerHour: 100,
        requestsPerDay: 1000
      })

      await limiter.acquire()
      await limiter.acquire()

      let stats = limiter.getStats()
      expect(stats.perMinute.available).toBe(0)

      // Advance time by 61 seconds
      vi.advanceTimersByTime(61 * 1000)

      stats = limiter.getStats()
      expect(stats.perMinute.available).toBe(2)
    })

    it('should clean up old timestamps', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 100,
        requestsPerHour: 1000,
        requestsPerDay: 10000
      })

      await limiter.acquire()

      // Advance time by 25 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000)

      const stats = limiter.getStats()
      expect(stats.perDay.current).toBe(0)
    })
  })

  describe('reset()', () => {
    it('should clear all rate limit counters', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 2,
        requestsPerHour: 20,
        requestsPerDay: 200
      })

      await limiter.acquire()
      await limiter.acquire()

      limiter.reset()

      const stats = limiter.getStats()
      expect(stats.perMinute.current).toBe(0)
      expect(stats.perHour.current).toBe(0)
      expect(stats.perDay.current).toBe(0)
      expect(stats.perMinute.available).toBe(2)
    })
  })

  describe('getStats()', () => {
    it('should return comprehensive stats', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 10,
        requestsPerHour: 100,
        requestsPerDay: 1000
      })

      await limiter.acquire()

      const stats = limiter.getStats()

      expect(stats.perMinute).toHaveProperty('current')
      expect(stats.perMinute).toHaveProperty('limit')
      expect(stats.perMinute).toHaveProperty('available')

      expect(stats.perHour).toHaveProperty('current')
      expect(stats.perHour).toHaveProperty('limit')
      expect(stats.perHour).toHaveProperty('available')

      expect(stats.perDay).toHaveProperty('current')
      expect(stats.perDay).toHaveProperty('limit')
      expect(stats.perDay).toHaveProperty('available')
    })

    it('should show Infinity limit when per-second not configured', () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 10,
        requestsPerHour: 100,
        requestsPerDay: 1000
      })

      const stats = limiter.getStats()
      expect(stats.perSecond.limit).toBe(Infinity)
    })
  })

  describe('createRateLimiter presets', () => {
    it('should create conservative rate limiter', () => {
      const limiter = createRateLimiter('conservative')
      const stats = limiter.getStats()

      expect(stats.perMinute.limit).toBe(15)
      expect(stats.perHour.limit).toBe(300)
      expect(stats.perDay.limit).toBe(3000)
    })

    it('should create moderate rate limiter', () => {
      const limiter = createRateLimiter('moderate')
      const stats = limiter.getStats()

      expect(stats.perMinute.limit).toBe(30)
      expect(stats.perHour.limit).toBe(600)
      expect(stats.perDay.limit).toBe(6000)
    })

    it('should create aggressive rate limiter', () => {
      const limiter = createRateLimiter('aggressive')
      const stats = limiter.getStats()

      expect(stats.perMinute.limit).toBe(60)
      expect(stats.perHour.limit).toBe(1200)
      expect(stats.perDay.limit).toBe(12000)
    })

    it('should accept custom configuration', () => {
      const limiter = createRateLimiter({
        requestsPerMinute: 42,
        requestsPerHour: 420,
        requestsPerDay: 4200
      })

      const stats = limiter.getStats()
      expect(stats.perMinute.limit).toBe(42)
      expect(stats.perHour.limit).toBe(420)
      expect(stats.perDay.limit).toBe(4200)
    })
  })

  describe('concurrent requests', () => {
    it('should handle multiple concurrent requests', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 5,
        requestsPerHour: 50,
        requestsPerDay: 500
      })

      // Make 3 concurrent requests
      const promises = [limiter.acquire(), limiter.acquire(), limiter.acquire()]

      await vi.runAllTimersAsync()
      await Promise.all(promises)

      const stats = limiter.getStats()
      expect(stats.perMinute.current).toBe(3)
    })

    it('should not exceed the per-minute limit under concurrency', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 3,
        requestsPerHour: 100,
        requestsPerDay: 1000
      })

      // Fire 5 acquisitions in parallel against a limit of 3. Only 3 should be
      // granted within the current minute; the rest must wait.
      const promises = Array.from({ length: 5 }, () => limiter.acquire())

      // Let microtasks/timers settle for the slots that fit immediately.
      await vi.advanceTimersByTimeAsync(10)

      // The window must never report more than the configured limit.
      expect(limiter.getStats().perMinute.current).toBe(3)
      expect(limiter.getStats().perMinute.available).toBe(0)

      // Advance past the minute so the remaining 2 can be recorded.
      await vi.advanceTimersByTimeAsync(61 * 1000)
      await Promise.all(promises)

      // All 5 requests eventually recorded, and at no point did the window
      // exceed the limit of 3 (the two stragglers landed in a fresh minute).
      expect(limiter.getStats().perMinute.current).toBeLessThanOrEqual(3)
      expect(limiter.getStats().perHour.current).toBe(5)
    })
  })

  describe('real-world scenarios', () => {
    it('should handle NY state rate limits (30/min, 500/hour, 5000/day)', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 30,
        requestsPerHour: 500,
        requestsPerDay: 5000
      })

      // Make 30 requests
      for (let i = 0; i < 30; i++) {
        await limiter.acquire()
      }

      const stats = limiter.getStats()
      expect(stats.perMinute.current).toBe(30)
      expect(stats.perMinute.available).toBe(0)
    })

    it('should handle CA state rate limits (60/min, 1200/hour, 12000/day)', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 60,
        requestsPerHour: 1200,
        requestsPerDay: 12000
      })

      // Make 60 requests
      for (let i = 0; i < 60; i++) {
        await limiter.acquire()
      }

      const stats = limiter.getStats()
      expect(stats.perMinute.current).toBe(60)
      expect(stats.perMinute.available).toBe(0)
    })
  })
})
