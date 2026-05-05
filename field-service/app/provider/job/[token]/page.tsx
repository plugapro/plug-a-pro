// Alias of /provider/handoff/[token] — kept so existing WhatsApp / SMS deep
// links of the form /provider/job/<token> continue to land on the same page.
// Next.js 16 disallows re-exporting `dynamic` from another module, so we
// declare the segment config locally and forward the default export.
export const dynamic = 'force-dynamic'
export { default } from '../../handoff/[token]/page'
