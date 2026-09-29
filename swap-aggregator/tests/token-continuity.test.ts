import assert from "node:assert/strict";
import { test } from "vitest";
import type { AppToken } from "../lib/tokens/types";
import { findTokenOnChain } from "../lib/token-continuity";
import { getCatalogToken, NATIVE_ADDRESS } from "../lib/tokens/catalog";
const known = (chainId: number, address: string) => {
  const token = getCatalogToken(chainId, address);
  assert.ok(token, `missing catalog fixture ${chainId}:${address}`);
  return { ...token, topSymbol: token.symbol };
};
const baseUSDC = known(8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
const polygonUSDC = known(137, '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359');
const ethUSDT = known(1, '0xdac17f958d2ee523a2206206994597c13d831ec7');
const polygonUSDT = known(137, '0xc2132d05d31c914a87c6611c10748aeb04b58e8f');

test('preserves pinned USDC/USDT and returns destination provider metadata', () => {
  const priced = { ...polygonUSDC, priceUSD: '1.01' };
  assert.equal(findTokenOnChain(baseUSDC, 137, [polygonUSDT, priced]), priced);
  assert.equal(findTokenOnChain(ethUSDT, 137, [polygonUSDC, polygonUSDT]), polygonUSDT);
  assert.equal(findTokenOnChain({ ...baseUSDC, address: baseUSDC.address.toLowerCase() }, 137, [priced]), priced);
});
test('requires both identities, chain IDs and decimals; symbols are insufficient', () => {
  assert.equal(findTokenOnChain({ ...baseUSDC, address: '0x' + '1'.repeat(40) }, 137, [polygonUSDC]), null);
  assert.equal(findTokenOnChain(baseUSDC, 137, [{ ...polygonUSDC, address: '0x' + '2'.repeat(40) }]), null);
  assert.equal(findTokenOnChain({ ...baseUSDC, decimals: 18 }, 137, [polygonUSDC]), null);
  assert.equal(findTokenOnChain(baseUSDC, 137, [{ ...polygonUSDC, decimals: 18 }]), null);
  assert.equal(findTokenOnChain(baseUSDC, 137, [{ ...polygonUSDC, chainId: 1 }]), null);
  assert.equal(findTokenOnChain(baseUSDC, 137, [{ ...polygonUSDC, symbol: 'USDC.e' }]), null);
});
test('never substitutes USDC.e or a Binance-pegged token for native USDC', () => {
  const bridged = { ...polygonUSDC, symbol: 'USDC.e', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' };
  assert.equal(findTokenOnChain(baseUSDC, 137, [bridged]), null);
  assert.equal(findTokenOnChain(bridged, 8453, [baseUSDC]), null);
  const pegged = known(56, '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d');
  assert.equal(findTokenOnChain(baseUSDC, 56, [pegged]), null);
});
test('keeps native ETH, WETH and other native assets separate', () => {
  const eth = known(1, NATIVE_ADDRESS);
  const baseETH = known(8453, NATIVE_ADDRESS);
  const baseWETH = known(8453, '0x4200000000000000000000000000000000000006');
  const ethWETH = known(1, '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  assert.equal(findTokenOnChain(eth, 8453, [baseWETH, baseETH]), baseETH);
  assert.equal(findTokenOnChain(ethWETH, 8453, [baseETH, baseWETH]), baseWETH);
  assert.equal(findTokenOnChain(eth, 8453, [baseWETH]), null);
  assert.equal(findTokenOnChain(eth, 137, [known(137, NATIVE_ADDRESS)]), null);
});
test('requires manual selection for missing or unsupported destinations', () => {
  assert.equal(findTokenOnChain(baseUSDC, 137, []), null);
  assert.equal(findTokenOnChain(null, 137, [polygonUSDC]), null);
  assert.equal(findTokenOnChain(baseUSDC, 99999, [{ ...polygonUSDC, chainId: 99999 as AppToken["chainId"] }]), null);
  assert.equal(findTokenOnChain(ethUSDT, 42161, [known(42161, '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9')]), null);
});
