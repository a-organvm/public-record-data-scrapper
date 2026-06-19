# UCC Data Scraper - Terminal CLI Tool

A standalone terminal-based tool for scraping UCC filing data and enriching company information without a GUI. Designed for solo individual use and field data collection.

## Features

- **UCC Filing Scraper**: Extract UCC filings from state Secretary of State portals (CA, TX, FL)
- **Data Enrichment**: Enrich company data from multiple public sources (SEC, OSHA, USPTO, Census, SAM.gov)
- **Company Name Normalization**: Standardize company names for better matching
- **Batch Processing**: Process multiple companies from a CSV file
- **Multiple Export Formats**: Export data as JSON or CSV
- **Rate Limiting**: Built-in rate limiting to respect site policies
- **Anti-Detection**: Browser fingerprinting protection and CAPTCHA detection

## Installation

1. Clone the repository:
```bash
git clone https://github.com/ivi374forivi/public-record-data-scrapper.git
cd public-record-data-scrapper
```

2. Install dependencies:
```bash
npm install --legacy-peer-deps
```

3. Install Chromium for Puppeteer (if not already installed):
```bash
npx puppeteer browsers install chrome
```

## Usage

### Basic Commands

#### 1. List Available States
```bash
npm run scrape -- list-states
```

#### 2. Scrape UCC Filings
```bash
npm run scrape -- scrape-ucc -c "Acme Corporation" -s CA
```

Options:
- `-c, --company <name>`: Company name to search (required)
- `-s, --state <code>`: State code - CA, TX, or FL (required)
- `-o, --output <file>`: Output file path (default: ./output.json)
- `--csv`: Export as CSV instead of JSON

Example with CSV output:
```bash
npm run scrape -- scrape-ucc -c "Example LLC" -s TX -o results.csv --csv
```

#### 3. Enrich Company Data
Fetch additional data from public sources (SEC, OSHA, USPTO, etc.):

```bash
npm run scrape -- enrich -c "Acme Corporation" -s CA
```

Options:
- `-c, --company <name>`: Company name (required)
- `-s, --state <code>`: State code (required)
- `-o, --output <file>`: Output file path (default: ./enriched-data.json)
- `--tier <level>`: Subscription tier - free, starter, professional (default: free)
- `--csv`: Export as CSV instead of JSON

Example:
```bash
npm run scrape -- enrich -c "Example LLC" -s TX -o enriched.json --tier free
```

#### 4. Normalize Company Name
Standardize company names for better matching:

```bash
npm run scrape -- normalize -n "acme corporation, llc"
```

Output:
```
Original:  acme corporation, llc
Normalized: Acme Corporation
```

#### 5. Batch Processing
Process multiple companies from a CSV file:

```bash
npm run scrape -- batch -i companies.csv -o ./results
```

Input CSV format:
```csv
company,state
Acme Corporation,CA
Example LLC,TX
Test Company,FL
```

Options:
- `-i, --input <file>`: Input CSV file with company,state columns (required)
- `-o, --output <dir>`: Output directory (default: ./batch-results)
- `--enrich`: Also enrich data for each company

The tool will:
- Process each company sequentially
- Apply rate limiting between requests (15 seconds)
- Save individual results for each company
- Generate a summary.json file

#### 6. Export Scored MCA Leads
Export the sellable lead batch from the database as JSON and CSV:

```bash
npm run scrape -- lead-export --min-score 70 --limit 100 --output-dir ./lead-export
```

Options:
- `-o, --output-dir <dir>`: Output directory (default: `./lead-export`)
- `--format <format>`: `json`, `csv`, or `both` (default: `both`)
- `--min-score <score>`: Minimum MCA score (default: `70`)
- `--max-score <score>`: Optional maximum MCA score
- `--state <code>`: Filter by state
- `--industry <name>`: Filter by industry
- `--status <status>`: Filter by prospect status
- `--limit <count>`: Batch size (default: `100`, max: `1000`)
- `--offset <count>`: Offset for pagination

See [MCA Lead Export](./LEAD_EXPORT.md) for API usage and sample files.

## Data Sources

