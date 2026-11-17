// Range rider: a 1-minute cbBTC/USDC range trader for make.fun's BTC race.
//
// The dev window (24h of 1-minute cbBTC bars) is a choppy, range-bound market:
// BTC drifted only +0.5% over the whole day, swung 0.5-1.3% per hour, and its
// 1-minute returns carry almost no momentum (lag-1 autocorrelation ~0.15), so
// fast trend-following bleeds out in fees: a full-size round trip costs about
// 26 bps (4 bps fee + 2 bps slippage + ~7-13 bps price impact each way), while
// a typical 1-minute move is only ~6 bps. The bot therefore trades rarely and
// only on large deviations, and otherwise sits in cash:
//
// * It watches the last 240 bars (4 hours) of closes and buys 100% of cash when
//   the close sits in the bottom 15% of that rolling range -- buying the dip --
//   but only while the close is still within 0.5% of its 240-bar average, so it
//   never catches a knife in a strong downtrend.
// * It sells everything when the close reaches the top 15% of the same rolling
//   range, or on a trailing stop of 1.2% below the best close since entry, or
//   on a hard stop of 1.5% below the entry close.
// * It never enters in the last 30 scored bars: an entry that late cannot pay
//   its own round-trip cost before the window is flattened.
//
// Everything is BigInt arithmetic on the harness's raw units (prices are
// USDC x 1e5, cash is USDC x 1e6, quantities are cbBTC x 1e8), so the bot is
// exactly deterministic: same bars in, same orders out, every run.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Rolling window (bars) for the range and the average.
const WINDOW = 240;
// Buy when the close is within the bottom BAND_NUM/BAND_DEN of the range,
// sell when it is within the top BAND_NUM/BAND_DEN of the range.
const BAND_NUM = 3n;
const BAND_DEN = 20n;
// Trend filter: skip dip-buys while the close is more than FILTER_NUM /
// FILTER_DEN below the 240-bar average (a strong downtrend).
const FILTER_NUM = 199n;
const FILTER_DEN = 200n;
// Trailing stop: sell if the close falls TRAIL_NUM/TRAIL_DEN below the best
// close since entry. Hard stop: sell if it falls STOP_NUM/STOP_DEN below
// the entry close.
const TRAIL_NUM = 988n;
const TRAIL_DEN = 1000n;
const STOP_NUM = 197n;
const STOP_DEN = 200n;
// Largest move (from the latest close) an order tolerates before the
// harness rejects it as max_slippage: 200 bps. One-minute moves are ~6 bps,
// so this almost never binds, but it stops the bot filling into a gap.
const MAX_SLIPPAGE_BPS = 200;
// Minimum cash to bother buying (1 USDC, the harness's minimum notional).
const MIN_NOTIONAL = 1_000_000n;
// Do not open a new position in the last bars of the window.
const LAST_ENTRY_BAR = 1410;

// Bars seen so far (closes, raw price units), and the position's bookkeeping.
const closes: bigint[] = [];
let entryClose: bigint | null = null;
let peakClose: bigint | null = null;

function rollingHighLow(window: number): [bigint, bigint] {
  // High and low of the `window` closes before the latest one.
  const prior = closes.slice(-window - 1, -1);
  let high = prior[0]!;
  let low = prior[0]!;
  for (const c of prior) {
    if (c > high) high = c;
    if (c < low) low = c;
  }
  return [high, low];
}

function rollingAverage(window: number): bigint {
  // Integer average of the last `window` closes, latest included.
  let sum = 0n;
  for (const c of closes.slice(-window)) sum += c;
  return sum / BigInt(window);
}

function decide(state: BarsState): OrderInput[] {
  const close = state.close(SYMBOL);
  if (close === null || state.warmingUp) return [];
  closes.push(close);
  const holding = state.positions.get(SYMBOL);
  if (holding === undefined) {
    entryClose = null;
    peakClose = null;
  }
  const scored = state.seq - state.warmupBars;
  if (closes.length < WINDOW + 1) return [];
  const [high, low] = rollingHighLow(WINDOW);
  const span = high - low;
  if (span <= 0n) return [];
  if (holding === undefined) {
    if (scored >= LAST_ENTRY_BAR) return [];
    // Trend filter: no dip-buy in a strong downtrend.
    const average = rollingAverage(WINDOW);
    if (close * FILTER_DEN < average * FILTER_NUM) return [];
    // Buy the dip: close in the bottom 15% of the rolling range.
    if ((close - low) * BAND_DEN <= BAND_NUM * span) {
      if (state.cash < MIN_NOTIONAL) return [];
      entryClose = close;
      peakClose = close;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }
  // Holding: track the best close since entry for the trailing stop.
  if (peakClose === null) {
    entryClose = close;
    peakClose = close;
  } else if (close > peakClose) {
    peakClose = close;
  }
  // Sell at the top of the range, on the trailing stop, or on the hard stop.
  if (
    (high - close) * BAND_DEN <= BAND_NUM * span ||
    close * TRAIL_DEN <= peakClose * TRAIL_NUM ||
    close * STOP_DEN <= entryClose! * STOP_NUM
  ) {
    return [{ side: 'sell', symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}


await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    return decide(state);
  },
});
