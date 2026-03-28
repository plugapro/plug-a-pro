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
        theme: 'dark',
        themeVariables: {
          primaryColor: '#1d4ed8',
          primaryTextColor: '#f8fafc',
          primaryBorderColor: '#3b82f6',
          lineColor: '#64748b',
          secondaryColor: '#1e293b',
          tertiaryColor: '#0f172a',
          background: '#0f172a',
          mainBkg: '#1e293b',
          nodeBorder: '#3b82f6',
          clusterBkg: '#0f172a',
          titleColor: '#f8fafc',
          edgeLabelBackground: '#1e293b',
          fontFamily: 'Geist, ui-sans-serif, system-ui',
          fontSize: '13px',
        },
        flowchart: { curve: 'basis', padding: 16, useMaxWidth: true },
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
    return <pre className={`text-xs text-destructive p-4 ${className ?? ''}`}>{error}</pre>
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {loading && (
        <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          Rendering diagram…
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
