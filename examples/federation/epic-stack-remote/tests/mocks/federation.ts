import { HttpResponse, http, type HttpHandler, bypass } from 'msw'

const { text } = HttpResponse

export const handlers: Array<HttpHandler> = [
	http.get('*.js', async (req) => {
		const f = await (await fetch(bypass(req.request.url))).text()
		return text(f)
	}),
	http.get('*.json', async (req) => {
		const f = await (await fetch(bypass(req.request.url))).text()
		return text(f)
	}),
	http.get('*.zip', async (req) => {
		const response = await fetch(bypass(req.request.url))
		const buffer = await response.arrayBuffer()
		return new Response(buffer, {
			status: response.status,
			headers: response.headers
		})
	}),
]
