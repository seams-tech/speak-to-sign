// The nav's picker of the hero gradient: every grain field of the Seams site, by name.

import { IconChevronDown } from '@tabler/icons-react';
import { GRAIN_FIELD_NAMES, grainFieldSource } from './grain/fields';
import { DEFAULT_FIELD, fieldLabel, setHeroField, useHeroField } from './heroField';

export function FieldPicker() {
  const field = useHeroField();
  return (
    <label className="ss-field-pick" title="The gradient of the hero">
      <span className="ss-field-swatch" style={{ background: grainFieldSource(field).base }} aria-hidden="true" />
      <span className="sr-only">Gradient</span>
      <select value={field} onChange={(event) => setHeroField(event.target.value as typeof field)}>
        {GRAIN_FIELD_NAMES.map((name) => (
          <option key={name} value={name}>
            {fieldLabel(name)}
            {name === DEFAULT_FIELD ? ' (Seams home)' : ''}
          </option>
        ))}
      </select>
      <IconChevronDown size={13} stroke={2.2} aria-hidden="true" />
    </label>
  );
}
