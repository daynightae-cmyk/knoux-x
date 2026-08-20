export interface MockWorkerMessageEvent {
  data: unknown;
}

export default class MockViteWorker {
  static instances: MockViteWorker[] = [];

  onmessage: ((event: MockWorkerMessageEvent) => void) | null = null;
  readonly postMessage = jest.fn();
  readonly terminate = jest.fn();
  private readonly listeners = new Set<(event: MockWorkerMessageEvent) => void>();

  constructor() {
    MockViteWorker.instances.push(this);
  }

  emit(data: unknown): void {
    const event = { data };
    this.onmessage?.(event);
    for (const listener of [...this.listeners]) listener(event);
  }

  addEventListener(_type: 'message', listener: (event: MockWorkerMessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MockWorkerMessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  static reset(): void {
    MockViteWorker.instances = [];
  }
}
