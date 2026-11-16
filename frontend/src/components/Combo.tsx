import { useEffect, useRef, useState } from 'react'

export interface ComboItem {
  value: string
  primary: string
  secondary?: string
  /** Small leading label, e.g. the stop number. */
  index?: string
}

interface Props {
  value: string
  onChange: (v: string) => void
  onPick: (item: ComboItem) => void
  items: ComboItem[]
  /** Full list to browse with the ▾ button (and shown when the field is empty). */
  browseItems?: ComboItem[]
  /** Optional action row at the bottom of the list, e.g. "Search all stations". */
  footer?: { label: string; onClick: () => void }
  placeholder?: string
  required?: boolean
  uppercase?: boolean
  ariaLabel?: string
}

/** Small accessible autocomplete: type, arrow keys, Enter to pick; ▾ to browse everything. */
export function Combo(p: Props) {
  const { value, onChange, onPick, items, browseItems, footer, placeholder, required, uppercase, ariaLabel } = p
  const [open, setOpen] = useState(false)
  const [browse, setBrowse] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const canBrowse = !!browseItems?.length
  const list = canBrowse && (browse || !value.trim()) ? browseItems! : items
  const show = open && (list.length > 0 || !!footer)

  const pick = (it: ComboItem) => {
    onPick(it)
    setOpen(false)
    setBrowse(false)
  }

  // Keep the highlighted row in view (long browse lists scroll).
  useEffect(() => {
    if (!show) return
    listRef.current?.querySelector<HTMLElement>('li.active')?.scrollIntoView({ block: 'nearest' })
  }, [active, show])

  const openBrowse = () => {
    const at = browseItems?.findIndex((it) => it.value === value.trim().toUpperCase()) ?? -1
    setBrowse(true)
    setOpen(true)
    setActive(Math.max(at, 0))
    inputRef.current?.focus()
  }

  return (
    <div className={`combo ${canBrowse ? 'has-toggle' : ''}`}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        required={required}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)
          setOpen(true)
          setBrowse(false)
          setActive(0)
        }}
        onFocus={(e) => (setOpen(true), e.target.select())}
        onBlur={() => setTimeout(() => (setOpen(false), setBrowse(false)), 120)}
        onKeyDown={(e) => {
          if (!show) {
            if (e.key === 'ArrowDown' && canBrowse) (e.preventDefault(), openBrowse())
            return
          }
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, list.length - 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
          else if (e.key === 'Enter' && list[active]) (e.preventDefault(), pick(list[active]))
          else if (e.key === 'Escape') (setOpen(false), setBrowse(false))
        }}
      />
      {canBrowse && (
        <button
          type="button"
          className={`combo-toggle ${show && list === browseItems ? 'up' : ''}`}
          aria-label="Show all stops in order"
          title="Show all stops in order"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (show && list === browseItems ? (setOpen(false), setBrowse(false)) : openBrowse())}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
      {show && (
        <ul className="combo-list" role="listbox" ref={listRef}>
          {list.map((it, i) => (
            <li
              key={it.value}
              role="option"
              aria-selected={i === active}
              className={`${i === active ? 'active' : ''} ${it.value === value.trim().toUpperCase() ? 'current' : ''}`}
              onMouseDown={(e) => (e.preventDefault(), pick(it))}
              onMouseEnter={() => setActive(i)}
            >
              {it.index && <i className="combo-idx">{it.index}</i>}
              <b>{it.primary}</b>
              {it.secondary && <span>{it.secondary}</span>}
            </li>
          ))}
          {footer && (
            <li
              className="combo-footer"
              onMouseDown={(e) => {
                e.preventDefault()
                footer.onClick()
                setBrowse(false)
                setActive(0)
              }}
            >
              {footer.label}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
