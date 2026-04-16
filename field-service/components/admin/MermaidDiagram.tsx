'use client'

import { useEffect, useId, useRef, useState } from 'react'

interface MermaidDiagramProps {
  chart: string
  compact?: boolean
  className?: string
}

export function MermaidDiagram({ chart, compact, className }: MermaidDiagramProps) {
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
        themeVariables: {
          primaryColor: '#f4f7fb',
          primaryTextColor: '#0f172a',
          primaryBorderColor: '#d6dfeb',
          lineColor: '#94a3b8',
          secondaryColor: '#eef3fa',
          tertiaryColor: '#f8fafc',
          background: '#f4f7fb',
          mainBkg: '#f4f7fb',
          nodeBorder: '#d6dfeb',
          clusterBkg: '#eef3fa',
          clusterBorder: '#d6dfeb',
          titleColor: '#0f172a',
          edgeLabelBackground: '#ffffff',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: '13px',
        },
        flowchart: { curve: 'linear', padding: 20, useMaxWidth: true, htmlLabels: false },
      })

      if (cancelled) return

      try {
        const result = await mermaid.render(`mermaid-${id}`, chart)
        if (cancelled || !containerRef.current) return

        const parser = new DOMParser()
        const doc = parser.parseFromString(result.svg, 'image/svg+xml')
        const svgEl = doc.documentElement as unknown as SVGElement
        svgEl.style.maxWidth = compact ? '50%' : '100%'
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
      <pre className={`rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground ${className ?? ''}`}>
        {error}
      </pre>
    )
  }

  return (
    <div className={`relative overflow-hidden rounded-lg border bg-muted/30 p-4 ${className ?? ''}`}>
      {loading && (
        <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          Rendering diagram…
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
