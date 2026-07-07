<template>
	<div class="grid grid-cols-12 max-w-6xl gap-4 px-2 md:mx-auto -mt-8">
		<div class="col-span-12">
			<n-alert
				v-if="uptime_error"
				title="错误！"
				class="rounded-lg shadow"
				type="error"
			>
				{{ uptime_error?.message }}
			</n-alert>
			<n-alert
				v-if="uptime_loading"
				title="加载中..."
				class="rounded-lg shadow"
				type="info"
			>
				请稍后...
			</n-alert>
			<n-alert
				v-if="uptime_data?.monitors && allok"
				title="恭喜！"
				class="rounded-lg shadow"
				type="success"
			>
				当前服务器全部运行正常。
			</n-alert>
			<n-alert
				v-if="uptime_data && !allok"
				title="注意"
				class="rounded-lg shadow"
				type="warning"
			>
				当前有服务器宕机，请注意！
			</n-alert>
		</div>
		<div class="col-span-12 flex flex-col gap-4 overflow-hidden">
			<div
				v-show="uptime_loading"
				class="border border-gray-200 rounded-lg bg-white px-6 shadow dark:border-gray-700 dark:bg-gray-800"
			>
				<n-spin class="min-h-40 w-full"> </n-spin>
			</div>

			<div v-for="(topItem, i) in uptime_data.monitors" :key="i" class="w-full">
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
				<n-spin v-show="uptime_loading" class="min-h-40 w-full"></n-spin>
				<n-timeline v-if="!uptime_loading">
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
				<div v-if="!uptime_loading && sortedLogs.length === 0" class="text-center text-gray-500 py-8">
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

// 控制宕机日志展开/折叠状态
const showAllLogs = ref(false)

const allok = computed(() => {
	let ok = true
	for (const key in uptime_data.value?.monitors) {
		// eslint-disable-next-line no-unsafe-optional-chaining
		for (const item of uptime_data.value?.monitors[key]) {
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
  if (uptime_loading.value) {
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
