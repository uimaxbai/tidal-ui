import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { ALL_API_TARGETS, type ApiClusterTarget } from '$lib/config';

interface ApiHealthState {
	status: 'idle' | 'checking' | 'complete';
	healthyTargets: ApiClusterTarget[];
	lastCheck: number | null;
}

const CHECK_TIMEOUT_MS = 4000; // 4 seconds to respond
const RECHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HEALTH_CHECK_TRACK_ID = '230917825'; // A known popular track ID to test against

const createApiHealthStore = () => {
	const initialState: ApiHealthState = {
		status: 'idle',
		healthyTargets: [],
		lastCheck: null
	};

	const { subscribe, set, update } = writable<ApiHealthState>(initialState);

	async function checkApiTarget(target: ApiClusterTarget): Promise<{ target: ApiClusterTarget; healthy: boolean }> {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

            const checkUrl = new URL(`/track/?id=${HEALTH_CHECK_TRACK_ID}&quality=LOW`, target.baseUrl);

			const response = await fetch(checkUrl.toString(), {
				method: 'GET',
				signal: controller.signal,
				mode: 'cors'
			});

			clearTimeout(timeoutId);

            // Abort reading the body to save bandwidth
            if (response.body?.cancel) {
                response.body.cancel();
            }

			// We consider any 2xx status code a success for the health check
			return { target, healthy: response.ok };
		} catch (error) {
			return { target, healthy: false };
		}
	}

	async function runHealthChecks() {
		if (!browser || get({ subscribe }).status === 'checking') return;

		update(state => ({ ...state, status: 'checking' }));

		const checks = ALL_API_TARGETS.map(target => checkApiTarget(target));
		const results = await Promise.all(checks);

		const healthyTargets = results
			.filter(result => result.healthy)
			.map(result => result.target);

		console.log(`API Health Check Complete: ${healthyTargets.length} / ${ALL_API_TARGETS.length} targets are healthy`);

		set({
			status: 'complete',
			healthyTargets,
			lastCheck: Date.now()
		});
	}

	return {
		subscribe,
		initialize: () => {
			const { status } = get({ subscribe });
			if (browser && status === 'idle') {
				runHealthChecks();
                setInterval(runHealthChecks, RECHECK_INTERVAL_MS);
			}
		}
	};
};

export const apiHealthStore = createApiHealthStore();