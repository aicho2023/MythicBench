// Shared materials + procedurally generated textures.
// Procedural = drawn in code on a <canvas>, so we ship zero image files and
// have no licensing questions for placeholder art.
import * as THREE from 'three'

let _gradient: THREE.DataTexture | null = null
/** 3-step ramp that turns smooth lighting into cartoon "bands". */
export function toonGradient(): THREE.DataTexture {
  if (_gradient) return _gradient
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255])
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  _gradient = tex
  return tex
}

const toonCache = new Map<string, THREE.MeshToonMaterial>()
export function toon(color: string, emissive = '#000000', emissiveIntensity = 1): THREE.MeshToonMaterial {
  const key = `${color}|${emissive}|${emissiveIntensity}`
  let m = toonCache.get(key)
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), emissive, emissiveIntensity })
    toonCache.set(key, m)
  }
  return m
}

const glowCache = new Map<string, THREE.MeshBasicMaterial>()
/** Unlit, over-bright material: anything using it will bloom (glow). */
export function glow(color: string, strength = 2.5, opacity = 1): THREE.MeshBasicMaterial {
  const key = `${color}|${strength}|${opacity}`
  let m = glowCache.get(key)
  if (!m) {
    const c = new THREE.Color(color).multiplyScalar(strength)
    m = new THREE.MeshBasicMaterial({
      color: c, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    })
    glowCache.set(key, m)
  }
  return m
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  draw(g, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Deterministic tiny PRNG so textures look identical on every load. */
function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let _floor: THREE.CanvasTexture | null = null
export function flagstoneTexture(): THREE.CanvasTexture {
  if (_floor) return _floor
  _floor = canvasTexture(1024, (g, s) => {
    const rnd = mulberry(42)
    g.fillStyle = '#1c1828'
    g.fillRect(0, 0, s, s)
    const rows = 8
    const h = s / rows
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -h * 0.5 : 0
      while (x < s) {
        const w = h * (0.8 + rnd() * 0.9)
        const v = 58 + rnd() * 26
        g.fillStyle = `rgb(${v * 0.92},${v * 0.88},${v * 1.12})`
        const pad = 5
        g.beginPath()
        g.roundRect(x + pad, r * h + pad, w - pad * 2, h - pad * 2, 10)
        g.fill()
        // subtle highlight + cracks for a hand-painted feel
        g.fillStyle = 'rgba(255,255,255,0.05)'
        g.fillRect(x + pad + 4, r * h + pad + 3, w - pad * 2 - 8, 6)
        if (rnd() < 0.25) {
          g.strokeStyle = 'rgba(10,8,18,0.5)'
          g.lineWidth = 2
          g.beginPath()
          const cx = x + w * rnd()
          const cy = r * h + h * rnd()
          g.moveTo(cx, cy)
          g.lineTo(cx + 20 * (rnd() - 0.5), cy + 25 * (rnd() - 0.5))
          g.lineTo(cx + 30 * (rnd() - 0.5), cy + 30 * (rnd() - 0.5))
          g.stroke()
        }
        x += w
      }
    }
  })
  _floor.wrapS = _floor.wrapT = THREE.RepeatWrapping
  _floor.repeat.set(5, 5)
  return _floor
}

let _wall: THREE.CanvasTexture | null = null
export function brickTexture(): THREE.CanvasTexture {
  if (_wall) return _wall
  _wall = canvasTexture(512, (g, s) => {
    const rnd = mulberry(7)
    g.fillStyle = '#0f0d18'
    g.fillRect(0, 0, s, s)
    const rows = 8
    const h = s / rows
    for (let r = 0; r < rows; r++) {
      for (let x = r % 2 ? -32 : 0; x < s; x += 64) {
        const v = 34 + rnd() * 18
        g.fillStyle = `rgb(${v},${v * 0.9},${v * 1.25})`
        g.fillRect(x + 3, r * h + 3, 58, h - 6)
      }
    }
  })
  _wall.wrapS = _wall.wrapT = THREE.RepeatWrapping
  _wall.repeat.set(10, 2)
  return _wall
}

let _rune: THREE.CanvasTexture | null = null
/** Glowing magic circle used under the boss and for spell circles. */
export function runeCircleTexture(): THREE.CanvasTexture {
  if (_rune) return _rune
  _rune = canvasTexture(512, (g, s) => {
    const c = s / 2
    g.clearRect(0, 0, s, s)
    g.strokeStyle = 'white'
    g.lineWidth = 6
    for (const r of [0.96, 0.8, 0.5]) {
      g.beginPath()
      g.arc(c, c, c * r, 0, Math.PI * 2)
      g.stroke()
    }
    g.lineWidth = 4
    // a 6-point star
    g.beginPath()
    for (let k = 0; k <= 6; k++) {
      const a = (k * 2 * Math.PI * 2) / 6 - Math.PI / 2
      const px = c + Math.cos(a) * c * 0.8
      const py = c + Math.sin(a) * c * 0.8
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
    // rune ticks between rings
    g.font = 'bold 34px serif'
    g.fillStyle = 'white'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ'
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      g.save()
      g.translate(c + Math.cos(a) * c * 0.88, c + Math.sin(a) * c * 0.88)
      g.rotate(a + Math.PI / 2)
      g.fillText(glyphs[k], 0, 0)
      g.restore()
    }
  })
  return _rune
}

let _swirl: THREE.CanvasTexture | null = null
/** Spiral swirl for Desecrate pools. */
export function swirlTexture(): THREE.CanvasTexture {
  if (_swirl) return _swirl
  _swirl = canvasTexture(512, (g, s) => {
    const c = s / 2
    const grad = g.createRadialGradient(c, c, 0, c, c, c)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.6, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, s, s)
    g.strokeStyle = 'rgba(255,255,255,0.95)'
    g.lineCap = 'round'
    for (let arm = 0; arm < 5; arm++) {
      g.lineWidth = 14
      g.beginPath()
      for (let k = 0; k < 60; k++) {
        const f = k / 60
        const a = arm * ((Math.PI * 2) / 5) + f * Math.PI * 1.6
        const r = f * c * 0.92
        const px = c + Math.cos(a) * r
        const py = c + Math.sin(a) * r
        if (k === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.stroke()
    }
    g.lineWidth = 10
    g.beginPath()
    g.arc(c, c, c * 0.95, 0, Math.PI * 2)
    g.stroke()
  })
  return _swirl
}

let _soft: THREE.CanvasTexture | null = null
/** Soft round blob — used for blob shadows and glows. */
export function softCircleTexture(): THREE.CanvasTexture {
  if (_soft) return _soft
  _soft = canvasTexture(128, (g, s) => {
    const c = s / 2
    const grad = g.createRadialGradient(c, c, 0, c, c, c)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, s, s)
  })
  return _soft
}
