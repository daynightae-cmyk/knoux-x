export interface MockWorkerMessageEvent {
  data: unknown;
}

export default class MockViteWorker {
  static instances: MockViteWorker[] = [];

  onmessage: ((event: MockWorkerMessageEvent) => void) | null = null;
  readonly postMessage = jest.fn();
  readonly terminate = jest.fn();

  constructor() {
    MockViteWorker.instances.push(this);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  static reset(): void {
    MockViteWorker.instances = [];
  }
}
