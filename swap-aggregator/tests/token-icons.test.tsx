import { fireEvent, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TokenIcon } from "../components/TokenIcon";
import { APP_CHAINS } from "../lib/chains";
import { getPopularTokens } from "../lib/tokens/catalog";

describe("instant catalog icons", () => {
  it("ships a local inert SVG for every pinned token", () => {
    for (const chain of APP_CHAINS) for (const token of getPopularTokens(chain.id)) {
      expect(token.logoURI).toMatch(/^\/tokens\/[\w-]+\.svg$/);
      const path = `${process.cwd()}/public${token.logoURI}`; expect(existsSync(path)).toBe(true);
      const svg = readFileSync(path, "utf8"); expect(svg).toContain("<svg"); expect(svg).not.toMatch(/<script|<foreignObject|\bon\w+\s*=/i);
    }
  });
  it("shows known token and chain icons without a remote lookup", () => {
    const view = render(<TokenIcon token={getPopularTokens(8453)[0]} network />);
    const urls = Array.from(view.container.querySelectorAll("img")).map(img=>new URL(img.getAttribute("src")!, window.location.origin));
    expect(urls.map(url=>url.pathname)).toEqual(["/tokens/eth.svg", "/tokens/chain-base.svg"]);
    expect(urls.every(url=>url.origin === window.location.origin)).toBe(true);
  });
  it("does not assign a catalog logo to an impostor symbol", () => {
    const token = { ...getPopularTokens(8453)[0], address: "0x2222222222222222222222222222222222222222", logoURI: undefined };
    const view = render(<TokenIcon token={token} />); expect(view.container.querySelector("img")).toBeNull();
  });
  it("falls back gracefully when a logo cannot load", () => {
    const view = render(<TokenIcon token={getPopularTokens(8453)[0]} />);
    fireEvent.error(view.container.querySelector("img")!); expect(view.container.querySelector(".placeholder")?.textContent).toBe("ET");
  });
});
