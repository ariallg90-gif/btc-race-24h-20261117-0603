# Range Rider

[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/ariallg90-gif/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/ariallg90-gif/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

An entry for [make.fun](https://make.fun)'s **btc-race-24h-20261117-0603** bounty — a bot that trades cbBTC against USDC, minute by minute, in a replay of on-chain prices. Paper money only: nothing is traded for real.

## The idea

The dev window is a choppy, range-bound market: BTC drifted +0.5% over 24 hours, swung 0.5–1.3% per hour, and its 1-minute returns carry almost no momentum. A full-size round trip costs ~26 bps in fees, slippage and price impact, while a typical 1-minute move is ~6 bps — so fast trend-following bleeds out. This bot trades rarely and only on large deviations:

* It watches the last 240 bars (4 hours) and buys 100% of cash when the close sits in the bottom 15% of that rolling range — buying the dip — but only while the close is still within 0.5% of its 240-bar average, so it never catches a knife in a strong downtrend.
* It sells everything when the close reaches the top 15% of the same rolling range, or on a trailing stop of 1.2% below the best close since entry, or on a hard stop of 1.5% below the entry close.
* It never enters in the last 30 scored bars: an entry that late cannot pay its own round-trip cost before the window is flattened.

## Results on the dev window

Graded locally with the kit (`grade-local --driver process`):

* **Net PnL: +16.56 USDC** (1.66% return), 6 trades, 6/6 winning, max drawdown 1.16%, 0 rejected orders
* At 2x fees the net PnL is still +14.13 USDC
* Two executions reproduce the action log byte for byte — fully deterministic

## How it runs

`main.ts` (Node 22, standard library only, BigInt arithmetic throughout) speaks the `agent-fun/bars-replay/v1` protocol through the vendored `vendor/makefun-bars.ts` shim: one JSON line per bar in on stdin, one reply per bar out on stdout. No network, no clock, no randomness — same bars in, same orders out, every run.
