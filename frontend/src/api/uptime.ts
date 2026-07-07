import { useRequest } from 'vue-request'
export interface _Result {
	id: number
	name: string
	url: string
	average: string
	daily: Array<{
		date: string
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
	const {
		data: rawData,
		loading,
		error,
	} = useRequest<_Resp>(() => http.get('/api/status', { params: { days } }))
	const data = computed(() => {
		if (!rawData.value) return rawData.value

		return {
			...rawData.value,
			monitors: Object.fromEntries(
				Object.entries(rawData.value.monitors || {}).map(([group, monitors]) => [
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
