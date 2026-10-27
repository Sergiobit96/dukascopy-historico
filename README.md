# Histórico de Dukascopy a 1 min

Baja con GitHub Actions las velas de 1 min (bid) de Dukascopy desde la primera de cada
instrumento: los índices DAX, FTSE, Nasdaq, Dow, S&P, Russell y Nikkei, el oro, la plata y
EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD y USD/CHF.

- Se lanza desde **Actions → Bajar histórico → Run workflow** (un trabajo por instrumento).
- El resultado está en el release **historico**: un `.zip` por instrumento con un CSV por
  mes (`time`, `datetime_madrid`, `open`, `high`, `low`, `close`, `volume`). Un CSV vacío es
  un mes sin velas.
- Si un trabajo no acaba en su tiempo, se relanza solo para su instrumento y sigue donde lo
  dejó.

Para un instrumento suelto en local: `npm install` y `node bajar.mjs deuidxeur`.
