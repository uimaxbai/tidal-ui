import Redis, { type RedisOptions } from 'ioredis';
import { env } from '$env/dynamic/private';

let client: Redis | null | undefined;
let hasLoggedError = false;

function logRedisError(error: unknown): void {
	if (hasLoggedError) return;
	hasLoggedError = true;
	console.error('Redis connection error:', error);
}

function buildOptions(): RedisOptions | string | null {
	const url = env.REDIS_URL || env.REDIS_CONNECTION_STRING;
	if (url) {
		return url;
	}

	const host = env.REDIS_HOST;
	if (!host) {
		return null;
	}

	const port = env.REDIS_PORT ? Number.parseInt(env.REDIS_PORT, 10) : 6379;
	const tlsEnabled = (env.REDIS_TLS || '').toLowerCase() === 'true';

	const options: RedisOptions = {
		host,
		port,
		password: env.REDIS_PASSWORD,
		username: env.REDIS_USERNAME,
		lazyConnect: true
	};

	if (tlsEnabled) {
		options.tls = {};
	}

	return options;
}

export function getRedisClient(): Redis | null {
	if (client !== undefined) {
		return client;
	}

	const options = buildOptions();
	if (!options) {
		client = null;
		return client;
	}

	try {
		client =
			typeof options === 'string' ? new Redis(options, { lazyConnect: true }) : new Redis(options);
		client.on('error', logRedisError);
		return client;
	} catch (error) {
		logRedisError(error);
		client = null;
		return client;
	}
}

export function isRedisEnabled(): boolean {
	return getRedisClient() !== null;
}
