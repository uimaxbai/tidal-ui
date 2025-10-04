import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: LayoutServerLoad = () => {
	return {
		title: env.TITLE ?? 'BiniLossless',
		slogan: env.SLOGAN ?? 'The easiest way to stream CD-quality lossless FLACs.'
	};
};
