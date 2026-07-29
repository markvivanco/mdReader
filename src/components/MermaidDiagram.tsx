import { useEffect, useId, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })

export function MermaidDiagram({ chart }: { chart: string }) {
  const id = useId().replaceAll(':', '')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    mermaid
      .render(`mermaid-${id}`, chart)
      .then(({ svg: rendered }) => {
        if (!cancelled) {
          setSvg(rendered)
          setError('')
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [chart, id])

  if (error) return <pre className="render-error">Mermaid: {error}</pre>
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}
