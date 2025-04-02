import 'dotenv/config'
import * as fs from 'node:fs'
import sourceMapSupport from 'source-map-support'

sourceMapSupport.install({
	retrieveSourceMap: function (source) {
		// get source file without the `file://` prefix or `?t=...` suffix
		const match = source.match(/^file:\/\/(.*)\?t=[.\d]+$/)
		if (match) {
			return {
				url: source,
				map: fs.readFileSync(`${match[1]}.map`, 'utf8'),
			}
		}
		return null
	},
})

if (process.env.MOCKS === 'true') {
	await import('./tests/mocks/index.ts')
}

if (process.env.NODE_ENV === 'production') {
	let build = await import('./build/server/static/js/app.js')
	build = build?.default || build
	build = build?.createApp || build
	build()
} else {
	await import('./server/dev-build.js')
}
