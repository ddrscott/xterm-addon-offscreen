/**
 * @license MIT
 * xterm-addon-offscreen - Renders terminal content to OffscreenCanvas
 *
 * This addon enables capturing terminal content even when the terminal
 * DOM element is off-screen or hidden, using OffscreenCanvas for
 * DOM-independent rendering.
 */

import type { Terminal, ITerminalAddon, IBufferCell, ITheme } from '@xterm/xterm';

export interface IOffscreenAddonOptions {
	/**
	 * Scale factor for the rendered output (default: 1)
	 * Use values < 1 for thumbnails, > 1 for high-DPI
	 * Must be a positive finite number.
	 */
	scaleFactor?: number;

	/**
	 * Whether to include the cursor in the render (default: true)
	 */
	showCursor?: boolean;
}

export interface ICaptureOptions {
	/**
	 * Output format (default: 'imageBitmap')
	 */
	format?: 'imageBitmap' | 'dataURL' | 'blob';

	/**
	 * MIME type for dataURL/blob output (default: 'image/png')
	 */
	type?: 'image/png' | 'image/jpeg' | 'image/webp';

	/**
	 * Quality for lossy formats (0-1, default: 0.92)
	 * Values outside 0-1 range will be clamped.
	 */
	quality?: number;
}

// Default ANSI colors (standard 16-color palette)
const DEFAULT_ANSI_COLORS: string[] = [
	'#000000', // black
	'#cd0000', // red
	'#00cd00', // green
	'#cdcd00', // yellow
	'#0000ee', // blue
	'#cd00cd', // magenta
	'#00cdcd', // cyan
	'#e5e5e5', // white
	'#7f7f7f', // bright black
	'#ff0000', // bright red
	'#00ff00', // bright green
	'#ffff00', // bright yellow
	'#5c5cff', // bright blue
	'#ff00ff', // bright magenta
	'#00ffff', // bright cyan
	'#ffffff' // bright white
];

// Generate 256-color palette (16-231: color cube, 232-255: grayscale)
function generate256Colors(): string[] {
	const colors = [...DEFAULT_ANSI_COLORS];

	// 216 color cube (6x6x6)
	const levels = [0, 95, 135, 175, 215, 255];
	for (let r = 0; r < 6; r++) {
		for (let g = 0; g < 6; g++) {
			for (let b = 0; b < 6; b++) {
				colors.push(`rgb(${levels[r]}, ${levels[g]}, ${levels[b]})`);
			}
		}
	}

	// 24 grayscale colors
	for (let i = 0; i < 24; i++) {
		const v = 8 + i * 10;
		colors.push(`rgb(${v}, ${v}, ${v})`);
	}

	return colors;
}

const PALETTE_256 = generate256Colors();

export class OffscreenAddon implements ITerminalAddon {
	private _terminal: Terminal | null = null;
	private _canvas: OffscreenCanvas | null = null;
	private _ctx: OffscreenCanvasRenderingContext2D | null = null;
	private _options: Required<IOffscreenAddonOptions>;

	// Cached dimensions
	private _cellWidth = 0;
	private _cellHeight = 0;
	private _charWidth = 0;
	private _charHeight = 0;

	// Reusable cell reference for performance
	private _cellRef: IBufferCell | null = null;

	constructor(options?: IOffscreenAddonOptions) {
		this._options = {
			scaleFactor: this._validateScaleFactor(options?.scaleFactor ?? 1),
			showCursor: options?.showCursor ?? true
		};
	}

	/**
	 * Validate and normalize scale factor
	 */
	private _validateScaleFactor(value: number): number {
		if (!Number.isFinite(value) || value <= 0) {
			console.warn(
				`OffscreenAddon: Invalid scaleFactor ${value}, using default of 1`
			);
			return 1;
		}
		return value;
	}

	public activate(terminal: Terminal): void {
		this._terminal = terminal;

		// Create the offscreen canvas
		this._updateDimensions();
	}

	public dispose(): void {
		this._terminal = null;
		this._canvas = null;
		this._ctx = null;
		this._cellRef = null;
	}

