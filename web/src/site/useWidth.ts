import { useLayoutEffect, useRef, useState } from 'react'

/** A ref for an element and its current width in px, kept up to date as it resizes (charts draw to it). */
export function useWidth<T extends HTMLElement = HTMLDivElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}
