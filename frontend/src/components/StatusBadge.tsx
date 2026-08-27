import { type LeadStatus, STATUS_LABEL, STATUS_ORDER } from '../types'

const STYLES: Record<LeadStatus, string> = {
  nuevo:            'bg-scala-blue/15 text-scala-blue-light border-scala-blue/30',
  contactado:       'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  interesado:       'bg-purple-500/10 text-purple-300 border-purple-500/30',
  cerrado_ganado:   'bg-scala-green/10 text-scala-green border-scala-green/30',
  cerrado_perdido:  'bg-red-500/10 text-red-300 border-red-500/30',
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STYLES[status] ?? STYLES.nuevo}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

interface SelectProps {
  value: LeadStatus
  onChange: (s: LeadStatus) => void
  disabled?: boolean
}

export function StatusSelect({ value, onChange, disabled }: SelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as LeadStatus)}
      disabled={disabled}
      className={`text-xs rounded-full px-2.5 py-1 border bg-scala-surface2 text-scala-text-primary cursor-pointer focus:outline-none focus:border-scala-blue/50 disabled:opacity-50 ${STYLES[value] ?? ''}`}
    >
      {STATUS_ORDER.map(s => (
        <option key={s} value={s} className="bg-scala-surface2 text-scala-text-primary">
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  )
}
