import { computed } from 'vue'
import { useRequest } from 'vue-request'

import { http } from '@/composables/http'

export interface SiteInfo {
	title: string
	avatar: string
	rtl: boolean
	home: {
		label: string
		href: string
	}
	github: {
		href: string
	}
	footer: {
		title: string
		description: string
		owner: string
		ownerUrl: string
		projectUrl: string
	}
}

interface SiteInfoResponse {
	name?: string
	avatar?: string
	desc?: string
	rtl?: boolean
	site?: Partial<SiteInfo> & {
		home?: Partial<SiteInfo['home']>
		github?: Partial<SiteInfo['github']>
		footer?: Partial<SiteInfo['footer']>
	}
}

const defaultSiteInfo: SiteInfo = {
	title: '服务状态',
	avatar: '',
	rtl: false,
	home: {
		label: '主页',
		href: '/',
	},
	github: {
		href: 'https://github.com/xOS',
	},
	footer: {
		title: '服务状态',
		description: '由 UptimeRobot 数据驱动，自动缓存并动态更新。',
		owner: '楠格',
		ownerUrl: 'https://www.nange.cn',
		projectUrl: 'https://github.com/xOS/StatusPage',
	},
}

export const siteInfoRequest = () => {
	const {
		data: rawData,
		loading,
		error,
	} = useRequest<SiteInfoResponse>(() => http.get('/api/info'))

	const data = computed(() => normalizeSiteInfo(rawData.value))

	return { data, loading, error }
}

function normalizeSiteInfo(response?: SiteInfoResponse): SiteInfo {
	const site: NonNullable<SiteInfoResponse['site']> = response?.site || {}
	const footer = (site.footer || {}) as Partial<SiteInfo['footer']>
	const title = site.title || response?.name || defaultSiteInfo.title
	const owner = footer.owner || response?.desc || defaultSiteInfo.footer.owner

	return {
		title,
		avatar: site.avatar || response?.avatar || defaultSiteInfo.avatar,
		rtl: site.rtl ?? response?.rtl ?? defaultSiteInfo.rtl,
		home: {
			label: site.home?.label || defaultSiteInfo.home.label,
			href: site.home?.href || defaultSiteInfo.home.href,
		},
		github: {
			href: site.github?.href || defaultSiteInfo.github.href,
		},
		footer: {
			title: footer.title || title,
			description: footer.description || defaultSiteInfo.footer.description,
			owner,
			ownerUrl: footer.ownerUrl || defaultSiteInfo.footer.ownerUrl,
			projectUrl: footer.projectUrl || defaultSiteInfo.footer.projectUrl,
		},
	}
}
