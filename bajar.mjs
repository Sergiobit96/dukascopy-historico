// Baja de Dukascopy el histórico a 1 min (bid) de un instrumento, desde su primera vela, un CSV
// por mes en historico/<instrumento>/<AAAA-MM>.csv: time (unix en segundos), datetime_madrid
// (con su desfase, +01:00 o +02:00), open, high, low, close, volume (millones, como lo da
// Dukascopy). Un CSV vacío es un mes sin velas.
//
//   node bajar.mjs <instrumento>
//
// Reanudable: un mes con su CSV está hecho (el mes en curso se rehace siempre). Si Dukascopy
// limita (429) tira el mes, que vendría incompleto, espera y lo repite. LIMITE_MIN: a partir de
// esos minutos ya no empieza otro mes (un trabajo de Actions dura 6 h como mucho), y deja dicho
// en GITHUB_OUTPUT si ha acabado (completo=true) o hay que seguir en otra vuelta.
import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getHistoricalRates, instrumentMetaData } from 'dukascopy-node'

const instrumento = (process.argv[2] ?? '').toLowerCase()
if (!instrumentMetaData[instrumento]) {
  console.error(`Dukascopy no tiene el instrumento «${instrumento}»`)
  process.exit(1)
}
const DIR = join('historico', instrumento)
const LIMITE_MS = Number(process.env.LIMITE_MIN ?? 1e9) * 60_000
const ESPERAS_MIN = [1, 2, 5, 10, 15]
const PAUSA_ENTRE_MESES_MS = 1_000
const arranque = Date.now()

// dukascopy-node da por vacío cualquier fichero que no llegue con un 200, así que un 429 se
// confundiría con «no hay datos»: se apunta aquí, en el fetch que usa por dentro
let ultimo429 = 0
const fetchOriginal = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const r = await fetchOriginal(input, init)
  if (r.status === 429) ultimo429 = Date.now()
  return r
}

const enMadrid = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const desfaseMadrid = ms => (Date.parse(enMadrid.format(ms).replace(' ', 'T') + 'Z') - Math.floor(ms / 1000) * 1000) / 60_000
function fechaMadrid(ms) {
  const min = desfaseMadrid(ms)
  return `${enMadrid.format(ms).replace(' ', 'T')}+${String(min / 60).padStart(2, '0')}:00`
}

const dormir = ms => new Promise(res => setTimeout(res, ms))
const anotar = texto => console.log(`${new Date().toISOString().slice(0, 19)}Z  ${instrumento}  ${texto}`)

// meses en UTC [inicio, fin) desde el de la primera vela hasta ahora
function meses(primeraMs, finMs) {
  const lista = []
  const d = new Date(primeraMs)
  for (let a = d.getUTCFullYear(), m = d.getUTCMonth(); Date.UTC(a, m, 1) < finMs; m++) {
    if (m === 12) { a++; m = 0 }
    lista.push([Math.max(Date.UTC(a, m, 1), primeraMs), Math.min(Date.UTC(a, m + 1, 1), finMs), `${a}-${String(m + 1).padStart(2, '0')}`])
  }
  return lista
}

async function bajarMes(ini, fin) {
  const inicio = Date.now()
  try {
    const velas = await getHistoricalRates({
      instrument: instrumento, timeframe: 'm1', format: 'json', priceType: 'bid',
      dates: { from: new Date(ini), to: new Date(fin) },
      volumes: true, ignoreFlats: true, retryCount: 3, pauseBetweenRetriesMs: 3000,
      batchSize: 8, pauseBetweenBatchesMs: 500,
    })
    if (ultimo429 >= inicio) return { error: '429' }
    return { velas: velas.filter(v => v.timestamp >= ini && v.timestamp < fin) }
  } catch (err) {
    return { error: ultimo429 >= inicio ? '429' : err.message }
  }
}

function guardarMes(ruta, velas) {
  const comillas = v => `"${v}"`
  const filas = velas.map(v => [Math.floor(v.timestamp / 1000), fechaMadrid(v.timestamp), v.open, v.high, v.low, v.close, v.volume ?? ''].map(comillas).join(','))
  const cabecera = ['time', 'datetime_madrid', 'open', 'high', 'low', 'close', 'volume'].map(comillas).join(',')
  writeFileSync(`${ruta}.tmp`, '﻿' + [cabecera, ...filas].join('\r\n') + '\r\n')
  renameSync(`${ruta}.tmp`, ruta)
}

function salida(completo) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `completo=${completo}\n`)
}

mkdirSync(DIR, { recursive: true })
const ahora = Date.now()
const mesEnCurso = new Date(ahora).toISOString().slice(0, 7)
const todos = meses(Date.parse(instrumentMetaData[instrumento].startDayForMinuteCandles), ahora)
const pendientes = todos.filter(([, , mes]) => mes === mesEnCurso || !existsSync(join(DIR, `${mes}.csv`)))
anotar(`${todos.length} meses desde ${todos[0][2]}, faltan ${pendientes.length}`)

let hechos = 0
for (const [ini, fin, mes] of pendientes) {
  if (Date.now() - arranque > LIMITE_MS) {
    anotar(`se acaba el tiempo de esta vuelta: ${hechos} meses hechos, quedan ${pendientes.length - hechos}`)
    salida(false)
    process.exit(0)
  }
  for (let intento = 0; ; intento++) {
    const r = await bajarMes(ini, fin)
    if (r.velas) {
      if (r.velas.length) guardarMes(join(DIR, `${mes}.csv`), r.velas)
      else writeFileSync(join(DIR, `${mes}.csv`), '')
      anotar(`${mes}: ${r.velas.length} velas`)
      hechos++
      break
    }
    const espera = ESPERAS_MIN[Math.min(intento, ESPERAS_MIN.length - 1)]
    anotar(`${mes}: ${r.error === '429' ? 'Dukascopy limita (429)' : `falla: ${r.error}`}; espero ${espera} min`)
    await dormir(espera * 60_000)
    if (Date.now() - arranque > LIMITE_MS) break
  }
  await dormir(PAUSA_ENTRE_MESES_MS)
}
anotar('completo')
salida(true)
