import { describe, it, expect } from "vitest";
import { Address4, Address6 } from "ip-address";

/** 检查地址是否为 loopback（H4 修复的 TS 等价验证）。 */
function isLoopback(addr: string): boolean {
  try {
    if (addr.includes(":")) {
      // IPv4-mapped IPv6 loopback (::ffff:127.x.x.x)
      if (addr.startsWith("::ffff:127.")) return true;
      if (addr === "::ffff:127.0.0.1") return true;
      const a6 = new Address6(addr);
      return a6.isLoopback();
    }
    const a4 = new Address4(addr);
    return a4.isLoopback();
  } catch {
    return addr.startsWith("127.");
  }
}

describe("auth localhost bypass (H4)", () => {
  const cases = [
    { ip: "127.0.0.1", expected: true },
    { ip: "::1", expected: true },
    { ip: "::ffff:127.0.0.1", expected: true },
    { ip: "127.0.0.2", expected: true },
    { ip: "192.168.1.1", expected: false },
    { ip: "10.0.0.1", expected: false },
    { ip: "::ffff:192.168.1.1", expected: false },
  ];

  it.each(cases)("$ip should be loopback=$expected", ({ ip, expected }) => {
    expect(isLoopback(ip)).toBe(expected);
  });
});
