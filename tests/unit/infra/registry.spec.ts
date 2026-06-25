import { describe, it, expect } from "vitest";
import { Registry } from "../../../src/server/infra/registry.js";

describe("Registry", () => {
  it("should resolve a registered dependency", () => {
    const registry = new Registry();
    registry.register("Foo", () => "bar");
    expect(registry.resolve<string>("Foo")).toBe("bar");
  });

  it("should throw for unregistered token", () => {
    const registry = new Registry();
    expect(() => registry.resolve("NonExistent")).toThrow("not registered");
  });

  it("should throw for duplicate registration", () => {
    const registry = new Registry();
    registry.register("Foo", () => "bar");
    expect(() => registry.register("Foo", () => "baz")).toThrow("already registered");
  });

  it("should resolve the same instance on repeated calls (singleton)", () => {
    const registry = new Registry();
    let instanceCount = 0;
    registry.register("Counter", () => ++instanceCount);
    const a = registry.resolve<number>("Counter");
    const b = registry.resolve<number>("Counter");
    expect(a).toBe(1);
    expect(b).toBe(1); // same instance
  });

  it("should support override for testing", () => {
    const registry = new Registry();
    registry.register("Foo", () => "original");
    registry.override("Foo", "mocked");
    expect(registry.resolve<string>("Foo")).toBe("mocked");
  });

  it("should support factories with DI (nested resolve)", () => {
    const registry = new Registry();
    registry.register("Db", () => "in-memory-db");
    registry.register("Repo", (r) => {
      const db = r.resolve<string>("Db");
      return `repo-with-${db}`;
    });
    expect(registry.resolve<string>("Repo")).toBe("repo-with-in-memory-db");
  });

  it("should clear all on shutdown", () => {
    const registry = new Registry();
    registry.register("Foo", () => "bar");
    registry.resolve("Foo");
    registry.shutdown();
    // After shutdown, re-register should work
    registry.register("Foo", () => "new-bar");
    expect(registry.resolve<string>("Foo")).toBe("new-bar");
  });

  it("should return true from isRegistered for a known token", () => {
    const registry = new Registry();
    registry.register("Foo", () => "bar");
    expect(registry.isRegistered("Foo")).toBe(true);
  });

  it("should return false from isRegistered for an unknown token", () => {
    const registry = new Registry();
    expect(registry.isRegistered("NonExistent")).toBe(false);
  });

  it("should allow override before registration", () => {
    const registry = new Registry();
    registry.override("Early", "value");
    expect(registry.resolve<string>("Early")).toBe("value");
  });

  it("should call close() on overridden instance if it has the method", () => {
    const registry = new Registry();
    let closed = false;
    const oldInstance = {
      close() { closed = true; },
    };
    registry.register("Service", () => oldInstance);
    registry.resolve("Service"); // materialize the singleton
    registry.override("Service", "new-instance");
    expect(registry.resolve<string>("Service")).toBe("new-instance");
    expect(closed).toBe(true);
  });

  it("should call dispose() on overridden instance if it has the method", () => {
    const registry = new Registry();
    let disposed = false;
    const oldInstance = {
      dispose() { disposed = true; },
    };
    registry.register("Service", () => oldInstance);
    registry.resolve("Service"); // materialize the singleton
    registry.override("Service", "new-instance");
    expect(registry.resolve<string>("Service")).toBe("new-instance");
    expect(disposed).toBe(true);
  });

  it("should call close() and dispose() on shutdown for instances with those methods", () => {
    const registry = new Registry();
    let closed = false;
    let disposed = false;
    const instance = {
      close() { closed = true; },
      dispose() { disposed = true; },
    };
    registry.register("Svc", () => instance);
    registry.resolve("Svc"); // materialize
    registry.shutdown();
    expect(closed).toBe(true);
    expect(disposed).toBe(true);
  });

  it("should not throw when close() throws during override", () => {
    const registry = new Registry();
    const instance = {
      close() { throw new Error("cleanup error"); },
    };
    registry.register("Bad", () => instance);
    registry.resolve("Bad");
    expect(() => registry.override("Bad", "fixed")).not.toThrow();
    expect(registry.resolve<string>("Bad")).toBe("fixed");
  });

  it("should not throw when close() throws during shutdown", () => {
    const registry = new Registry();
    registry.register("Bad", () => ({
      close() { throw new Error("shutdown error"); },
    }));
    registry.resolve("Bad");
    expect(() => registry.shutdown()).not.toThrow();
  });

  it("should not materialize instance until resolve is called", () => {
    const registry = new Registry();
    let factoryCalled = false;
    registry.register("Lazy", () => {
      factoryCalled = true;
      return "lazy-value";
    });
    expect(factoryCalled).toBe(false);
    registry.resolve<string>("Lazy");
    expect(factoryCalled).toBe(true);
  });

  it("should resolve after shutdown when re-registered", () => {
    const registry = new Registry();
    registry.register("X", () => "v1");
    registry.resolve<string>("X");
    registry.shutdown();
    registry.register("X", () => "v2");
    expect(registry.resolve<string>("X")).toBe("v2");
  });
});
