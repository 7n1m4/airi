/**
 * Draws a high-contrast 100-interval normalized coordinate grid ([0, 1000])
 * onto a 2D canvas context.
 *
 * This provides visual grounding for Vision Language Models (VLMs) and players,
 * enabling exact coordinate identification of UI elements and game tiles.
 */
export function drawCoordinateGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: {
    accentCenter?: boolean
    showPills?: boolean
  } = {},
): void {
  const { accentCenter = true, showPills = true } = options

  ctx.save()

  // 1. Grid Lines (100, 200, ... 900)
  for (let i = 1; i < 10; i++) {
    const x = (i / 10) * width
    const y = (i / 10) * height
    const isCenter = i === 5 && accentCenter

    // Vertical line - dark contrast shadow underlay
    ctx.beginPath()
    ctx.lineWidth = isCenter ? 3 : 2
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.setLineDash([])
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()

    // Horizontal line - dark contrast shadow underlay
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()

    // Vertical line - colored foreground
    ctx.beginPath()
    ctx.lineWidth = isCenter ? 1.5 : 1
    ctx.strokeStyle = isCenter ? '#f59e0b' : 'rgba(56, 189, 248, 0.85)'
    ctx.setLineDash(isCenter ? [] : [6, 4])
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()

    // Horizontal line - colored foreground
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }

  // 2. Outer Border
  ctx.setLineDash([])
  // Shadow border
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.strokeRect(0, 0, width, height)
  // Colored border
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'
  ctx.strokeRect(0, 0, width, height)

  // 3. Coordinate Pills & Labels
  if (showPills && width >= 200 && height >= 200) {
    const fontSize = Math.max(10, Math.min(13, Math.round(width / 55)))
    ctx.font = `bold ${fontSize}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const pillH = fontSize + 8

    // Top X labels
    for (let i = 1; i < 10; i++) {
      const norm = i * 100
      const x = (i / 10) * width
      const isCenter = i === 5
      const label = String(norm)

      const pillW = fontSize * 3.4

      // Top badge (y=6 gives safe headroom from top edge)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
      ctx.strokeStyle = isCenter ? '#f59e0b' : '#38bdf8'
      ctx.lineWidth = 1
      drawRoundedRect(ctx, x - pillW / 2, 6, pillW, pillH, 4)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = isCenter ? '#fbbf24' : '#38bdf8'
      ctx.fillText(label, x, 6 + pillH / 2)
    }

    // Left Y labels
    for (let j = 1; j < 10; j++) {
      const norm = j * 100
      const y = (j / 10) * height
      const isCenter = j === 5
      const label = String(norm)

      const pillW = fontSize * 3.4

      // Left badge (x=6 gives safe margin from left edge)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
      ctx.strokeStyle = isCenter ? '#f59e0b' : '#38bdf8'
      ctx.lineWidth = 1
      drawRoundedRect(ctx, 6, y - pillH / 2, pillW, pillH, 4)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = isCenter ? '#fbbf24' : '#38bdf8'
      ctx.fillText(label, 6 + pillW / 2, y)
    }

    // Center Crosshair Marker at (500, 500)
    const midX = width / 2
    const midY = height / 2

    // Crosshair ticks
    ctx.beginPath()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#f59e0b'
    ctx.setLineDash([])
    ctx.moveTo(midX - 10, midY)
    ctx.lineTo(midX + 10, midY)
    ctx.moveTo(midX, midY - 10)
    ctx.lineTo(midX, midY + 10)
    ctx.stroke()

    // Center dot
    ctx.fillStyle = '#f59e0b'
    ctx.beginPath()
    ctx.arc(midX, midY, 4.5, 0, Math.PI * 2)
    ctx.fill()

    const centerPillW = fontSize * 5.6
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 1
    drawRoundedRect(ctx, midX + 8, midY + 8, centerPillW, pillH, 4)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#fbbf24'
    ctx.fillText('500,500', midX + 8 + centerPillW / 2, midY + 8 + pillH / 2)

    // Origin (0,0) badge
    const originPillW = fontSize * 3.2
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
    ctx.strokeStyle = '#38bdf8'
    drawRoundedRect(ctx, 6, 6, originPillW, pillH, 4)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#38bdf8'
    ctx.fillText('0,0', 6 + originPillW / 2, 6 + pillH / 2)

    // Bottom Right (1000,1000) badge
    const brPillW = fontSize * 6.5
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
    ctx.strokeStyle = '#38bdf8'
    drawRoundedRect(ctx, width - brPillW - 6, height - pillH - 6, brPillW, pillH, 4)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#38bdf8'
    ctx.fillText('1000,1000', width - brPillW / 2 - 6, height - pillH / 2 - 6)
  }

  ctx.restore()
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/**
 * Synchronously burns a coordinate grid onto a canvas or ImageData source.
 */
export function burnCoordinateGridToCanvas(
  source: HTMLCanvasElement | ImageData,
  withGrid = true,
): { dataUrl: string, base64: string, mimeType: string } | null {
  if (typeof document === 'undefined') {
    return null
  }

  const width = source.width
  const height = source.height
  if (width <= 0 || height <= 0) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  if ('data' in source) {
    ctx.putImageData(source, 0, 0)
  }
  else {
    ctx.drawImage(source, 0, 0)
  }

  if (withGrid) {
    drawCoordinateGrid(ctx, width, height)
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  return { dataUrl, base64, mimeType: 'image/jpeg' }
}

/**
 * Loads an image from a DataURL, draws it onto an offscreen canvas,
 * burns the 100-step normalized coordinate grid onto it, and returns the result.
 */
export async function burnCoordinateGridToDataUrl(
  sourceDataUrl: string,
): Promise<{ dataUrl: string, base64: string, mimeType: string }> {
  if (typeof document === 'undefined') {
    const base64 = sourceDataUrl.includes(',') ? sourceDataUrl.split(',')[1] : sourceDataUrl
    return { dataUrl: sourceDataUrl, base64, mimeType: 'image/jpeg' }
  }

  return new Promise((resolve) => {
    const img = new Image()
    // NOTICE: Do NOT set img.crossOrigin on data: URIs as it causes CORS failures in Chromium
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width || 640
        canvas.height = img.naturalHeight || img.height || 480
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve({
            dataUrl: sourceDataUrl,
            base64: sourceDataUrl.includes(',') ? sourceDataUrl.split(',')[1] : sourceDataUrl,
            mimeType: 'image/jpeg',
          })
          return
        }

        ctx.drawImage(img, 0, 0)
        drawCoordinateGrid(ctx, canvas.width, canvas.height)

        const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
        resolve({ dataUrl, base64, mimeType: 'image/jpeg' })
      }
      catch (e) {
        console.warn('[Arcade] Failed burning coordinate grid to canvas:', e)
        const base64 = sourceDataUrl.includes(',') ? sourceDataUrl.split(',')[1] : sourceDataUrl
        resolve({ dataUrl: sourceDataUrl, base64, mimeType: 'image/jpeg' })
      }
    }
    img.onerror = (err) => {
      console.warn('[Arcade] Image load failed during grid burn-in:', err)
      const base64 = sourceDataUrl.includes(',') ? sourceDataUrl.split(',')[1] : sourceDataUrl
      resolve({ dataUrl: sourceDataUrl, base64, mimeType: 'image/jpeg' })
    }
    img.src = sourceDataUrl
    if (img.complete) {
      // If already cached or immediately ready
      try {
        const event = new Event('load')
        img.dispatchEvent(event)
      }
      catch {}
    }
  })
}
