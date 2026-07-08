import { useRequest } from 'vue-request'
import type { Dayjs } from 'dayjs'

const STATUS_CACHE_KEY = 'status-page:data:v1'
export interface _Result {
	id: number
	name: string
	url: string
	average: string
	daily: Array<{
		date: string | Dayjs
		uptime: string
		down: {
			times: number
			duration: number
		}
	}>
	response_times: Array<{
		datetime: number
		value: number
	}>
	total: {
		times: number
		duration: number
	}
	status: string
	opts: { [key: string]: string }
}
export interface _Resp {
	monitors: { [key: string]: _Result[] }
	logs: Array<{
		name: string
		datetime: string
		duration: number
		reason: {
			code: string
			detail: string
		}
	}>
}
export const uptimeRequest = (apikey: string, days: number) => {
	const cacheKey = statusCacheKey(days)
	const cachedData = ref<_Resp | undefined>(readCachedStatus(cacheKey))
	const {
		data: rawData,
		loading,
		error,
	} = useRequest<_Resp>(() => http.get('/api/status', { params: { days } }))
	watch(rawData, (value) => {
		if (!value) return

		cachedData.value = value
		writeCachedStatus(cacheKey, value)
	})
	const data = computed(() => {
		const source = rawData.value || cachedData.value
		if (!source) return source

		return {
			...source,
			monitors: Object.fromEntries(
				Object.entries(source.monitors || {}).map(([group, monitors]) => [
					group,
					monitors.map((monitor) => ({
						...monitor,
						daily: monitor.daily.map((item) => ({
							...item,
							date: dayjs(item.date),
						})),
					})),
				]),
			),
		}
	})
	return { data, loading, error }
}

function statusCacheKey(days: number) {
	return `${STATUS_CACHE_KEY}:${days}`
}

function readCachedStatus(cacheKey: string): _Resp | undefined {
	if (typeof window === 'undefined') return undefined

	try {
		const raw = window.localStorage.getItem(cacheKey)
		if (!raw) return undefined

		const parsed = JSON.parse(raw)
		if (!parsed || !parsed.data || !parsed.savedAt) return undefined

		return parsed.data
	} catch {
		return undefined
	}
}

function writeCachedStatus(cacheKey: string, data: _Resp) {
	if (typeof window === 'undefined') return

	try {
		window.localStorage.setItem(
			cacheKey,
			JSON.stringify({
				savedAt: Date.now(),
				data,
			}),
		)
	} catch {
		// localStorage can be unavailable or full; network/cache layers still work.
	}
}
