# xterm-addon-offscreen

An [xterm.js](https://xtermjs.org/) addon that renders terminal content to an `OffscreenCanvas`, enabling capture of terminal state even when the terminal DOM element is off-screen or hidden.

## Why?

When using xterm.js with WebGL or Canvas rendering, the browser doesn't render content for elements that are scrolled out of the viewport. This makes it impossible to capture terminal screenshots for features like:

- **Minimaps** - showing thumbnails of multiple terminals
- **Screenshots** - capturing terminal state for sharing
- **Previews** - generating terminal previews in the background

This addon solves the problem by reading directly from xterm.js's internal buffer and rendering to an `OffscreenCanvas` that works independently of DOM visibility.

## Installation

```bash
npm install xterm-addon-offscreen
```

## Usage

```typescript
import { Terminal } from '@xterm/xterm';
import { OffscreenAddon } from 'xterm-addon-offscreen';

// Create terminal
const terminal = new Terminal();
terminal.open(document.getElementById('terminal'));

// Load the addon
const offscreenAddon = new OffscreenAddon({
  scaleFactor: 0.5,  // 50% size for thumbnails
  showCursor: true
});
terminal.loadAddon(offscreenAddon);

// Capture terminal as image
const imageData = await offscreenAddon.capture({
  format: 'dataURL',
  type: 'image/jpeg',
  quality: 0.8
});

// Use in an <img> element
document.getElementById('preview').src = imageData;
```

## API

### Constructor Options

```typescript
interface IOffscreenAddonOptions {
  // Scale factor for rendered output (default: 1)
  // Use < 1 for thumbnails, > 1 for high-DPI
  scaleFactor?: number;

  // Whether to render the cursor (default: true)
  showCursor?: boolean;
}
```

### capture(options?)

Captures the current terminal state as an image.

```typescript
interface ICaptureOptions {
  // Output format (default: 'imageBitmap')
  format?: 'imageBitmap' | 'dataURL' | 'blob';

  // MIME type for dataURL/blob (default: 'image/png')
  type?: 'image/png' | 'image/jpeg' | 'image/webp';

  // Quality for lossy formats, 0-1 (default: 0.92)
  quality?: number;
}

// Returns Promise<ImageBitmap | string | Blob>
const result = await offscreenAddon.capture(options);
```

### getCanvas()

Returns the underlying `OffscreenCanvas` after rendering the current terminal state. This is the fastest method for displaying terminal content.

```typescript
const canvas = offscreenAddon.getCanvas();
targetCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
```

### renderTo(targetCtx, options?)

Renders the terminal content directly to a target canvas context. This is the recommended method for high-refresh-rate use cases like minimaps.

```typescript
// Draw at specific size (scales automatically)
offscreenAddon.renderTo(minimapCtx, { width: 200, height: 100 });

// Draw at specific position and size
offscreenAddon.renderTo(ctx, { x: 10, y: 10, width: 200, height: 100 });

// Draw at full size (1:1)
offscreenAddon.renderTo(ctx);
```

### getDimensions()

Returns the current canvas dimensions.

```typescript
const { width, height, cols, rows } = offscreenAddon.getDimensions();
```

### setOptions(options)

Updates addon options. Triggers canvas recreation on next render.

```typescript
offscreenAddon.setOptions({ scaleFactor: 1.0 });
```

## Performance

Different methods have different performance characteristics. Choose based on your use case:

| Method | Speed | Use Case |
|--------|-------|----------|
| `renderTo()` | Fastest | Minimaps, real-time previews (60fps capable) |
| `getCanvas()` + `drawImage()` | Fastest | When you need more control over drawing |
| `capture({ format: 'imageBitmap' })` | Fast | When you need an ImageBitmap object |
| `capture({ format: 'blob' })` | Slow | Saving to file, uploading |
| `capture({ format: 'dataURL' })` | Slowest | Embedding in HTML, data URIs |

### Minimap Example (High Performance)

For minimaps or other high-refresh scenarios, use `renderTo()` to avoid encoding overhead:

```typescript
const offscreenAddon = new OffscreenAddon({ scaleFactor: 0.2 });
terminal.loadAddon(offscreenAddon);

const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

function updateMinimap() {
  offscreenAddon.renderTo(minimapCtx, {
    width: minimapCanvas.width,
    height: minimapCanvas.height
  });
  requestAnimationFrame(updateMinimap);
}

updateMinimap();
```

### Screenshot Example (Quality)

For one-time captures where quality matters more than speed:

```typescript
const blob = await offscreenAddon.capture({
  format: 'blob',
  type: 'image/png'
});

// Download or upload the blob
const url = URL.createObjectURL(blob);
```

## How It Works

1. **Buffer Reading**: Reads terminal content directly from `terminal.buffer.active` API
2. **Cell Iteration**: Iterates through each visible cell using `getLine()` and `getCell()`
3. **Attribute Handling**: Extracts colors (RGB, palette, default) and styles (bold, italic, etc.)
4. **Canvas 2D Rendering**: Renders to an `OffscreenCanvas` using Canvas 2D API
5. **Image Export**: Converts canvas to ImageBitmap, dataURL, or Blob

This approach is DOM-independent - it works regardless of whether the terminal element is visible, hidden, or scrolled off-screen.

## Supported Features

- All 256 colors (16 ANSI + 216 color cube + 24 grayscale)
- True color (RGB)
- Theme colors from terminal options
- Bold, italic, dim text
- Underline, strikethrough, overline
- Inverse colors
- Wide characters (CJK)
- Cursor rendering

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.
