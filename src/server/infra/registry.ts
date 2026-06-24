/** DI 单一注册入口 — Registry 实现（TS 版）。
 *
 * 提供单例注册、懒加载解析、测试用 override。
 */

export type Factory<T> = (registry: Registry) => T;

export class Registry {
  private factories = new Map<string, Factory<unknown>>();
  private instances = new Map<string, unknown>();

  register<T>(token: string, factory: Factory<T>): void {
    if (this.factories.has(token)) {
      throw new Error(`Token '${token}' already registered`);
    }
    this.factories.set(token, factory as Factory<unknown>);
  }

  resolve<T>(token: string): T {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`Token '${token}' not registered`);
    }
    const instance = factory(this);
    this.instances.set(token, instance);
    return instance as T;
  }

  override<T>(token: string, instance: T): void {
    this.instances.set(token, instance);
  }

  shutdown(): void {
    for (const instance of this.instances.values()) {
      if (instance && typeof (instance as { close?: () => void }).close === "function") {
        try {
          (instance as { close(): void }).close();
        } catch {
          // ignore
        }
      }
      if (instance && typeof (instance as { dispose?: () => void }).dispose === "function") {
        try {
          (instance as { dispose(): void }).dispose();
        } catch {
          // ignore
        }
      }
    }
    this.instances.clear();
    this.factories.clear();
  }
}
