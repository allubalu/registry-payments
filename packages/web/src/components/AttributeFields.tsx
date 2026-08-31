import type { AttributeValue, RequiredAttribute } from '../api.ts'

interface AttributeFieldsProps {
  readonly attributes: readonly RequiredAttribute[]
  readonly values: Readonly<Record<string, AttributeValue>>
  readonly onChange: (name: string, value: AttributeValue) => void
}

/**
 * Renders a jurisdiction's inputs from its declared `requiredAttributes`.
 *
 * This component is the whole argument of the project, in one file. There is no
 * `switch` on a jurisdiction id, no `if (california)`, and no per-country
 * component — only a mapping from the *kind* of an attribute to a control:
 *
 *   string with options → select      number  → number input
 *   string, free text   → text input  boolean → checkbox
 *
 * Adding a seventh jurisdiction means adding a JSON file to
 * `config/jurisdictions/`. This directory does not change, and a guard test
 * fails the build if a pack id ever appears here.
 */
export function AttributeFields({ attributes, values, onChange }: AttributeFieldsProps) {
  if (attributes.length === 0) {
    return (
      <p className="field-note">
        This jurisdiction needs no extra details — its fees depend only on the value.
      </p>
    )
  }

  return (
    <>
      {attributes.map((attribute) => {
        const id = `attr-${attribute.name}`
        const value = values[attribute.name]

        if (attribute.kind === 'boolean') {
          return (
            <div className="field field--check" key={attribute.name}>
              <input
                type="checkbox"
                id={id}
                checked={value === true}
                onChange={(event) => onChange(attribute.name, event.target.checked)}
              />
              <label htmlFor={id}>{attribute.label}</label>
            </div>
          )
        }

        if (attribute.kind === 'number') {
          return (
            <div className="field" key={attribute.name}>
              <label htmlFor={id}>{attribute.label}</label>
              <input
                type="number"
                id={id}
                min={0}
                step={1}
                value={typeof value === 'number' ? String(value) : ''}
                onChange={(event) => {
                  // An empty box is not zero. Sending 0 for "not yet answered"
                  // would quietly change the fee; leave it absent and let the
                  // API's 422 say what is missing.
                  const raw = event.target.value
                  if (raw === '') return
                  onChange(attribute.name, Number(raw))
                }}
              />
            </div>
          )
        }

        if (attribute.options !== null) {
          return (
            <div className="field" key={attribute.name}>
              <label htmlFor={id}>{attribute.label}</label>
              <select
                id={id}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => onChange(attribute.name, event.target.value)}
              >
                <option value="">Choose…</option>
                {attribute.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          )
        }

        return (
          <div className="field" key={attribute.name}>
            <label htmlFor={id}>{attribute.label}</label>
            <input
              type="text"
              id={id}
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => onChange(attribute.name, event.target.value)}
            />
          </div>
        )
      })}
    </>
  )
}
