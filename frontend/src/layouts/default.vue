<template>
	<div class="relative m-0 min-h-screen w-full flex flex-col p-0 bg-gray-50 dark:bg-gray-900">
		<Navigation />
		<div class="flex-grow">
			<router-view v-slot="{ Component }">
				<transition name="fade" mode="out-in">
					<component :is="Component" />
				</transition>
			</router-view>
		</div>
		<footer class="mt-8 border-t border-gray-200 bg-white/80 dark:border-gray-800 dark:bg-gray-950/80">
			<div class="mx-auto max-w-6xl px-4 py-6">
				<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<div class="text-sm font-semibold text-gray-900 dark:text-gray-100">服务状态</div>
						<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
							由 UptimeRobot 数据驱动，自动缓存并动态更新。
						</div>
					</div>
					<div class="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
						<n-a href="https://www.nange.cn" target="_blank">楠格</n-a>
						<span class="h-3 w-px bg-gray-300 dark:bg-gray-700"></span>
						<n-a href="https://github.com/xOS/StatusPage" target="_blank">GitHub</n-a>
						<span class="h-3 w-px bg-gray-300 dark:bg-gray-700"></span>
						<span>© {{ new Date().getFullYear() }}</span>
					</div>
				</div>
			</div>
		</footer>
	</div>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
	transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
</style>
