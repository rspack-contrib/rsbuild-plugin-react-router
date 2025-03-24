import { generateRobotsTxt } from '@nasa-gcn/remix-seo'
import { getDomainUrl } from 'remote/utils/misc'
import { type Route } from './+types/robots[.]txt.ts'

export function loader({ request }: Route.LoaderArgs) {
	return generateRobotsTxt([
		{ type: 'sitemap', value: `${getDomainUrl(request)}/sitemap.xml` },
	])
}
