import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { Browser, Page } from 'puppeteer'

import { BaseScraper, ScraperConfig, ScraperResult } from './base-scraper'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 }

const DEFAULT_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--window-size=1920x1080'
]

interface PuppeteerScraperOptions {
  headless?: boolean
  keepPageOpenOnFailure?: boolean
}

export abstract class BasePuppeteerScraper extends BaseScraper {
  protected browser: Browser | null = null
  protected lastPage: Page | null = null
  private readonly headless: boolean
  private readonly keepPageOpenOnFailure: boolean

  protected constructor(config: ScraperConfig, options: PuppeteerScraperOptions = {}) {
    super(config)
    this.headless = options.headless ?? true
    this.keepPageOpenOnFailure = options.keepPageOpenOnFailure ?? false
  }

  protected async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: this.headless,
        args: DEFAULT_LAUNCH_ARGS
      })
    }
    return this.browser
  }

  protected async initializePage(page: Page): Promise<void> {
    await page.setUserAgent(DEFAULT_USER_AGENT)
    await page.setViewport(DEFAULT_VIEWPORT)
  }

  protected async withSearchPage<TResult extends ScraperResult>(
    execute: (page: Page, finalize: (result: TResult) => TResult) => Promise<TResult>
  ): Promise<TResult> {
    let page: Page | null = null
    const outcome: { result: TResult | null } = { result: null }
    const finalize = (next: TResult): TResult => {
      outcome.result = next
      return next
    }

    try {
      const browser = await this.getBrowser()
      page = await browser.newPage()
      this.lastPage = page
      return await execute(page, finalize)
    } finally {
      if (page) {
        const keepPageOpen =
          this.keepPageOpenOnFailure && outcome.result !== null && !outcome.result.success
        if (!keepPageOpen) {
          await page.close().catch((error) => {
            this.log('warn', 'Error closing page', {
              error: error instanceof Error ? error.message : String(error)
            })
          })
        }
      }
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.lastPage = null
      this.onBrowserClosed()
    }
  }

  protected onBrowserClosed(): void {
    // optional override hook
  }

  async captureDiagnostics(
    outputDir: string,
    baseName: string
  ): Promise<{ screenshotPath?: string; htmlPath?: string }> {
    if (!this.lastPage || this.lastPage.isClosed()) {
      return {}
    }

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    const screenshotPath = join(outputDir, `${baseName}.png`)
    const htmlPath = join(outputDir, `${baseName}.html`)
    let savedScreenshot = false
    let savedHtml = false

    try {
      await this.lastPage.screenshot({ path: screenshotPath, fullPage: true })
      savedScreenshot = true
    } catch (error) {
      this.log('warn', 'Failed to capture screenshot', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    try {
      const html = await this.lastPage.content()
      writeFileSync(htmlPath, html)
      savedHtml = true
    } catch (error) {
      this.log('warn', 'Failed to capture HTML snapshot', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return {
      screenshotPath: savedScreenshot ? screenshotPath : undefined,
      htmlPath: savedHtml ? htmlPath : undefined
    }
  }
}