### Free Tier (No API Key Required)
- **SEC EDGAR**: Company filings and financial data
- **OSHA**: Workplace safety violations and penalties
- **USPTO**: Trademark registrations
- **Census Bureau**: Business patterns and statistics
- **SAM.gov**: Federal contract awards

### Paid Tiers (Require API Keys)
- **Starter**: D&B, Google Places, Clearbit
- **Professional**: Experian, ZoomInfo, NewsAPI

## Output Examples

### UCC Filing Output (JSON)
```json
{
  "state": "CA",
  "companyName": "Acme Corporation",
  "filingCount": 2,
  "filings": [
    {
      "filingNumber": "UCC-123456",
      "debtorName": "Acme Corporation",
      "securedParty": "Bank of America",
      "filingDate": "2024-01-15",
      "status": "active",
      "collateral": "All assets",
      "filingType": "UCC-1"
    }
  ],
  "searchUrl": "https://..."
}
```

### Enriched Data Output (JSON)
```json
{
  "companyName": "Acme Corporation",
  "state": "CA",
  "sources": ["sec-edgar", "osha", "uspto", "sam-gov"],
  "cost": 0,
  "enrichedData": {
    "sec": {
      "cik": "0001234567",
      "sicCode": "5812"
    },
    "osha": {
      "violations": 2,
      "totalPenalties": 5000
    },
    "uspto": {
      "trademarkCount": 3
    },
    "samGov": {
      "isRegistered": true,
      "contractCount": 5
    }
  }
}
```

## Rate Limiting

The scraper respects site policies with built-in rate limiting:
- **5 requests per minute** per state
- **12-15 second delay** between requests
- Automatic retry with exponential backoff on failures

## Anti-Detection Features

- Realistic user agent strings
- Browser fingerprinting protection
- CAPTCHA detection and fallback to manual URLs
- Randomized delays between requests
- Headless browser with stealth plugins

## Troubleshooting

### CAPTCHA Detected
If you encounter CAPTCHA, the tool will:
1. Return an error message
2. Provide a manual search URL
3. You can complete the search manually in a browser

### No Results Found
The scrapers use CSS selectors that may need adjustment based on website updates. Check the manual search URL to verify the site structure.

### Installation Issues
If Puppeteer fails to install:
```bash
# Install Chromium manually
npx puppeteer browsers install chrome

# Or use system Chrome
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

## Package as Shareable Script

To create a standalone executable:

```bash
# Build the script
npm run build

# Create a distributable package
npm pack
```

This creates a `.tgz` file that can be shared with field data experts.

To use the package:
```bash
npm install -g ucc-mca-intelligence-platform-1.0.0.tgz
ucc-scraper --help
```

## Examples

### Example 1: Quick Single Company Lookup
```bash
npm run scrape -- scrape-ucc -c "Restaurant Holdings LLC" -s CA -o restaurant.json
```

### Example 2: Enrich and Export to CSV
```bash
npm run scrape -- enrich -c "Tech Startup Inc" -s TX --csv -o startup-data.csv
```

### Example 3: Batch Process Multiple Companies
Create `companies.csv`:
```csv
company,state
Restaurant A,CA
Restaurant B,TX
Restaurant C,FL
```

Run batch:
```bash
npm run scrape -- batch -i companies.csv -o ./batch-output
```

### Example 4: Full Pipeline
```bash
# 1. Scrape UCC filings
npm run scrape -- scrape-ucc -c "Company Name" -s CA -o ucc.json

# 2. Enrich with public data
npm run scrape -- enrich -c "Company Name" -s CA -o enriched.json

# 3. Normalize name for matching
npm run scrape -- normalize -n "Company Name, LLC"
```

## Notes

- **Legal Compliance**: Ensure you comply with the terms of service of each data source
- **Rate Limits**: The tool includes conservative rate limiting, but you may need to adjust for your use case
- **Data Accuracy**: Always verify critical data from primary sources
- **State Support**: Currently supports CA, TX, FL - more states can be added

## Support

For issues or questions:
- Check the main README.md
- Review the ENRICHMENT_PIPELINE.md documentation
- See API_SPEC.md for technical details

## License

MIT License - See LICENSE file for details
