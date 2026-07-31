export type InstanceRole = 'primary' | 'secondary' | 'squirrel';

export interface PrimaryInstanceRuntime {
  handleSecondInstance(argv: readonly string[]): void;
}

export interface SingleInstanceEntryDependencies {
  squirrelStartup: boolean;
  requestLock(): boolean;
  onSecondInstance(listener: (argv: readonly string[]) => void): void;
  bootstrap(): PrimaryInstanceRuntime | Promise<PrimaryInstanceRuntime>;
  exit(exitCode: number): void;
  onFatal(error: unknown): void;
}

class SecondInstanceQueue {
  private readonly queuedArguments: (readonly string[])[] = [];
  private handler: ((argv: readonly string[]) => void) | null = null;

  enqueue(argv: readonly string[]): void {
    const snapshot = [...argv];
    if (this.handler) {
      this.handler(snapshot);
      return;
    }
    this.queuedArguments.push(snapshot);
  }

  attach(handler: (argv: readonly string[]) => void): void {
    this.handler = handler;
    for (const argv of this.queuedArguments.splice(0)) handler(argv);
  }
}

export function startSingleInstanceEntry(
  dependencies: SingleInstanceEntryDependencies,
): InstanceRole {
  if (dependencies.squirrelStartup) {
    dependencies.exit(0);
    return 'squirrel';
  }

  if (!dependencies.requestLock()) {
    dependencies.exit(0);
    return 'secondary';
  }

  const secondInstances = new SecondInstanceQueue();
  dependencies.onSecondInstance((argv) => secondInstances.enqueue(argv));

  void Promise.resolve()
    .then(() => dependencies.bootstrap())
    .then((runtime) => secondInstances.attach((argv) => runtime.handleSecondInstance(argv)))
    .catch(dependencies.onFatal);

  return 'primary';
}