	/**
	 * Update internal dimensions based on terminal state
	 */
	private _updateDimensions(): void {
		if (!this._terminal) return;

		const scale = this._options.scaleFactor;

		// Get font metrics from terminal options
		const fontSize = this._terminal.options.fontSize ?? 13;
		const fontFamily =
			this._terminal.options.fontFamily ?? 'courier-new, courier, monospace';
		const lineHeight = this._terminal.options.lineHeight ?? 1.0;

		// Calculate character dimensions
		// We use a measurement approach similar to xterm.js
		this._charWidth = Math.ceil(fontSize * 0.6 * scale); // Approximate monospace ratio
		this._charHeight = Math.ceil(fontSize * lineHeight * scale);
		this._cellWidth = this._charWidth;
		this._cellHeight = this._charHeight;

		// Try to get more accurate dimensions from terminal internals if available
		try {
			const core = (this._terminal as any)._core;
			if (core?._renderService?.dimensions) {
				const dims = core._renderService.dimensions;
				if (dims.css?.cell?.width > 0) {
					this._cellWidth = Math.ceil(dims.css.cell.width * scale);
					this._cellHeight = Math.ceil(dims.css.cell.height * scale);
					this._charWidth = this._cellWidth;
					this._charHeight = this._cellHeight;
				}
			}
		} catch {
			// Use calculated dimensions as fallback
		}

		// Create/resize canvas
		const width = this._terminal.cols * this._cellWidth;
		const height = this._terminal.rows * this._cellHeight;

		if (!this._canvas || this._canvas.width !== width || this._canvas.height !== height) {
			this._canvas = new OffscreenCanvas(width, height);
			this._ctx = this._canvas.getContext('2d', {
				alpha: false,
				willReadFrequently: false
			});
		}
	}

	/**
	 * Build the 16-color ANSI palette from theme, using theme colors as the source of truth
	 */
	private _buildThemePalette(theme: ITheme): string[] {
		return [
			theme.black ?? DEFAULT_ANSI_COLORS[0],
			theme.red ?? DEFAULT_ANSI_COLORS[1],
			theme.green ?? DEFAULT_ANSI_COLORS[2],
			theme.yellow ?? DEFAULT_ANSI_COLORS[3],
			theme.blue ?? DEFAULT_ANSI_COLORS[4],
			theme.magenta ?? DEFAULT_ANSI_COLORS[5],
			theme.cyan ?? DEFAULT_ANSI_COLORS[6],
			theme.white ?? DEFAULT_ANSI_COLORS[7],
			theme.brightBlack ?? DEFAULT_ANSI_COLORS[8],
			theme.brightRed ?? DEFAULT_ANSI_COLORS[9],
			theme.brightGreen ?? DEFAULT_ANSI_COLORS[10],
			theme.brightYellow ?? DEFAULT_ANSI_COLORS[11],
			theme.brightBlue ?? DEFAULT_ANSI_COLORS[12],
			theme.brightMagenta ?? DEFAULT_ANSI_COLORS[13],
			theme.brightCyan ?? DEFAULT_ANSI_COLORS[14],
			theme.brightWhite ?? DEFAULT_ANSI_COLORS[15]
		];
	}

	/**
	 * Get color string from cell color information
	 */
	private _getColor(
		cell: IBufferCell,
		isForeground: boolean,
		theme: ITheme,
		themePalette: string[]
	): string {
		const color = isForeground ? cell.getFgColor() : cell.getBgColor();

		// Default color mode (0)
		if (isForeground ? cell.isFgDefault() : cell.isBgDefault()) {
			return isForeground
				? theme.foreground ?? '#ffffff'
				: theme.background ?? '#000000';
		}

		// RGB color mode (2) - direct 24-bit color
		if (isForeground ? cell.isFgRGB() : cell.isBgRGB()) {
			const r = (color >> 16) & 0xff;
			const g = (color >> 8) & 0xff;
			const b = color & 0xff;
			return `rgb(${r}, ${g}, ${b})`;
		}

		// Palette color mode (1)
		if (isForeground ? cell.isFgPalette() : cell.isBgPalette()) {
			if (color < 16) {
				// Standard ANSI colors - use theme palette (built from terminal theme)
				return themePalette[color];
			}
			// Extended 256-color palette (indices 16-255)
			return PALETTE_256[color] ?? '#ffffff';
		}

		// Fallback
		return isForeground
			? theme.foreground ?? '#ffffff'
			: theme.background ?? '#000000';
	}

