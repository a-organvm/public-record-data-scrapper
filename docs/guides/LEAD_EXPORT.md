# MCA Lead Export

Lead export is the first sellable output of the UCC-MCA pipeline: a bounded batch of scored
prospects that can be delivered as JSON for systems or CSV for sales operators.

## CLI

Export both JSON and CSV files:

```bash
npm run scrape -- lead-export --min-score 70 --limit 100 --output-dir ./lead-export
```

Useful filters:

```bash
npm run scrape -- lead-export --state CA --industry restaurant --min-score 75
npm run scrape -- lead-export --status new --limit 500 --offset 500
npm run scrape -- lead-export --format csv --output-dir ./lead-export
```

The CLI writes timestamped files:

```text
lead-export/lead-export-2026-06-19T14-30-00-000Z.json
lead-export/lead-export-2026-06-19T14-30-00-000Z.csv
```

## API

JSON batch:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/prospects/export/leads?min_score=70&limit=100"
```

CSV batch:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/prospects/export/leads?format=csv&state=CA" \
  -o mca-leads.csv
```

Supported query parameters:

| Parameter | Default | Notes |
| --- | --- | --- |
| `format` | `json` | `json` or `csv` |
| `min_score` | `70` | Lower bound for `prospects.priority_score` |
| `max_score` | none | Optional upper bound |
| `state` | none | Two-letter state code |
| `industry` | none | Prospect industry value |
| `status` | none | Prospect status filter |
| `limit` | `100` | Batch size, capped at 1000 |
| `offset` | `0` | Zero-based pagination offset |

## Output Contract

Each JSON response has `batch` metadata and a `leads` array. CSV uses the same lead fields as
stable column headers.

Key lead fields:

| Field | Meaning |
| --- | --- |
| `prospect_id` | Internal prospect identifier |
| `company_name`, `state`, `industry`, `status` | Sales-facing prospect context |
| `mca_score` | Persisted MCA priority score, 0-100 |
| `score_grade` | A-F grade derived from `mca_score` |
| `recommendation` | `high_priority`, `moderate_priority`, `low_priority`, or `pass` |
| `score_confidence` | Export confidence from enrichment confidence or available UCC context |
| `ucc_filing_count`, `active_ucc_count`, `terminated_ucc_count`, `lapsed_ucc_count` | UCC stack context |
| `secured_parties` | Distinct secured parties joined with `; ` in CSV |
| `narrative` | Existing scoring narrative for outreach review |

Sample files:

- [lead-export-sample.json](../../examples/lead-export-sample.json)
- [lead-export-sample.csv](../../examples/lead-export-sample.csv)
