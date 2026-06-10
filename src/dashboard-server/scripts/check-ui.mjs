// Post-build guard: the dashboard UI is one big template literal, so a stray `\n`
// or unescaped backslash cooks into broken inline JS that kills the whole page.
// Parse the emitted <script> block and fail the build if it has a syntax error.
import { getDashboardHtml } from '../dist/index.js'

const html = getDashboardHtml(0)
const match = html.match(/<script>([\s\S]*?)<\/script>/)
if (!match) {
	console.error('[check-ui] no <script> block found in dashboard HTML')
	process.exit(1)
}
try {
	new Function(match[1])
	console.log('[check-ui] dashboard inline JS parses OK')
} catch (err) {
	console.error(`[check-ui] dashboard inline JS has a syntax error: ${err.message}`)
	process.exit(1)
}