	/**
	 * Render the terminal content to the offscreen canvas
	 */
	private _render(): void {
		if (!this._terminal) return;

		// Update dimensions in case terminal was resized (also creates canvas if needed)
		this._updateDimensions();

		if (!this._canvas || !this._ctx) return;

		const ctx = this._ctx;
		const terminal = this._terminal;
		const buffer = terminal.buffer.active;
		const theme = terminal.options.theme ?? {};
		const themePalette = this._buildThemePalette(theme);
		const scale = this._options.scaleFactor;

		// Get font settings
		const fontSize = Math.round((terminal.options.fontSize ?? 13) * scale);
		const fontFamily =
			terminal.options.fontFamily ?? 'courier-new, courier, monospace';

		// Clear canvas with background color
		ctx.fillStyle = theme.background ?? '#000000';
		ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

		// Set up font
		ctx.textBaseline = 'top';
		ctx.font = `${fontSize}px ${fontFamily}`;

		// Get or create cell reference
		if (!this._cellRef) {
			this._cellRef = buffer.getNullCell();
		}

		// Render each visible row
		const viewportY = buffer.viewportY;
		for (let row = 0; row < terminal.rows; row++) {
			const bufferRow = viewportY + row;
			const line = buffer.getLine(bufferRow);
			if (!line) continue;

			const y = row * this._cellHeight;

			// Render each cell in the row
			for (let col = 0; col < terminal.cols; col++) {
				const cell = line.getCell(col, this._cellRef);
				if (!cell) continue;

				const x = col * this._cellWidth;
				const width = cell.getWidth();

				// Skip zero-width cells (continuation of wide chars)
				if (width === 0) continue;

				// Get colors, handling inverse attribute
				let fgColor = this._getColor(cell, true, theme, themePalette);
				let bgColor = this._getColor(cell, false, theme, themePalette);

				if (cell.isInverse()) {
					[fgColor, bgColor] = [bgColor, fgColor];
				}

				// Draw background if not default
				const defaultBg = theme.background ?? '#000000';
				if (bgColor !== defaultBg) {
					ctx.fillStyle = bgColor;
					ctx.fillRect(x, y, this._cellWidth * width, this._cellHeight);
				}

				// Draw character
				const chars = cell.getChars();
				if (chars) {
					// Apply text styles
					let fontStyle = '';
					if (cell.isBold()) fontStyle += 'bold ';
					if (cell.isItalic()) fontStyle += 'italic ';

					ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
					ctx.fillStyle = fgColor;

					// Apply dim effect
					if (cell.isDim()) {
						ctx.globalAlpha = 0.5;
					}

					// Center the character in the cell
					const textY = y + (this._cellHeight - fontSize) / 2;
					ctx.fillText(chars, x, textY);

					// Reset alpha
					if (cell.isDim()) {
						ctx.globalAlpha = 1.0;
					}

					// Draw underline
					if (cell.isUnderline()) {
						ctx.fillRect(x, y + this._cellHeight - 1, this._cellWidth * width, 1);
					}

					// Draw strikethrough
					if (cell.isStrikethrough()) {
						ctx.fillRect(
							x,
							y + this._cellHeight / 2,
							this._cellWidth * width,
							1
						);
					}

					// Draw overline
					if (cell.isOverline()) {
						ctx.fillRect(x, y, this._cellWidth * width, 1);
					}
				}
			}
		}

		// Draw cursor if enabled and visible
		// Note: cursorY is viewport-relative (0 = first visible row), but we need to check
		// if the cursor is in the visible viewport
		if (this._options.showCursor && terminal.buffer.active.cursorY >= 0) {
			const cursorX = buffer.cursorX;
			// cursorY is relative to viewport, not the buffer
			const cursorY = buffer.cursorY;

			if (cursorX >= 0 && cursorX < terminal.cols && cursorY >= 0 && cursorY < terminal.rows) {
				const x = cursorX * this._cellWidth;
				const y = cursorY * this._cellHeight;

				ctx.fillStyle = theme.cursor ?? '#ffffff';
				ctx.globalAlpha = 0.5;
				ctx.fillRect(x, y, this._cellWidth, this._cellHeight);
				ctx.globalAlpha = 1.0;
			}
		}
	}

