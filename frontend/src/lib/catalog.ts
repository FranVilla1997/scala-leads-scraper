/** Catálogo para armar búsquedas en masa sin tipear: rubros y zonas agrupados.
 *  Los valores van en la misma forma en que el backend guarda zona y keyword
 *  (minúsculas, sin tildes), así no se generan duplicados en la base. */

export interface CatalogGroup {
  name: string
  items: string[]
}

export const BUSINESS_GROUPS: CatalogGroup[] = [
  {
    name: 'Salud',
    items: [
      'dentistas', 'clinicas esteticas', 'centros medicos', 'kinesiologos', 'psicologos',
      'nutricionistas', 'oftalmologos', 'dermatologos', 'pediatras', 'veterinarias', 'opticas',
      'laboratorios de analisis clinicos',
    ],
  },
  {
    name: 'Belleza y bienestar',
    items: [
      'peluquerias', 'barberias', 'centros de estetica', 'spa', 'salones de uñas',
      'depilacion definitiva', 'estudios de tatuajes',
    ],
  },
  {
    name: 'Fitness y deporte',
    items: [
      'gimnasios', 'estudios de yoga', 'estudios de pilates', 'crossfit', 'escuelas de danza',
      'academias de artes marciales', 'canchas de padel',
    ],
  },
  {
    name: 'Gastronomía',
    items: [
      'restaurantes', 'cafeterias', 'bares', 'pizzerias', 'parrillas', 'heladerias', 'panaderias',
      'cervecerias', 'servicios de catering',
    ],
  },
  {
    name: 'Inmobiliario y construcción',
    items: [
      'inmobiliaria', 'desarrolladoras inmobiliarias', 'constructoras', 'estudios de arquitectura',
      'administracion de consorcios', 'corralones', 'empresas de reformas',
    ],
  },
  {
    name: 'Servicios profesionales',
    items: [
      'estudios juridicos', 'estudios contables', 'escribanias', 'productores de seguros',
      'consultoras', 'agencias de marketing', 'agencias de viajes', 'despachantes de aduana',
    ],
  },
  {
    name: 'Automotor',
    items: [
      'concesionarias de autos', 'concesionarias de motos', 'talleres mecanicos', 'gomerias',
      'lavaderos de autos', 'casas de repuestos',
    ],
  },
  {
    name: 'Comercio',
    items: [
      'ferreterias', 'mueblerias', 'casas de electrodomesticos', 'tiendas de ropa', 'joyerias',
      'florerias', 'librerias', 'pinturerias', 'pet shops', 'vinotecas', 'bicicleterias',
    ],
  },
  {
    name: 'Turismo y eventos',
    items: [
      'hoteles', 'cabañas', 'hostels', 'apart hoteles', 'complejos turisticos', 'salones de eventos',
    ],
  },
  {
    name: 'Educación',
    items: [
      'jardines maternales', 'colegios privados', 'institutos de ingles', 'academias de apoyo escolar',
      'autoescuelas', 'institutos terciarios',
    ],
  },
  {
    name: 'Industria y servicios a empresas',
    items: [
      'fabricas', 'metalurgicas', 'imprentas', 'distribuidoras', 'empresas de logistica',
      'empresas de seguridad', 'empresas de limpieza', 'empresas de software',
    ],
  },
]

const caba = (barrios: string[]) => barrios.map(b => `${b}, caba`)
const gba = (partidos: string[]) => partidos.map(p => `${p}, buenos aires`)

export const ZONE_GROUPS: CatalogGroup[] = [
  {
    name: 'CABA — barrios',
    items: caba([
      'agronomia', 'almagro', 'balvanera', 'barracas', 'belgrano', 'boedo', 'caballito', 'chacarita',
      'coghlan', 'colegiales', 'constitucion', 'flores', 'floresta', 'la boca', 'la paternal',
      'liniers', 'mataderos', 'monte castro', 'monserrat', 'nueva pompeya', 'nuñez', 'palermo',
      'parque avellaneda', 'parque chacabuco', 'parque chas', 'parque patricios', 'puerto madero',
      'recoleta', 'retiro', 'saavedra', 'san cristobal', 'san nicolas', 'san telmo',
      'velez sarsfield', 'versalles', 'villa crespo', 'villa del parque', 'villa devoto',
      'villa general mitre', 'villa lugano', 'villa luro', 'villa ortuzar', 'villa pueyrredon',
      'villa real', 'villa riachuelo', 'villa santa rita', 'villa soldati', 'villa urquiza',
    ]),
  },
  {
    name: 'Gran Buenos Aires',
    items: gba([
      'avellaneda', 'lanus', 'lomas de zamora', 'quilmes', 'berazategui', 'florencio varela',
      'almirante brown', 'esteban echeverria', 'ezeiza', 'la matanza', 'moron', 'ituzaingo',
      'hurlingham', 'tres de febrero', 'san martin', 'vicente lopez', 'san isidro', 'san fernando',
      'tigre', 'pilar', 'escobar', 'malvinas argentinas', 'jose c. paz', 'san miguel', 'moreno',
      'merlo',
    ]),
  },
  {
    name: 'Capitales de provincia',
    items: [
      'la plata', 'cordoba', 'santa fe', 'mendoza', 'san miguel de tucuman', 'salta', 'parana',
      'corrientes', 'posadas', 'resistencia', 'neuquen', 'san juan', 'san luis',
      'san salvador de jujuy', 'santiago del estero', 'san fernando del valle de catamarca',
      'la rioja', 'formosa', 'santa rosa, la pampa', 'viedma', 'rawson, chubut', 'rio gallegos',
      'ushuaia',
    ],
  },
  {
    name: 'Otras ciudades grandes',
    items: [
      'rosario', 'mar del plata', 'bahia blanca', 'tandil', 'olavarria', 'pergamino',
      'junin, buenos aires', 'san nicolas de los arroyos', 'rio cuarto', 'villa maria',
      'villa carlos paz', 'rafaela', 'venado tuerto', 'san rafael, mendoza', 'godoy cruz',
      'concordia', 'gualeguaychu', 'bariloche', 'comodoro rivadavia', 'puerto madryn', 'trelew',
      'puerto iguazu',
    ],
  },
  {
    name: 'Costa Atlántica',
    items: [
      'pinamar', 'carilo', 'valeria del mar', 'ostende', 'villa gesell', 'mar de las pampas',
      'madariaga', 'san clemente del tuyu', 'santa teresita', 'san bernardo', 'mar de ajo',
      'miramar', 'necochea',
    ],
  },
]
