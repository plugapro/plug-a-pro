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
          primaryColor: '#f8f8f6',
          primaryTextColor: '#111111',
          primaryBorderColor: '#444444',
          lineColor: '#444444',
          secondaryColor: '#f1f1ef',
          tertiaryColor: '#fbfbf9',
          background: '#fbfbf9',
          mainBkg: '#fbfbf9',
          nodeBorder: '#444444',
          clusterBkg: '#f4f4f1',
          clusterBorder: '#666666',
          titleColor: '#111111',
          edgeLabelBackground: '#fbfbf9',
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
        className={`rounded-none border border-zinc-400 bg-white p-4 text-xs text-zinc-800 ${className ?? ''}`}
      >
        {error}
      </pre>
    )
  }

  return (
    <div
      className={`relative overflow-hidden border border-zinc-400 bg-[#fbfbf9] p-4 ${className ?? ''}`}
    >
      {loading && (
        <div className="flex items-center justify-center p-8 text-sm italic text-zinc-500">
          Rendering diagram…
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
