import { router } from './router'

useTitle(
	() => {
		const { path, meta } = router.currentRoute.value
		if (meta.title) {
			return `${meta.title}`
		}
		if (path === '/') {
			return ''
		}
		return path.replaceAll('/', '')
	},
	{
		titleTemplate: `服务状态`,
	},
)
