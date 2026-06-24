/**
 * California UCC Scraper
 *
 * Scrapes UCC filing data from California Secretary of State
 * Uses Puppeteer for real web scraping with anti-detection measures
 */

import { ScraperResult, UCCFiling } from '../base-scraper'
import { BasePuppeteerScraper } from '../base-puppeteer-scraper'
import type { Frame } from 'puppeteer'
import { PaginationHandler } from '../pagination-handler'

export class CaliforniaScraper extends BasePuppeteerScraper {

  constructor(options: { headless?: boolean; keepPageOpenOnFailure?: boolean } = {}) {
    super({
      state: 'CA',
      baseUrl: 'https://bizfileonline.sos.ca.gov/search/ucc',
      rateLimit: 4, // 4 requests per minute (conservative for state portal)
      timeout: 45000, // Increased timeout for CA SOS portal
      retryAttempts: 2
    }, options)
  }

  /**
   * Search for UCC filings in California
   */
  async search(companyName: string): Promise<ScraperResult> {
    if (!this.validateSearch(companyName)) {
      this.log('error', 'Invalid company name provided', { companyName })
      return {
        success: false,
        error: 'Invalid company name',
        timestamp: new Date().toISOString()
      }
    }

    this.log('info', 'Starting UCC search', { companyName })

    // Rate limiting - wait 12 seconds between requests (5 per minute)
    await this.sleep(12000)

    const searchUrl = this.getManualSearchUrl(companyName)

    try {
      const { result, retryCount } = await this.retryWithBackoff(async () => {
        return await this.performSearch(companyName, searchUrl)
      }, `CA UCC search for ${companyName}`)

      this.log('info', 'UCC search completed successfully', {
        companyName,
        filingCount: result.filings?.length || 0,
        retryCount
      })

      return {
        ...result,
        retryCount
      }
    } catch (error) {
      this.log('error', 'UCC search failed after all retries', {
        companyName,
        error: error instanceof Error ? error.message : String(error)
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        searchUrl,
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Perform the actual search operation
   *
   * NOTE: California UCC search is through bizfileonline.sos.ca.gov
   * Offers free searches but may require account for advanced features
   */
  private async performSearch(companyName: string, searchUrl: string): Promise<ScraperResult> {
    return this.withSearchPage(async (page, finalize) => {
      // Non-null alias for use inside closures below — TS resets the
      // null-narrowing of `page` inside nested functions.
      const activePage = page

      this.log('info', 'Browser page created', { companyName })

      await this.initializePage(page)

      // Navigate to California UCC search page
      this.log('info', 'Navigating to CA UCC search page', { companyName, searchUrl })
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout
      })

      // Wait for page to load
      await this.sleep(2000)

      const isWafBlocked = async (): Promise<boolean> => {
        try {
          return await activePage.evaluate(() => {
            const bodyText = document.body.innerText.toLowerCase()
            return (
              bodyText.includes('incapsula') ||
              bodyText.includes('request unsuccessful') ||
              bodyText.includes('access denied') ||
              document.querySelector('iframe[src*="Incapsula_Resource" i]') !== null
            )
          })
        } catch {
          return false
        }
      }

      if (await isWafBlocked()) {
        const errorMessage =
          'California UCC portal blocked by anti-bot protection (Incapsula/Imperva).'
        this.log('error', errorMessage, { companyName })
        return finalize({
          success: false,
          error: errorMessage,
          searchUrl: page.url(),
          timestamp: new Date().toISOString()
        })
      }

      // Check for CAPTCHA early
      const hasCaptcha = await page.evaluate(() => {
        return (
          document.body.innerText.toLowerCase().includes('captcha') ||
          document.body.innerText.toLowerCase().includes('robot') ||
          document.querySelector('iframe[src*="recaptcha"]') !== null ||
          document.querySelector('iframe[src*="hcaptcha"]') !== null
        )
      })

      if (hasCaptcha) {
        this.log('error', 'CAPTCHA detected', { companyName })
        return finalize({
          success: false,
          error: 'CAPTCHA detected - manual intervention required',
          searchUrl: page.url(),
          timestamp: new Date().toISOString()
        })
      }

      // Check if login/account is required
      const requiresLogin = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase()
        return (
          (bodyText.includes('sign in') || bodyText.includes('log in')) &&
          bodyText.includes('account') &&
          !bodyText.includes('free search')
        )
      })

      if (requiresLogin) {
        this.log('warn', 'California portal may require account', { companyName })
        // Continue anyway as some searches might be available without login
      }

      const possibleSelectors = [
        'input[name="debtorName"]',
        'input[name="debtor_name"]',
        'input[name="DebtorName"]',
        'input[name="searchCriteria"]',
        'input[name="SearchCriteria"]',
        'input[id="debtorName"]',
        'input[id="debtor_name"]',
        'input[id="searchCriteria"]',
        'input[placeholder*="Debtor"]',
        'input[placeholder*="debtor"]',
        'input[placeholder*="Name"]',
        'input[type="text"]'
      ]

      const fillSearchFormInFrame = async (frame: Frame): Promise<boolean> => {
        try {
          return await frame.evaluate(
            (name, selectors) => {
              for (const selector of selectors) {
                const input = document.querySelector(selector) as HTMLInputElement
                if (input && !input.disabled && input.offsetParent !== null) {
                  input.value = name
                  // Trigger events for React/Angular/Vue apps
                  input.dispatchEvent(new Event('input', { bubbles: true }))
                  input.dispatchEvent(new Event('change', { bubbles: true }))
                  return true
                }
              }
              return false
            },
            companyName,
            possibleSelectors
          )
        } catch {
          return false
        }
      }

      const fillSearchForm = async (): Promise<boolean> => {
        const mainFilled = await fillSearchFormInFrame(activePage.mainFrame())
        if (mainFilled) {
          return true
        }
        for (const frame of activePage.frames()) {
          if (frame === activePage.mainFrame()) {
            continue
          }
          if (await fillSearchFormInFrame(frame)) {
            return true
          }
        }
        return false
      }

      const detectPreloadedResultsInFrame = async (
        frame: Frame
      ): Promise<{ hasResults: boolean; hasNoResults: boolean }> => {
        try {
          return await frame.evaluate(() => {
            const resultsContainers = document.querySelectorAll(
              'table.results, table.search-results, table.ucc-results, div.result-item, div.filing-item'
            )
            const hasRows =
              document.querySelectorAll(
                'table.results tbody tr, table.search-results tbody tr, table.ucc-results tbody tr, div.result-item, div.filing-item'
              ).length > 0
            const bodyText = document.body.innerText.toLowerCase()
            const hasNoResults =
              bodyText.includes('no records found') ||
              bodyText.includes('no results') ||
              bodyText.includes('0 results') ||
              bodyText.includes('no filings found') ||
              bodyText.includes('no matches')
            return { hasResults: resultsContainers.length > 0 || hasRows, hasNoResults }
          })
        } catch {
          return { hasResults: false, hasNoResults: false }
        }
      }

      const detectPreloadedResults = async (): Promise<{
        hasResults: boolean
        hasNoResults: boolean
      }> => {
        let combined = await detectPreloadedResultsInFrame(activePage.mainFrame())
        if (combined.hasResults || combined.hasNoResults) {
          return combined
        }
        for (const frame of activePage.frames()) {
          if (frame === activePage.mainFrame()) {
            continue
          }
          const result = await detectPreloadedResultsInFrame(frame)
          if (result.hasResults || result.hasNoResults) {
            combined = result
            break
          }
        }
        return combined
      }

      // Look for debtor name search field
      let searchFormFilled = await fillSearchForm()
      let usingPreloadedResults = false

      if (!searchFormFilled) {
        const preloaded = await detectPreloadedResults()
        if (preloaded.hasResults || preloaded.hasNoResults) {
          usingPreloadedResults = true
          this.log('info', 'Search form not found; using preloaded results page', { companyName })
        } else {
          this.log('warn', 'Could not find debtor name search field, retrying on base URL', {
            companyName
          })
          await page.goto(this.config.baseUrl, {
            waitUntil: 'domcontentloaded',
            timeout: this.config.timeout
          })
          await this.sleep(2000)
          if (await isWafBlocked()) {
            const errorMessage =
              'California UCC portal blocked by anti-bot protection (Incapsula/Imperva).'
            this.log('error', errorMessage, { companyName })
            return finalize({
              success: false,
              error: errorMessage,
              searchUrl: page.url(),
              timestamp: new Date().toISOString()
            })
          }
          searchFormFilled = await fillSearchForm()
        }
      }

      if (!searchFormFilled && !usingPreloadedResults) {
        this.log('warn', 'Could not find debtor name search field', { companyName })
        return finalize({
          success: false,
          error:
            'Unable to locate debtor name search field on California UCC portal. Portal structure may have changed or requires login.',
          searchUrl: page.url(),
          timestamp: new Date().toISOString()
        })
      }

      if (searchFormFilled) {
        // Submit the search form
        const formSubmitted = await page.evaluate(() => {
          // Try to find and click search/submit button
          const buttons = Array.from(
            document.querySelectorAll('button, input[type="submit"], input[type="button"]')
          )
          const searchButton = buttons.find((btn) => {
            const text =
              (btn as HTMLElement).textContent?.toLowerCase() ||
              (btn as HTMLInputElement).value?.toLowerCase() ||
              ''
            return text.includes('search') || text.includes('submit') || text.includes('find')
          })

          if (searchButton && (searchButton as HTMLElement).offsetParent !== null) {
            ;(searchButton as HTMLElement).click()
            return true
          }

          // Fallback: try form submission
          const form = document.querySelector('form')
          if (form) {
            form.submit()
            return true
          }

          return false
        })

        if (!formSubmitted) {
          this.log('warn', 'Could not submit search form', { companyName })
          return finalize({
            success: false,
            error: 'Unable to submit search form on California UCC portal.',
            searchUrl: page.url(),
            timestamp: new Date().toISOString()
          })
        }

        // Wait for results to load
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {})
        await this.sleep(3000) // Additional wait for dynamic content
      } else {
        await this.sleep(1000)
      }

      // Check for "no results" message
      const noResults = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase()
        return (
          bodyText.includes('no records found') ||
          bodyText.includes('no results') ||
          bodyText.includes('0 results') ||
          bodyText.includes('no filings found') ||
          bodyText.includes('no matches')
        )
      })

