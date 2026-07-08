<template>
	<li class="flex items-center py-5 space-x-2">
		<div class="flex grow-1 flex-col overflow-x-hidden space-y-0.5">
			<div class="flex justify-between">
				<div class="flex items-center gap-1">
					<i
						v-if="data.opts['国家']"
						class="flex-shrink-1"
						:class="'fi fi-' + data.opts['国家']"
					></i>
					<div class="text-[0.8rem]">
						{{ data?.name }}
					</div>
				</div>

				<n-tag
					round
					class="bg-transparent"
					:bordered="false"
					:type="data?.status !== 'ok' ? 'error' : 'success'"
					size="small"
				>
					<template #icon>
						<n-icon
							:class="
								data?.status !== 'ok'
									? 'i-material-symbols:error'
									: 'i-clarity:success-standard-solid'
							"
						/>
					</template>
					{{ status[data?.status] }}
				</n-tag>
			</div>
			<div ref="chartRoot" class="h-20">
				<v-chart
					v-if="chartVisible"
					class="h-20"
					:option="chartOpt"
					autoresize
				></v-chart>
			</div>
			<div class="w-full flex space-x-0.2 md:space-x-0.5">
				<n-tooltip
					v-for="(item, index) in daily"
					:key="index"
				>
					<template #trigger>
						<i
							class="h-5 flex-grow-1 rounded-none hover:scale-y-110"
							:class="
								parseFloat(item.uptime) >= 100
									? 'bg-green-400 hover:bg-green-500'
									: item.down.times <= 0
										? 'bg-gray-400 hover:bg-gray-500'
										: parseFloat(item.uptime) <= 50
											? 'bg-red-400 hover:bg-red-500'
											: 'bg-yellow-400 hover:bg-yellow-500'
							"
						></i>
					</template>
					{{ formatDay(item.date) }}
				</n-tooltip>
			</div>
			<div class="flex justify-between text-[0.6rem] text-gray-400 font-thin">
				<div>
					{{
						rtl
							? lastDayLabel
							: '今日'
					}}
				</div>
				<div>
					{{
						data?.total?.times
							? `最近 ${dailyDays} 天故障 ${data?.total?.times} 次，累计 ${formatDuration(data?.total?.duration)}，平均可用率 ${data?.average}%`
							: `最近 ${dailyDays} 天可用率 ${data?.average}%`
					}}
				</div>
				<div>
					{{
						rtl
							? '今日'
							: lastDayLabel
					}}
				</div>
			</div>
			<div class="mt-0 flex flex-wrap gap-0.5">
				<n-tag
					v-for="(v, i) in data?.opts['标签']?.split(',')"
					:key="i"
					:type="v.split('|')[0] as any"
					class="m-0"
					size="small"
					round
				>
					{{ v.split('|')[1] }}
				</n-tag>
			</div>
		</div>
	</li>
</template>
<script setup lang="ts">
import VChart, { THEME_KEY } from 'vue-echarts'
import { use } from 'echarts/core'
import type { EChartsOption } from 'echarts'
import type { Dayjs } from 'dayjs'
import { LineChart } from 'echarts/charts'
import { isDark } from 'vue-dark-switch'
import type { _Result } from '../api/uptime'
import { SVGRenderer } from 'echarts/renderers'
import {
	GridComponent,
	TooltipComponent,
	VisualMapComponent,
} from 'echarts/components'
interface Props {
	data: _Result
	rtl?: boolean
}
use([
	LineChart,
	SVGRenderer,
	GridComponent,
	TooltipComponent,
	VisualMapComponent,
])
const props = defineProps<Props>()
const status: { [key: string]: string } = {
	ok: '正常',
	down: '无法访问',
	unknow: '未知',
}
const chartRoot = ref<HTMLElement | null>(null)
const chartVisible = ref(false)
let chartObserver: IntersectionObserver | undefined

onMounted(() => {
	if (!('IntersectionObserver' in window)) {
		chartVisible.value = true
		return
	}

	chartObserver = new IntersectionObserver(
		(entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				chartVisible.value = true
				chartObserver?.disconnect()
				chartObserver = undefined
			}
		},
		{ rootMargin: '240px 0px' },
	)

	if (chartRoot.value) {
		chartObserver.observe(chartRoot.value)
	}
})

onBeforeUnmount(() => {
	chartObserver?.disconnect()
})

const daily = computed(() => {
	if (!props.rtl) {
		return props.data.daily
	} else {
		return [...props.data.daily].reverse()
	}
})
const dailyDays = computed(() => props.data.daily.length)
const lastDayLabel = computed(() => {
	const item = props.data.daily[props.data.daily.length - 1]
	return item ? formatDay(item.date) : ''
})
function formatDay(value: string | Dayjs) {
	return typeof value === 'string' ? value : value.format('YYYY-MM-DD')
}
provide(
	THEME_KEY,
	computed(() => (isDark.value ? 'dark' : '')),
)
const chartOpt = computed<EChartsOption>(() => {
	let xAxis = Array.from(props.data.response_times, (v) => {
		return dayjs.unix(v.datetime).format('MM-DD HH:mm')
	})
	let sData = Array.from(props.data.response_times, (v) => {
		return v.value
	})
	return {
		backgroundColor: 'transparent',
		xAxis: {
			type: 'category',
			data: props.rtl ? [...xAxis].reverse() : xAxis,

			axisLabel: {
				fontSize: 8,
			},
		},
		yAxis: {
			type: 'value',
			splitNumber: 3,
			axisLabel: {
				fontSize: 8,
			},
		},
		grid: {
			left: '0%',
			right: '0%',
			bottom: '0%',
			top: '10%',
			containLabel: true,
		},
		tooltip: {
			axisPointer: {
				type: 'cross',
			},
			showContent: false,
		},
		series: [
			{
				data: props.rtl ? [...sData].reverse() : sData,
				smooth: true,
				name: 'timeout',
				type: 'line',
				symbol: 'none',
			},
		],
		visualMap: {
			show: false,
			pieces: [
				{
					gt: 0,
					lte: 50,
					color: 'rgb(74, 222, 128)',
				},
				{
					gt: 50,
					lte: 100,
					color: 'rgb(74, 222, 128)',
				},
				{
					gt: 100,
					lte: 150,
					color: 'rgb(100, 222, 128)',
				},
				{
					gt: 150,
					lte: 200,
					color: 'rgb(74, 222, 128)',
				},
				{
					gt: 200,
					lte: 300,
					color: 'rgb(255, 204, 51)',
				},
				{
					gt: 300,
					color: 'rgb(255, 0, 0)',
				},
			],
			outOfRange: {
				color: '#999',
			},
		},
	}
})
</script>
