import { lookupCompany } from './src/agents/companyLookup.js'
const t0 = Date.now()
const r = await lookupCompany('Future Media GmbH', 'https://www.future-media.ch/')
console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(JSON.stringify(r, null, 2))
