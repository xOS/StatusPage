<template>
	<div class="grid grid-cols-12 max-w-6xl gap-4 px-2 md:mx-auto -mt-8">
		<div class="col-span-12">
			<n-alert
				v-if="uptime_error && !uptime_data"
				title="错误！"
				class="rounded-lg shadow"
				type="error"
			>
				{{ uptime_error?.message }}
			</n-alert>
			<n-alert
				v-if="statusNotice"
				:title="statusNotice.title"
				class="rounded-lg shadow"
				type="warning"
			>
				{{ statusNotice.message }}
			</n-alert>
			<n-alert
				v-if="showLoading"
				title="加载中..."
				class="rounded-lg shadow"
				type="info"
			>
				请稍后...
			</n-alert>
			<n-alert
				v-if="hasMonitors && allok"
				title="恭喜！"
				class="rounded-lg shadow"
				type="success"
			>
				当前服务器全部运行正常。
			</n-alert>
			<n-alert
				v-if="hasMonitors && !allok"
				title="注意"
				class="rounded-lg shadow"
				type="warning"
			>
				当前有服务器宕机，请注意！
			</n-alert>
		</div>
		<div class="col-span-12 flex flex-col gap-4 overflow-hidden">
			<div
				v-show="showLoading"
				class="border border-gray-200 rounded-lg bg-white px-6 shadow dark:border-gray-700 dark:bg-gray-800"
			>
				<n-spin class="min-h-40 w-full"> </n-spin>
			</div>

			<div v-for="(topItem, i) in monitors" :key="i" class="w-full">
				<div>{{ i }}</div>
				<div
					class="mt-2 border border-gray-200 rounded-lg bg-white px-6 shadow dark:border-gray-700 dark:bg-gray-800"
				>
					<div class="w-full divide-y divide-dashed">
						<ul v-for="(item, j) in topItem" :key="j" class="w-full">
							<StatusItem :data="item"></StatusItem>
						</ul>
					</div>
				</div>
			</div>
			<div
				v-if="showContent && !uptime_error && !statusNotice && !hasMonitors"
				class="border border-gray-200 rounded-lg bg-white p-6 text-center text-gray-500 shadow dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
			>
				暂无监控数据
			</div>
			<div class="mt-2 flex items-center justify-between">
				<div>
					<div class="text-base font-semibold">宕机日志</div>
					<div class="text-xs text-gray-500 dark:text-gray-400">最近 90 天异常记录</div>
				</div>
				<n-button
					v-if="sortedLogs.length > 5"
					text
					size="small"
					@click="showAllLogs = !showAllLogs"
				>
					{{ showAllLogs ? '收起' : '展开' }}
					<template #icon>
						<n-icon :class="showAllLogs ? 'i-material-symbols:keyboard-arrow-up' : 'i-material-symbols:keyboard-arrow-down'" />
					</template>
				</n-button>
			</div>
			<div
				class="border border-gray-200 rounded-lg bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800 transition-all duration-300"
				:style="logContainerStyle"
			>
				<n-spin v-show="showLoading" class="min-h-40 w-full"></n-spin>
				<n-timeline v-if="showContent">
					<n-timeline-item
						v-for="(item, key) in displayedLogs"
						:key="key"
						type="error"
						:title="item.name"
						:time="item.datetime"
					>
						<div class="flex flex-wrap gap-1">
							<n-tag type="error" size="small">
								{{ `${formatDuration(item.duration)} ` }}
								<template #icon>
									<n-icon class="i-material-symbols:alarm" />
								</template>
							</n-tag>
							<n-tag type="info" size="small">
								{{ `原因: ${item.reason.detail}` }}
								<template #icon>
									<n-icon class="i-material-symbols:chat-info" />
								</template>
							</n-tag>
						</div>
					</n-timeline-item>
				</n-timeline>
				<div v-if="showContent && sortedLogs.length === 0" class="text-center text-gray-500 py-8">
					暂无宕机记录
				</div>
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
const {
	loading: uptime_loading,
	data: uptime_data,
	error: uptime_error,
} = uptimeRequest('', 90)

const showLoading = ref(false)
let loadingTimer: ReturnType<typeof setTimeout> | undefined

watch(
	uptime_loading,
	(value) => {
		if (loadingTimer) {
			clearTimeout(loadingTimer)
			loadingTimer = undefined
		}

		if (value && !uptime_data.value) {
			loadingTimer = setTimeout(() => {
				showLoading.value = true
			}, 800)
			return
		}

		showLoading.value = false
	},
	{ immediate: true },
)

onBeforeUnmount(() => {
	if (loadingTimer) {
		clearTimeout(loadingTimer)
	}
})

// 控制宕机日志展开/折叠状态
const showAllLogs = ref(false)

const monitors = computed(() => uptime_data.value?.monitors || {})
const hasMonitors = computed(() => Object.keys(monitors.value).length > 0)
const showContent = computed(() => !uptime_loading.value || !!uptime_data.value)
const statusNotice = computed(() => {
	if (uptime_data.value?.meta?.warming) {
		return {
			title: '快照生成中',
			message: '后台正在生成完整状态快照，完成后页面会自动显示完整数据。',
		}
	}
	if (uptime_data.value?.meta?.partial) {
		return {
			title: '数据同步中',
			message: '当前数据不是完整快照，等待后台完整快照生成后会自动替换。',
		}
	}
	return undefined
})

const allok = computed(() => {
	let ok = true
	for (const key in monitors.value) {
		for (const item of monitors.value[key]) {
			if (item.status !== 'ok') {
				ok = false
			}
		}
	}
	return ok
})

const sortedLogs = computed(() => {
  if (!uptime_data.value?.logs) return []
  
  return [...uptime_data.value.logs].sort((a, b) => {
    return new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
  })
})

// 根据展开状态显示的日志条数
const displayedLogs = computed(() => {
  if (showAllLogs.value || sortedLogs.value.length <= 5) {
    return sortedLogs.value
  }
  return sortedLogs.value.slice(0, 5)
})

// 动态计算日志容器的样式
const logContainerStyle = computed(() => {
  if (showLoading.value) {
    return {
      minHeight: '160px'
    }
  }
  
  if (sortedLogs.value.length === 0) {
    return {
      minHeight: '120px'
    }
  }
  
  if (!showAllLogs.value && sortedLogs.value.length > 5) {
    // 折叠状态：基础高度 + (显示条数 * 每条大约高度)
    const baseHeight = 40 // 基础padding等
    const itemHeight = 80 // 每个timeline item大约高度
    const collapsedHeight = baseHeight + (displayedLogs.value.length * itemHeight)
    return {
      maxHeight: `${collapsedHeight}px`,
      overflow: 'hidden'
    }
  }
  
  // 展开状态：自适应高度
  return {
    maxHeight: 'none',
    overflow: 'visible'
  }
})
</script>
