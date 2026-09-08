export interface EditingToolAdapter<TInput, TOutput> {
  readonly id: string;
  canHandle(input: TInput): boolean;
  apply(input: TInput): Promise<TOutput>;
  reset(input: TInput): Promise<TOutput>;
}

export interface EditingToolFailure {
  toolId: string;
  code: 'unsupported-media' | 'missing-source' | 'invalid-state' | 'cancelled' | 'execution-failed';
  message: string;
}

export class EditingToolError extends Error {
  readonly failure: EditingToolFailure;

  constructor(failure: EditingToolFailure) {
    super(failure.message);
    this.name = 'EditingToolError';
    this.failure = { ...failure };
  }
}
