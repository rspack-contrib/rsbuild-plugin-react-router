import { execa } from 'execa'

if (process.env.NODE_ENV === 'production') {
	await import('../server-build/index.js')
} else {
	await import('../index.js')
}
