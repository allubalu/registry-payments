import type { JurisdictionSummary } from '../api.ts'

interface JurisdictionPickerProps {
  readonly jurisdictions: readonly JurisdictionSummary[]
  readonly selectedId: string
  readonly onSelect: (id: string) => void
}

export function JurisdictionPicker({
  jurisdictions,
  selectedId,
  onSelect,
}: JurisdictionPickerProps) {
  return (
    <div className="field">
      <label htmlFor="jurisdiction">Jurisdiction</label>
      <select
        id="jurisdiction"
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        {jurisdictions.map((jurisdiction) => (
          <option key={jurisdiction.id} value={jurisdiction.id}>
            {jurisdiction.jurisdictionLabel} ({jurisdiction.currency})
          </option>
        ))}
      </select>
    </div>
  )
}
