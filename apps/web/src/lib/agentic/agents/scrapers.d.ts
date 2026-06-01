declare module '../../../../scripts/scrapers/states/california' {
  const CaliforniaScraper: unknown
  export { CaliforniaScraper }
}
declare module '../../../../scripts/scrapers/states/texas' {
  const TexasScraper: unknown
  export { TexasScraper }
}
declare module '../../../../scripts/scrapers/states/florida' {
  const FloridaScraper: unknown
  export { FloridaScraper }
}
declare module '../../../../scripts/scrapers/states/newyork' {
  const NewYorkScraper: unknown
  export { NewYorkScraper }
}
declare module '../../../../scripts/scrapers/base-scraper' {
  interface BaseScraper {
    scrape: unknown
    isStateSupported: unknown
  }
  export { BaseScraper }
}
