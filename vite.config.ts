import { defineConfig } from 'vite'

export default defineConfig({
	base: '/asfa-game/',
	server: {
		watch: {
		usePolling: true,
		},
	},
})