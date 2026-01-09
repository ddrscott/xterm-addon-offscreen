/**
 * xterm-addon-offscreen
 *
 * An xterm.js addon that renders terminal content to an OffscreenCanvas,
 * enabling capture of terminal state even when the DOM element is off-screen.
 */

export { OffscreenAddon } from './OffscreenAddon.js';
export type {
	IOffscreenAddonOptions,
	ICaptureOptions
} from './OffscreenAddon.js';