      if (noResults) {
        this.log('info', 'No UCC filings found', { companyName })
        return finalize({
          success: true,
          filings: [],
          searchUrl: page.url(),
          timestamp: new Date().toISOString()
        })
      }

      // Initialize pagination handler
      const paginationHandler = new PaginationHandler({ maxPages: 10 })
      const allFilings: UCCFiling[] = []
      const allErrors: string[] = []
      let currentPage = 1

      // Pagination loop
      while (true) {
        this.log('info', `Scraping page ${currentPage}`, { companyName })

        // Extract UCC filing data with multiple selector strategies
        const { filings: rawFilings, errors: parseErrors } = await page.evaluate(() => {
          const results: Array<{
            filingNumber: string
            debtorName: string
            securedParty: string
            filingDate: string
            collateral: string
            status: 'active' | 'terminated' | 'lapsed'
            filingType: 'UCC-1' | 'UCC-3'
          }> = []
          const errors: string[] = []

          // Try multiple selector strategies for California UCC results
          let resultElements = document.querySelectorAll(
            'table.results tbody tr, table.search-results tbody tr, table.ucc-results tbody tr, div.result-item, div.filing-item'
          )

          // Fallback: find any table with multiple rows that looks like results
          if (resultElements.length === 0) {
            const tables = document.querySelectorAll('table')
            for (const table of tables) {
              const rows = table.querySelectorAll('tbody tr, tr')
              if (rows.length > 1) {
                resultElements = rows
                break
              }
            }
          }

          resultElements.forEach((element, index) => {
            // Skip header rows
            if (element.querySelector('th')) {
              return
            }

            try {
              const cells = element.querySelectorAll('td')

              if (cells.length >= 3) {
                // Common California UCC table pattern: filing#, date, debtor, secured party, status
                const filingNumber = cells[0]?.textContent?.trim() || ''
                const filingDate = cells[1]?.textContent?.trim() || ''
                const debtorName = cells[2]?.textContent?.trim() || ''
                const securedParty = cells[3]?.textContent?.trim() || ''
                const status =
                  cells[4]?.textContent?.trim() ||
                  cells[cells.length - 1]?.textContent?.trim() ||
                  ''

                // Sometimes column order varies
                if (!filingNumber.match(/\d/) && cells[1]?.textContent?.match(/\d/)) {
                  // Swap if first cell doesn't have numbers
                  const alt = {
                    debtorName: cells[0]?.textContent?.trim() || '',
                    filingNumber: cells[1]?.textContent?.trim() || '',
                    filingDate: cells[2]?.textContent?.trim() || '',
                    securedParty: cells[3]?.textContent?.trim() || ''
                  }

                  if (alt.filingNumber || alt.debtorName) {
                    results.push({
                      filingNumber: alt.filingNumber,
                      debtorName: alt.debtorName,
                      securedParty: alt.securedParty,
                      filingDate: alt.filingDate,
                      collateral: '',
                      status:
                        status.toLowerCase().includes('active') ||
                        status.toLowerCase().includes('filed')
                          ? 'active'
                          : status.toLowerCase().includes('terminated') ||
                              status.toLowerCase().includes('discharged')
                            ? 'terminated'
                            : status.toLowerCase().includes('lapsed') ||
                                status.toLowerCase().includes('expired')
                              ? 'lapsed'
                              : 'active',
                      filingType:
                        alt.filingNumber.toLowerCase().includes('ucc3') ||
                        alt.filingNumber.toLowerCase().includes('ucc-3') ||
                        alt.filingNumber.toLowerCase().includes('amendment')
                          ? 'UCC-3'
                          : 'UCC-1'
                    })
                  }
                } else if (filingNumber || debtorName) {
                  results.push({
                    filingNumber,
                    debtorName,
                    securedParty,
                    filingDate,
                    collateral: '',
                    status:
                      status.toLowerCase().includes('active') ||
                      status.toLowerCase().includes('filed')
                        ? 'active'
                        : status.toLowerCase().includes('terminated') ||
                            status.toLowerCase().includes('discharged')
                          ? 'terminated'
                          : status.toLowerCase().includes('lapsed') ||
                              status.toLowerCase().includes('expired')
                            ? 'lapsed'
                            : 'active',
                    filingType:
                      filingNumber.toLowerCase().includes('ucc3') ||
                      filingNumber.toLowerCase().includes('ucc-3') ||
                      filingNumber.toLowerCase().includes('amendment')
                        ? 'UCC-3'
                        : 'UCC-1'
                  })
                }
              } else if (element.classList.length > 0) {
                // Try div-based layout
                const filingNumber =
                  element
                    .querySelector('[class*="filing"], [class*="number"]')
                    ?.textContent?.trim() || ''
                const debtorName =
                  element
                    .querySelector('[class*="debtor"], [class*="name"]')
                    ?.textContent?.trim() || ''
                const securedParty =
                  element
                    .querySelector('[class*="secured"], [class*="party"], [class*="creditor"]')
                    ?.textContent?.trim() || ''
                const filingDate =
                  element.querySelector('[class*="date"], [class*="filed"]')?.textContent?.trim() ||
                  ''
                const status = element.querySelector('[class*="status"]')?.textContent?.trim() || ''

                if (filingNumber || debtorName) {
                  results.push({
                    filingNumber,
                    debtorName,
                    securedParty,
                    filingDate,
                    collateral: '',
                    status: status.toLowerCase().includes('active')
                      ? 'active'
                      : status.toLowerCase().includes('terminated')
                        ? 'terminated'
                        : status.toLowerCase().includes('lapsed')
                          ? 'lapsed'
                          : 'active',
                    filingType:
                      filingNumber.toLowerCase().includes('ucc3') ||
                      filingNumber.toLowerCase().includes('ucc-3')
                        ? 'UCC-3'
                        : 'UCC-1'
                  })
                }
              }
            } catch (err) {
              errors.push(
                `Error parsing element ${index}: ${err instanceof Error ? err.message : String(err)}`
              )
            }
          })

          return { filings: results, errors }
        })

        // Add filings and errors from this page
        allFilings.push(...rawFilings)
        allErrors.push(...parseErrors)

        this.log('info', `Page ${currentPage}: Found ${rawFilings.length} raw filings`, {
          companyName
        })

        // Check for pagination
        const pagination = await paginationHandler.detectPagination(page)

        this.log('info', `Pagination detected: ${pagination.paginationType}`, {
          companyName,
          currentPage: pagination.currentPage,
          totalPages: pagination.totalPages,
          hasNextPage: pagination.hasNextPage
        })

        // Check if we should continue to next page
        if (!paginationHandler.shouldContinue(currentPage, pagination)) {
          this.log('info', `Pagination complete at page ${currentPage}`, { companyName })
          break
        }

        // Navigate to next page
        const navigated = await paginationHandler.goToNextPage(page, pagination)

        if (!navigated) {
          this.log('info', 'Could not navigate to next page, stopping pagination', { companyName })
          break
        }

        currentPage++
      }

      // Validate all filings and collect errors
      const { validatedFilings, validationErrors } = this.validateFilings(allFilings, allErrors)

      if (validationErrors.length > 0) {
        this.log('warn', 'Some filings had parsing or validation errors', {
          companyName,
          errorCount: validationErrors.length,
          errors: validationErrors
        })
      }

      this.log('info', 'All filings scraped and validated', {
        companyName,
        totalPages: currentPage,
        rawCount: allFilings.length,
        validCount: validatedFilings.length,
        errorCount: validationErrors.length
      })

      return finalize({
        success: true,
        filings: validatedFilings,
        searchUrl: page.url(),
        timestamp: new Date().toISOString(),
        parsingErrors: validationErrors.length > 0 ? validationErrors : undefined
      })
    })
  }

  /**
   * Get manual search URL for California
   *
   * NOTE: California UCC search through bizfileonline.sos.ca.gov
   * Offers free searches with optional account for advanced features
   */
  getManualSearchUrl(companyName: string): string {
    // California may support URL parameters, try common patterns
    return `${this.config.baseUrl}?searchType=debtor&searchCriteria=${encodeURIComponent(companyName)}`
  }
}
