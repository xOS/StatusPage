<script setup lang="ts">
import { SwitchIcon } from 'vue-dark-switch'

import type { SiteInfo } from '@/api/info'

const props = defineProps<{
	siteInfo: SiteInfo
}>()
const siteInfo = computed(() => props.siteInfo)
const $route = useRoute()
const isHomeExternal = computed(() => /^https?:\/\//.test(siteInfo.value.home.href))
const isHomeActive = computed(() => $route.path === siteInfo.value.home.href)
</script>

<template>
	<nav
		aria-label="Site Nav"
		class="flex items-center justify-center bg-black p-4 pb-15 text-light-50"
	>
		<div class="max-w-6xl w-full flex justify-between px-2">
			<div class="flex items-center justify-center space-x-5">
				<SwitchIcon unmount-persets class="text-light-50" />
				<div class="text-md font-bold font-sans">
					{{ siteInfo.title }}
				</div>
			</div>
			<ul class="flex items-center gap-2 text-sm font-medium">
				<li>
					<a
						v-if="isHomeExternal"
						class="rounded-lg px-3 py-2 hover:text-gray-200"
						:href="siteInfo.home.href"
						target="_blank"
						rel="noopener noreferrer"
					>
						{{ siteInfo.home.label }}
					</a>
					<RouterLink
						v-else
						class="rounded-lg px-3 py-2 hover:text-gray-200"
						:class="isHomeActive ? 'text-gray-100' : ''"
						:to="siteInfo.home.href"
					>
						{{ siteInfo.home.label }}
					</RouterLink>
				</li>
				<li>
					<a
						class="i-mdi:github block cursor-pointer text-2xl hover:text-gray-1"
						:href="siteInfo.github.href"
						target="_blank"
						rel="noopener noreferrer"
						aria-label="GitHub"
					></a>
				</li>
			</ul>
		</div>
	</nav>
</template>
