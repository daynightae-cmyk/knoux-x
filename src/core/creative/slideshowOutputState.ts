export const MISSING_SLIDESHOW_OUTPUT_REASON = 'Completed output file is missing from disk.';

export function slideshowOutputActionState(outputExists: boolean | undefined): {
  disabled: boolean;
  disabledReason: string | undefined;
} {
  const disabled = outputExists === false;
  return {
    disabled,
    disabledReason: disabled ? MISSING_SLIDESHOW_OUTPUT_REASON : undefined,
  };
}
