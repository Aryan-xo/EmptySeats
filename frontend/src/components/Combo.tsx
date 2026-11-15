import { useState } from 'react'

export interface ComboItem {
  value: string
  primary: string
  secondary?: string
}

interface Props {
  value: string
  onChange: (v: string) => void
  onPick: (item: ComboItem) => void
  items: ComboItem[]
  placeholder?: string
  required?: boolean
  uppercase?: boolean
  ariaLabel?: string
}

/** Small accessible autocomplete: type, arrow keys, Enter to pick. */
export function Combo({ value, onChange, onPick, items, placeholder, required, uppercase, ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const show = open && items.length > 0

  const pick = (it: ComboItem) => {
    onPick(it)
    setOpen(false)
  }

  return (
    <div className="combo">
      <input
        value={value}
        placeholder={placeholder}
        required={required}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={(e) => (setOpen(true), e.target.select())}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!show) return
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
          else if (e.key === 'Enter') (e.preventDefault(), pick(items[active]))
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {show && (
        <ul className="combo-list" role="listbox">
          {items.map((it, i) => (
            <li
              key={it.value}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => (e.preventDefault(), pick(it))}
              onMouseEnter={() => setActive(i)}
            >
              <b>{it.primary}</b>
              {it.secondary && <span>{it.secondary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
