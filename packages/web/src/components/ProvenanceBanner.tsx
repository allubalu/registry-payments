interface ProvenanceBannerProps {
  readonly provenance: string
  readonly disclaimer: string
}

/**
 * Shows where the rates came from, adjacent to the number it qualifies (FR-10).
 *
 * Not dismissible, and not in the page footer. Every rate in this project is
 * `SYNTHETIC` — invented for demonstration — and a figure that looks like an
 * official assessment while sitting a screen away from that fact is the failure
 * mode the requirement exists to prevent.
 */
export function ProvenanceBanner({ provenance, disclaimer }: ProvenanceBannerProps) {
  const synthetic = provenance === 'SYNTHETIC'

  return (
    <aside className={synthetic ? 'provenance provenance--synthetic' : 'provenance'} role="note">
      <span aria-hidden="true" className="provenance__icon">
        {synthetic ? '⚠' : 'ℹ'}
      </span>
      <span>
        {disclaimer} <strong>Provenance: {provenance}.</strong>
      </span>
    </aside>
  )
}