	/**
	 * Capture the terminal content as an image
	 */
	public async capture(options?: ICaptureOptions): Promise<ImageBitmap | string | Blob> {
		if (!this._terminal) {
			throw new Error('Addon not activated');
		}

		// Render current state (this also creates/updates the canvas)
		this._render();

		if (!this._canvas) {
			throw new Error('Failed to create canvas');
		}

		const format = options?.format ?? 'imageBitmap';
		const type = options?.type ?? 'image/png';
		// Clamp quality to valid 0-1 range
		const quality = Math.max(0, Math.min(1, options?.quality ?? 0.92));

		switch (format) {
			case 'imageBitmap':
				return createImageBitmap(this._canvas);

			case 'dataURL': {
				// OffscreenCanvas doesn't have toDataURL, so we use blob + FileReader
				const blob = await this._canvas.convertToBlob({ type, quality });
				return new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result as string);
					reader.onerror = () => reject(reader.error);
					reader.readAsDataURL(blob);
				});
			}

			case 'blob':
				return this._canvas.convertToBlob({ type, quality });

			default:
				throw new Error(`Unknown format: ${format}`);
		}
	}

	/**
	 * Get the current canvas dimensions
	 */
	public getDimensions(): { width: number; height: number; cols: number; rows: number } {
		return {
			width: this._canvas?.width ?? 0,
			height: this._canvas?.height ?? 0,
			cols: this._terminal?.cols ?? 0,
			rows: this._terminal?.rows ?? 0
		};
	}

	/**
	 * Get the underlying OffscreenCanvas after rendering.
	 *
	 * This is the fastest way to display the terminal content - use the returned
	 * canvas directly with drawImage() on your target canvas context.
	 *
	 * @example
	 * ```typescript
	 * const canvas = addon.getCanvas();
	 * targetCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
	 * ```
	 */
	public getCanvas(): OffscreenCanvas {
		if (!this._terminal) {
			throw new Error('Addon not activated');
		}

		this._render();

		if (!this._canvas) {
			throw new Error('Failed to create canvas');
		}

		return this._canvas;
	}

	/**
	 * Render the terminal content directly to a target canvas context.
	 *
	 * This is the recommended method for high-refresh-rate use cases like minimaps.
	 * It renders the terminal and immediately blits to your target context in one call,
	 * avoiding intermediate copies and encoding overhead.
	 *
	 * @param targetCtx - The canvas context to draw to
	 * @param options - Optional destination rectangle (defaults to full canvas size)
	 *
	 * @example
	 * ```typescript
	 * // Draw at specific size (scales automatically)
	 * addon.renderTo(minimapCtx, { width: 200, height: 100 });
	 *
	 * // Draw at specific position and size
	 * addon.renderTo(ctx, { x: 10, y: 10, width: 200, height: 100 });
	 *
	 * // Draw at full size (1:1)
	 * addon.renderTo(ctx);
	 * ```
	 */
	public renderTo(
		targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		options?: { x?: number; y?: number; width?: number; height?: number }
	): void {
		const canvas = this.getCanvas();

		const x = options?.x ?? 0;
		const y = options?.y ?? 0;
		const width = options?.width ?? canvas.width;
		const height = options?.height ?? canvas.height;

		targetCtx.drawImage(canvas, x, y, width, height);
	}

	/**
	 * Update addon options
	 */
	public setOptions(options: Partial<IOffscreenAddonOptions>): void {
		if (options.scaleFactor !== undefined) {
			this._options.scaleFactor = this._validateScaleFactor(options.scaleFactor);
		}
		if (options.showCursor !== undefined) {
			this._options.showCursor = options.showCursor;
		}

		// Force dimension recalculation on next render
		this._canvas = null;
		this._ctx = null;
	}
}
