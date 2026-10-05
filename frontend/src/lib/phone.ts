/** Normaliza un teléfono argentino (formato Google Maps) a wa.me.
 *
 * Ejemplos que maneja:
 *   "011 4444-5555"      → 5491144445555
 *   "0341 15-555-0000"   → 5493415550000
 *   "+54 9 341 555-0000" → 5493415550000
 */
export function waPhoneAR(raw: string): string | null {
  let d = (raw || '').replace(/\D/g, '')
  if (!d) return null

  // Sacar código de país si ya viene
  if (d.startsWith('549')) d = d.slice(3)
  else if (d.startsWith('54')) d = d.slice(2)

  // Sacar el 0 inicial del formato nacional
  if (d.startsWith('0')) d = d.slice(1)

  // Sacar el "15" de celulares en formato local (área 2-4 dígitos + 15 + 6-8 dígitos)
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2')

  if (d.length < 8 || d.length > 12) return null

  // WhatsApp Argentina siempre usa 54 9 + área + número
  return `549${d}`
}

export function waLink(phone: string, text: string): string | null {
  const p = waPhoneAR(phone)
  if (!p) return null
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`
}

export const WA_DEFAULT_TEXT = 'Hola, me darías más información por favor?'
