'use client'

import { useEffect, useId, useRef, useState } from 'react'

interface MermaidDiagramProps {
  chart: string
  className?: string
}

export function MermaidDiagram({ chart, className }: MermaidDiagramProps) {
  const id = useId().replace(/:/g, '')
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function render() {
      const mermaid = (await import('mermaid')).default

      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        look: 'handDrawn',
        themeVariables: {
          primaryColor: '#f8f2e8',
          primaryTextColor: '#201a14',
          primaryBorderColor: '#5f584f',
          lineColor: '#5f584f',
          secondaryColor: '#f4ede2',
          tertiaryColor: '#fcfaf6',
          background: '#fcfaf6',
          mainBkg: '#fcfaf6',
          nodeBorder: '#5f584f',
          clusterBkg: '#f9f4eb',
          clusterBorder: '#7a7266',
          titleColor: '#201a14',
          edgeLabelBackground: '#fcfaf6',
          fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif',
          fontSize: '14px',
        },
        flowchart: { curve: 'linear', padding: 20, useMaxWidth: true, htmlLabels: false },
      })

      if (cancelled) return

      try {
        const result = await mermaid.render(`mermaid-${id}`, chart)
        if (cancelled || !containerRef.current) return

        // Parse SVG string into a real DOM node — no innerHTML needed
        const parser = new DOMParser()
        const doc = parser.parseFromString(result.svg, 'image/svg+xml')
        const svgEl = doc.documentElement as unknown as SVGElement
        svgEl.style.maxWidth = '100%'
        svgEl.style.height = 'auto'
        containerRef.current.replaceChildren(svgEl)
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError(String(err))
          setLoading(false)
        }
      }
    }

    render()
    return () => { cancelled = true }
  }, [chart, id])

  if (error) {
    return (
      <pre
        className={`rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 ${className ?? ''}`}
      >
        {error}
      </pre>
    )
  }

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border border-stone-300 bg-[#fcfaf6] p-4 shadow-[0_14px_34px_rgba(38,26,12,0.08)] ${className ?? ''}`}
    >
      {loading && (
        <div className="flex items-center justify-center p-8 text-sm italic text-stone-500">
          Rendering diagram…
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
