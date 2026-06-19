#!/usr/bin/env tsx
/**
 * Scheduled Run Script
 *
 * Runs the scraper for a predefined list of companies and states, scores leads,
 * and outputs timestamped batches to an output directory.
 *
 * Usage:
 *   npm run scrape:scheduled
 *   npm run scrape:scheduled -- --dry-run
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import chalk from 'chalk'
import {
  createScraper,
  ScraperFactory,
  ScraperImplementation,
  SupportedState
} from './scrapers/scraper-factory'

const DRY_RUN = process.argv.includes('--dry-run')
const OUTPUT_DIR = path.join(process.cwd(), 'output')
const BATCH_FILE_PREFIX = 'scored-leads-batch'

const COMPANIES_BY_STATE: Record<
  SupportedState,
  Array<{
    name: string
    industry: string
    estimatedRevenue: number
  }>
> = {
  CA: [
    { name: 'Golden State Restaurant Group', industry: 'restaurant', estimatedRevenue: 2500000 },
    { name: 'Bay Area Retail Co', industry: 'retail', estimatedRevenue: 1800000 }
  ],
  TX: [
    { name: 'Lone Star Steakhouse Inc', industry: 'restaurant', estimatedRevenue: 3200000 },
    { name: 'Houston Construction Partners', industry: 'construction', estimatedRevenue: 4500000 }
  ],
  FL: [
    { name: 'Sunshine Medical Clinic', industry: 'healthcare', estimatedRevenue: 2800000 },
    { name: 'Miami Beach Retail LLC', industry: 'retail', estimatedRevenue: 1500000 }
  ],
  NY: [
    { name: 'Manhattan Tech Services', industry: 'technology', estimatedRevenue: 3500000 },
    { name: 'Brooklyn Restaurant Group', industry: 'restaurant', estimatedRevenue: 2200000 }
  ],
  IL: [
    { name: 'Chicago Construction Co', industry: 'construction', estimatedRevenue: 5000000 },
    { name: 'Windy City Services LLC', industry: 'services', estimatedRevenue: 1900000 }
  ]
}

const ALL_STATES: SupportedState[] = ['CA', 'TX', 'FL', 'NY', 'IL']

interface ScoredLead {
  companyName: string
  state: string
  industry: string
  estimatedRevenue: number
  priorityScore: number
  timeSinceDefault: number
  filingCount: number
  detectedDate: string
}

async function ensureOutputDir() {
  if (DRY_RUN) return
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true })
  } catch (error) {
    console.error(chalk.red('Failed to create output directory:'), error)
    process.exit(1)
  }
}

async function getExistingBatch(dateStr: string): Promise<ScoredLead[]> {
  if (DRY_RUN) return []
  const filePath = path.join(OUTPUT_DIR, `${BATCH_FILE_PREFIX}-${dateStr}.json`)
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return [] // Return empty array if file does not exist or cannot be read
  }
}

async function saveBatch(dateStr: string, leads: ScoredLead[]) {
  if (DRY_RUN) {
    console.log(chalk.yellow('\n[DRY RUN] Would save the following leads:'))
    console.log(chalk.gray(JSON.stringify(leads, null, 2)))
    return
  }
  const filePath = path.join(OUTPUT_DIR, `${BATCH_FILE_PREFIX}-${dateStr}.json`)
  await fs.writeFile(filePath, JSON.stringify(leads, null, 2), 'utf-8')
  console.log(chalk.green(`\n✅ Saved batch to ${filePath}`))
}

async function main() {
  console.log(chalk.bold.blue('\n🤖 Scheduled UCC Scraper\n'))
  if (DRY_RUN) {
    console.log(chalk.bgYellow.black(' DRY RUN MODE ENABLED \n'))
  }

  const implementation =
    (process.env.SCRAPER_IMPLEMENTATION as ScraperImplementation) ||
    ScraperFactory.getRecommendedImplementation()

  const availability = ScraperFactory.isImplementationAvailable(implementation)
  if (!availability.available) {
    console.log(chalk.red(`\n❌ ${implementation.toUpperCase()} implementation not available:`))
    console.log(chalk.yellow(`   ${availability.reason}\n`))
    process.exit(1)
  }

  await ensureOutputDir()
  
  const todayDateStr = new Date().toISOString().split('T')[0]
  const existingLeads = await getExistingBatch(todayDateStr)
  const existingLeadKeys = new Set(existingLeads.map((l) => `${l.state}-${l.companyName}`))
  const newLeads: ScoredLead[] = []

  for (const state of ALL_STATES) {
    console.log(chalk.bold(`\n📍 ${state} - Starting collection...`))
    const scraper = createScraper(state, { implementation })
    const companies = COMPANIES_BY_STATE[state] || []

    for (const company of companies) {
      const key = `${state}-${company.name}`
      if (existingLeadKeys.has(key)) {
        console.log(chalk.yellow(`   ⏭️  Skipping: ${company.name} (Already processed today)`))
        continue
      }

      console.log(chalk.cyan(`   🔎 Searching: ${company.name}`))
      try {
        const result = await scraper.search(company.name)
        if (!result.success) {
          console.log(chalk.yellow(`   ⚠️  Search failed: ${result.error}`))
          continue
        }

        const filings = result.filings || []
        if (filings.length === 0) {
          console.log(chalk.gray('   ℹ️  No filings found'))
          continue
        }

        const mostRecentFiling = filings[0]
        const filingDate = new Date(mostRecentFiling.filingDate)
        const timeSinceDefault = Math.floor(
          (Date.now() - filingDate.getTime()) / (1000 * 60 * 60 * 24)
        )
        const priorityScore = Math.min(100, Math.floor(timeSinceDefault / 14 + 50))

        console.log(chalk.green(`   ✅ Found ${filings.length} filing(s). Score: ${priorityScore}`))

        newLeads.push({
          companyName: company.name,
          state,
          industry: company.industry,
          estimatedRevenue: company.estimatedRevenue,
          priorityScore,
          timeSinceDefault,
          filingCount: filings.length,
          detectedDate: new Date().toISOString()
        })
      } catch (error) {
        console.error(chalk.red(`   ❌ Error searching ${company.name}:`), error)
      }
    }

    if (implementation === 'puppeteer') {
      const maybeClose = (scraper as Partial<{ close: () => Promise<void> | void }>).close
      if (typeof maybeClose === 'function') {
        await maybeClose()
      }
    }
  }

  console.log(chalk.bold.blue('\n📊 Summary\n'))
  console.log(chalk.cyan(`   Previously Existing Leads: ${existingLeads.length}`))
  console.log(chalk.green(`   New Leads Processed: ${newLeads.length}`))
  console.log(chalk.cyan(`   Total Leads Today: ${existingLeads.length + newLeads.length}`))

  if (newLeads.length > 0 || existingLeads.length > 0) {
    const allLeads = [...existingLeads, ...newLeads]
    await saveBatch(todayDateStr, allLeads)
  } else {
    console.log(chalk.gray('\nNo leads to save.'))
  }
}

main().catch((error) => {
  console.error(chalk.red('Unhandled error in scheduled run:'), error)
  process.exit(1)
})
